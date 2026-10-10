// ============================================================
// terrain.js — 有界超大地形系统（v2）
//
// 与 v1 的区别：不再无限流式生成，改为 2048x2048 米固定地图，
// 启动时一次性生成 16x16 = 256 个区块（异步分批，带加载进度）。
//
// 地形构成：
//  1. 基础丘陵（fbm 分形噪声）
//  2. 城市平整遮罩（市中心自动压平）
//  3. 西侧蜿蜒河流（河床下切 + 河滩沙地 + 水面）
//  4. 边缘山脉（GTA 式自然边界，挡住玩家去路）
//
// getHeight() 仍是全系统统一的地面高度权威接口。
// ============================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createNoise2D, fbm2, smoothstep } from './noise.js';
import { createTerrainMaterial } from './materials.js';

// 两个独立噪声源：一个管高度，一个管颜色抖动
const hillNoise = createNoise2D(CONFIG.world.seed);
const colorNoise = createNoise2D(CONFIG.world.seed + 77);

/** 河道中心线：X 随 Z 正弦蜿蜒 */
export function riverCenterX(z) {
  const rv = CONFIG.world.river;
  return rv.cx + rv.amp * Math.sin(z * rv.freq + 1.2);
}

/**
 * 地形高度函数（全世界唯一权威来源）
 */
export function getHeight(x, z) {
  const W = CONFIG.world;

  // --- 基础丘陵：大尺度山脉 + 小尺度地表起伏 ---
  let h = fbm2(hillNoise, x * 0.0016, z * 0.0016, 4) * W.hillHeight;
  h += fbm2(hillNoise, x * 0.012 + 100, z * 0.012 + 100, 2) * 2.2;

  // --- 城市平整遮罩 ---
  const c = W.city;
  const distCity = Math.hypot(x - c.cx, z - c.cz);
  const flat = 1 - smoothstep(c.radius * 0.7, c.radius * 1.3, distCity);
  h = h * (1 - flat * 0.94) + c.baseHeight * flat;

  // --- 河流下切（河床平滑压到 bedHeight，两岸自然过渡） ---
  const rv = W.river;
  const dRiver = Math.abs(x - riverCenterX(z));
  const inRiver = 1 - smoothstep(rv.halfWidth * 0.5, rv.halfWidth + 16, dRiver);
  if (inRiver > 0.001) {
    const bed = rv.bedHeight + fbm2(hillNoise, x * 0.02, z * 0.02, 2) * 0.5;
    h = h + (bed - h) * inRiver;
  }

  // --- 边缘山脉（自然边界） ---
  const dEdge = Math.hypot(x, z);
  const rim = smoothstep(W.rimStart, W.mapHalf, dEdge);
  if (rim > 0.001) {
    h += rim * W.rimHeight * (0.7 + 0.5 * (fbm2(hillNoise, x * 0.004 + 31, z * 0.004 + 31, 3) * 0.5 + 0.5));
  }

  return h;
}

/** 估算坡度（0 = 平地，越大越陡） */
export function getSlope(x, z) {
  const e = 2.0;
  const dx = getHeight(x + e, z) - getHeight(x - e, z);
  const dz = getHeight(x, z + e) - getHeight(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

/** 地表顶点颜色：草（多斑块）/ 泥 / 岩 / 河滩沙 / 城市水泥 混合 */
function computeGroundColor(x, z, h, slope, out) {
  // 基础草绿（细碎抖动）
  const jitter = colorNoise(x * 0.05, z * 0.05) * 0.06;
  out.setRGB(0.30 + jitter, 0.43 + jitter, 0.20 + jitter * 0.5);

  // --- 大尺度草甸斑块：枯黄区 / 湿润深色区（草地不再均匀） ---
  const patch = fbm2(colorNoise, x * 0.008, z * 0.008, 3);
  if (patch > 0.10) {
    // 枯黄干草斑
    out.lerp(_tmpColor.setRGB(0.55, 0.52, 0.28), Math.min(1, (patch - 0.10) * 2.4) * 0.55);
  } else if (patch < -0.16) {
    // 湿润深绿区
    out.lerp(_tmpColor.setRGB(0.20, 0.33, 0.15), Math.min(1, (-patch - 0.16) * 2.8) * 0.5);
  }

  // --- 裸土斑点（中尺度，草皮磨损露出泥土） ---
  const bare = colorNoise(x * 0.045 + 37, z * 0.045 - 11);
  if (bare > 0.30) {
    out.lerp(_tmpColor.setRGB(0.47, 0.38, 0.27), Math.min(1, (bare - 0.30) * 3.2) * 0.75);
  }

  // 低洼泥土
  const dirt = smoothstep(4, -2, h);
  if (dirt > 0) out.lerp(_tmpColor.setRGB(0.45, 0.36, 0.26), dirt * 0.6);

  // 陡坡露岩（灰中带棕，岩层感）
  const rock = smoothstep(0.45, 0.85, slope);
  if (rock > 0) {
    const strata = colorNoise(x * 0.03, h * 0.35) * 0.06; // 随高度变化的岩层色带
    out.lerp(_tmpColor.setRGB(0.46 + strata, 0.44 + strata, 0.42 + strata * 0.5), rock);
  }

  // 河滩沙地（靠水侧偏湿深色）
  const rv = CONFIG.world.river;
  const dRiver = Math.abs(x - riverCenterX(z));
  if (dRiver < rv.halfWidth + 14 && h < 1.6) {
    const sand = 1 - smoothstep(0.6, 1.6, h);
    out.lerp(_tmpColor.setRGB(0.72, 0.66, 0.49), 0.4 + sand * 0.45);
    // 湿沙带（水线附近颜色加深）
    const wet = 1 - smoothstep(-0.6, 0.5, h);
    if (wet > 0) out.lerp(_tmpColor.setRGB(0.48, 0.44, 0.34), wet * 0.55);
  }

  // 城市水泥
  const c = CONFIG.world.city;
  const distCity = Math.hypot(x - c.cx, z - c.cz);
  const cityMix = 1 - smoothstep(c.radius * 0.75, c.radius * 1.25, distCity);
  if (cityMix > 0) {
    const cj = colorNoise(x * 0.15, z * 0.15) * 0.03;
    out.lerp(_tmpColor.setRGB(0.50 + cj, 0.50 + cj, 0.51 + cj), cityMix * 0.85);
  }

  return out;
}
const _tmpColor = new THREE.Color();

// ============================================================
// TerrainManager — 固定地图，一次性生成
// ============================================================
export class TerrainManager {
  constructor(scene) {
    this.scene = scene;
    this.material = createTerrainMaterial();
    this.chunks = new Map();
  }

  /**
   * 异步生成全图 256 个区块（分批让出主线程，回报加载进度）
   * @param {function(number):void} onProgress 进度回调 0..1
   */
  async buildAll(onProgress) {
    const W = CONFIG.world;
    const n = Math.ceil((W.mapHalf * 2) / W.chunkSize); // 16
    const total = n * n;
    let done = 0;

    for (let ix = 0; ix < n; ix++) {
      for (let iz = 0; iz < n; iz++) {
        const ox = -W.mapHalf + ix * W.chunkSize;
        const oz = -W.mapHalf + iz * W.chunkSize;
        this.buildChunk(ox, oz);
        done++;
        // 每 4 块让出一次主线程并更新进度条（让出越频繁，加载期页面越流畅）
        if (done % 4 === 0) {
          onProgress && onProgress(done / total);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }
    onProgress && onProgress(1);

    // 水面（一张大平面，只有河床等低处会露出）
    this.buildWater();
  }

  buildChunk(ox, oz) {
    const size = CONFIG.world.chunkSize;
    const res = CONFIG.world.chunkResolution;

    const geo = new THREE.PlaneGeometry(size, size, res, res);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const colors = new Float32Array(pos.count * 3);
    const color = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i) + ox + size / 2;
      const wz = pos.getZ(i) + oz + size / 2;
      const h = getHeight(wx, wz);
      pos.setY(i, h);
      uv.setXY(i, uv.getX(i) * (size / 8), uv.getY(i) * (size / 8));
      computeGroundColor(wx, wz, h, getSlope(wx, wz), color);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(ox + size / 2, 0, oz + size / 2);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    this.scene.add(mesh);
    this.chunks.set(ox + ',' + oz, mesh);
  }

  /** 水面：半透明蓝色大平面，roughness 低带一点环境反光 */
  buildWater() {
    const size = CONFIG.world.mapHalf * 2;
    const geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2e5a6e,
      transparent: true,
      opacity: 0.78,
      roughness: 0.15,   // 水面较光滑，反射天空
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = CONFIG.world.waterLevel;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
  }

  /** 兼容旧接口：固定地图无需逐帧更新，保留空实现 */
  update() {}

  get loadedCount() {
    return this.chunks.size;
  }
}
