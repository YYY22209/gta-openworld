// ============================================================
// roads.js — 路网系统
//
// 生成内容：
//  1. 城市网格路网：主干道 + 人行道（路缘双层结构）
//  2. 一条郊区高速公路（双向车道，穿过乡野）
//
// 技术要点（参考成熟方案）：
//  - 路面是"带状网格"，逐段采样地形高度 → 道路随地势起伏；
//  - 人行道层比路面层宽、且低 3cm，视觉上自然形成路缘石；
//  - 横路/纵路/人行道各差 1cm 高度 + polygonOffset，杜绝 Z-fighting；
//  - 所有纹理 Canvas 程序化绘制（沥青 + 车道虚线 + 人行道砖缝）。
// ============================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { getHeight } from './terrain.js';
import { mulberry32 } from './city.js';

// ---------------- 程序化路面纹理 ----------------

/**
 * 沥青路面纹理（做旧版）：
 * 多尺度噪点底 + 裂纹 + 修补补丁 + 轮胎磨痕 + 油污 + 褪色断裂车道线
 * 纹理 V 方向沿道路前进方向，U 方向横跨路面宽度
 * @param {number} laneCount 车道虚线数量（城市路 1 条，高速 2 条）
 * @param {boolean} joints 是否画横向接缝（高速公路用）
 */
function makeRoadTexture(laneCount = 1, joints = false) {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');

  // ---- 沥青底色（两区块明暗略不同，模拟不同时期铺设） ----
  ctx.fillStyle = '#3a3a3c';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(0, 0, S, S / 2);
  // 大颗粒
  for (let i = 0; i < 900; i++) {
    const v = 50 + Math.random() * 30;
    ctx.fillStyle = `rgb(${v},${v},${v + 2})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  // 细颗粒（近看有沥青感）
  for (let i = 0; i < 1500; i++) {
    const v = 45 + Math.random() * 40;
    ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1, 1);
  }

  // ---- 修补补丁（更深的矩形块，边缘略亮） ----
  for (let i = 0; i < 3; i++) {
    const px = Math.random() * S * 0.7, py = Math.random() * S * 0.7;
    const pw = 15 + Math.random() * 25, ph = 10 + Math.random() * 20;
    ctx.fillStyle = 'rgba(20,20,22,0.5)';
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = 'rgba(70,70,72,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, pw, ph);
  }

  // ---- 裂纹（随机折线，深色细缝） ----
  ctx.strokeStyle = 'rgba(18,18,20,0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    let cx = Math.random() * S, cy = Math.random() * S;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let s = 0; s < 5; s++) {
      cx += (Math.random() - 0.5) * 24;
      cy += (Math.random() - 0.5) * 24;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // ---- 轮胎磨痕（两条纵向暗带，车轮位置） ----
  const track = ctx.createLinearGradient(0, 0, S, 0);
  track.addColorStop(0, 'rgba(0,0,0,0)');
  track.addColorStop(0.30, 'rgba(0,0,0,0)');
  track.addColorStop(0.36, 'rgba(15,15,16,0.28)');
  track.addColorStop(0.42, 'rgba(0,0,0,0)');
  track.addColorStop(0.58, 'rgba(0,0,0,0)');
  track.addColorStop(0.64, 'rgba(15,15,16,0.28)');
  track.addColorStop(0.70, 'rgba(0,0,0,0)');
  track.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = track;
  ctx.fillRect(0, 0, S, S);

  // ---- 油污（路心椭圆暗斑） ----
  for (let i = 0; i < 2; i++) {
    const ox = S / 2 + (Math.random() - 0.5) * 20;
    const oy = Math.random() * S;
    ctx.fillStyle = 'rgba(12,12,14,0.35)';
    ctx.beginPath();
    ctx.ellipse(ox, oy, 5 + Math.random() * 6, 8 + Math.random() * 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- 两侧边线（褪色磨损：透明度不一、局部断开） ----
  for (const lx of [4, S - 7]) {
    for (let v = 0; v < S; v += 4) {
      if (Math.random() < 0.15) continue; // 磨损缺口
      ctx.fillStyle = `rgba(195,195,188,${0.35 + Math.random() * 0.4})`;
      ctx.fillRect(lx, v, 3, 4);
    }
  }

  // ---- 车道虚线（每段虚实、长短、透明度都不同 → 褪色断裂感） ----
  const drawDashed = (u) => {
    for (let v = 0; v < S; v += 42) {
      const len = 16 + Math.random() * 10;      // 长度不一
      const alpha = 0.35 + Math.random() * 0.45; // 褪色程度不一
      ctx.fillStyle = `rgba(215,208,175,${alpha})`;
      ctx.fillRect(u - 2, v, 4, len);
    }
  };
  if (laneCount === 1) drawDashed(S / 2);
  else { drawDashed(S / 3); drawDashed((S / 3) * 2); }

  // ---- 高速横向接缝（桥头/板块接缝） ----
  if (joints) {
    ctx.fillStyle = 'rgba(15,15,17,0.6)';
    ctx.fillRect(0, 0, S, 2);
    ctx.fillStyle = 'rgba(200,200,195,0.25)';
    ctx.fillRect(0, 2, S, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * 人行道纹理（做旧版）：
 * 混凝土砖 + 每砖明暗差 + 裂缝 + 砖缝杂草 + 边缘尘土
 */
function makeSidewalkTexture() {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#8f8f8a';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 700; i++) {
    const v = 125 + Math.random() * 35;
    ctx.fillStyle = `rgba(${v},${v},${v - 3},0.6)`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }

  // 每块砖独立明暗（老化不均）
  for (let bx = 0; bx < S; bx += 32) {
    for (let bz = 0; bz < S; bz += 32) {
      const v = (Math.random() - 0.5) * 18;
      ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 250 : 5},${Math.abs(v) / 255})`;
      ctx.fillRect(bx, bz, 32, 32);
      // 破损砖：斜向裂缝
      if (Math.random() < 0.22) {
        ctx.strokeStyle = 'rgba(40,40,38,0.6)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(bx + Math.random() * 10, bz);
        ctx.lineTo(bx + 12 + Math.random() * 18, bz + 32);
        ctx.stroke();
      }
      // 砖角缺损
      if (Math.random() < 0.12) {
        ctx.fillStyle = 'rgba(50,48,45,0.5)';
        ctx.fillRect(bx + (Math.random() < 0.5 ? 0 : 28), bz + (Math.random() < 0.5 ? 0 : 28), 4, 4);
      }
    }
  }

  // 砖缝
  ctx.strokeStyle = 'rgba(58,58,55,0.7)';
  ctx.lineWidth = 2;
  for (let p = 0; p <= S; p += 32) {
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }

  // 砖缝杂草（十字交叉点的小簇绿色）
  for (let gx = 0; gx <= S; gx += 32) {
    for (let gz = 0; gz <= S; gz += 32) {
      if (Math.random() < 0.4) {
        for (let b = 0; b < 4; b++) {
          ctx.strokeStyle = `rgba(${60 + Math.random() * 30},${110 + Math.random() * 40},40,0.8)`;
          ctx.lineWidth = 1;
          const ang = Math.random() * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(gx, gz);
          ctx.lineTo(gx + Math.cos(ang) * 4, gz + Math.sin(ang) * 4);
          ctx.stroke();
        }
      }
    }
  }

  // 边缘尘土（一侧积土发黄）
  const dust = ctx.createLinearGradient(0, 0, 12, 0);
  dust.addColorStop(0, 'rgba(120,100,70,0.35)');
  dust.addColorStop(1, 'rgba(120,100,70,0)');
  ctx.fillStyle = dust;
  ctx.fillRect(0, 0, 12, S);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * 斑马线纹理：白色条纹 + 透明底（透出下面的沥青）
 * 条纹沿纹理 V 方向贯通，实例旋转后对齐车流方向
 */
function makeCrosswalkTexture() {
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(225,225,218,0.92)';
  for (let x = 2; x < S; x += 16) {
    ctx.fillRect(x, 0, 8, S);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ============================================================
// RoadNetwork — 路网生成器
// ============================================================
export class RoadNetwork {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'RoadNetwork';

    // 共享材质（全部路面合用，减少 draw call 开销）
    this.roadMat = new THREE.MeshStandardMaterial({
      map: makeRoadTexture(1),
      roughness: 0.92, metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, // 防与地面闪面
    });
    this.highwayMat = new THREE.MeshStandardMaterial({
      map: makeRoadTexture(2, true), // 高速带板块接缝
      roughness: 0.92, metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.sidewalkMat = new THREE.MeshStandardMaterial({
      map: makeSidewalkTexture(),
      roughness: 0.96, metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
  }

  /** 生成全部道路并加入场景 */
  build() {
    const c = CONFIG.world.city;
    const PITCH = 64;    // 路中心线间距（= 街区边长 46 + 路宽 12 + 两侧人行道 6）
    const ROAD_W = 12;   // 路面宽
    const SW_W = 3;      // 单侧人行道宽

    // 路网覆盖范围：±half（对齐到节距的整数倍）
    const half = Math.floor(c.radius / PITCH) * PITCH; // 半径260 → half=256
    const lines = Math.round(half / PITCH);            // 4 → 道路位于 -256..256 每隔 64m

    for (let k = -lines; k <= lines; k++) {
      const p = k * PITCH;
      // 横向路（沿 X 方向，位于 z = p）：人行道层（宽、低）+ 路面层（窄、高）
      this.group.add(this.makeRibbon('x', p, half, ROAD_W + SW_W * 2, this.sidewalkMat, 0.03, 6));
      this.group.add(this.makeRibbon('x', p, half, ROAD_W, this.roadMat, 0.06, 12));
      // 纵向路（沿 Z 方向，位于 x = p）：比横路再高 1cm，避免路口闪面
      this.group.add(this.makeRibbon('z', p, half, ROAD_W + SW_W * 2, this.sidewalkMat, 0.04, 6));
      this.group.add(this.makeRibbon('z', p, half, ROAD_W, this.roadMat, 0.07, 12));
    }

    // 郊区高速公路：沿 Z 方向，位于城市东侧 x = half + 150，双向车道，无人行道
    // 长度钳制在地图边界内（地图半宽 1024m）
    this.group.add(this.makeRibbon('z', half + 150, CONFIG.world.mapHalf - 24, 16, this.highwayMat, 0.06, 16));

    // 全部路口的斑马线（实例化，一次 draw call）
    this.buildCrosswalks(lines, PITCH);

    // 路面坑洼积水（低粗糙度反光斑，随机散布在城市道路上）
    this.buildPuddles(lines, PITCH);

    this.scene.add(this.group);
    return this;
  }

  /**
   * 在所有路口铺斑马线（每个路口 4 条，全部实例化一次绘制）
   * @param {number} lines 路网半格数
   * @param {number} PITCH 路网节距
   */
  buildCrosswalks(lines, PITCH) {
    const transforms = [];
    for (let i = -lines; i <= lines; i++) {
      for (let k = -lines; k <= lines; k++) {
        const ix = i * PITCH, iz = k * PITCH;
        // 横跨横路（斑马线与车流同向 = 沿 X），位于路口两侧
        transforms.push({ x: ix - 8, z: iz, ry: Math.PI / 2, sx: 12, sz: 3 });
        transforms.push({ x: ix + 8, z: iz, ry: Math.PI / 2, sx: 12, sz: 3 });
        // 横跨纵路（条纹沿 Z）
        transforms.push({ x: ix, z: iz - 8, ry: 0, sx: 3, sz: 12 });
        transforms.push({ x: ix, z: iz + 8, ry: 0, sx: 3, sz: 12 });
      }
    }

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map: makeCrosswalkTexture(),
      transparent: true,
      depthWrite: false, // 叠在路面上，不写深度防排序闪烁
      roughness: 0.9,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });

    const inst = new THREE.InstancedMesh(geo, mat, transforms.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
    transforms.forEach((t, i2) => {
      p.set(t.x, getHeight(t.x, t.z) + 0.085, t.z); // 高于路面层
      e.set(0, t.ry, 0); q.setFromEuler(e);
      s.set(t.sx, 1, t.sz);
      m.compose(p, q, s);
      inst.setMatrixAt(i2, m);
    });
    inst.receiveShadow = true;
    inst.instanceMatrix.needsUpdate = true;
    inst.matrixAutoUpdate = false;
    this.group.add(inst);
  }

  /**
   * 路面坑洼积水：低粗糙度反光斑，雨后城市路面的关键真实感
   * 随机散布在城市车道上，贴路面之上
   */
  buildPuddles(lines, PITCH) {
    const rand = mulberry32(CONFIG.world.seed ^ 0x9dd1e);
    const transforms = [];
    for (let k = -lines; k <= lines; k++) {
      const line = k * PITCH;
      for (let t = -lines * PITCH; t <= lines * PITCH; t += 20) {
        if (rand() < 0.16) {
          // 横路车道上
          const x = t + rand() * 12, z = line + (rand() - 0.5) * 7;
          transforms.push({ x, z, s: 0.8 + rand() * 2.2, ry: rand() * Math.PI });
        }
        if (rand() < 0.16) {
          // 纵路车道上
          const z = t + rand() * 12, x = line + (rand() - 0.5) * 7;
          transforms.push({ x, z, s: 0.8 + rand() * 2.2, ry: rand() * Math.PI });
        }
      }
    }
    if (!transforms.length) return;

    const geo = new THREE.CircleGeometry(1, 12);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2c3844,
      roughness: 0.06,   // 接近镜面 → 反射天空，湿路面感
      metalness: 0.25,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const inst = new THREE.InstancedMesh(geo, mat, transforms.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
    transforms.forEach((t, i) => {
      p.set(t.x, getHeight(t.x, t.z) + 0.09, t.z); // 高于路面与斑马线
      e.set(0, t.ry, 0); q.setFromEuler(e);
      s.set(t.s, 1, t.s * (0.6 + (i % 5) * 0.2)); // 椭圆感
      m.compose(p, q, s);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.matrixAutoUpdate = false;
    this.group.add(inst);
  }

  /**
   * 创建一条贴地的带状路面网格
   * @param {'x'|'z'} axis 道路延伸方向
   * @param {number} offset 道路中心线在另一轴上的坐标
   * @param {number} halfLen 半长（米）
   * @param {number} width 路面宽度（米）
   * @param {THREE.Material} material 材质
   * @param {number} yOff 离地高度偏移（防 Z-fighting 的分层）
   * @param {number} tileLen 纹理沿道路方向的平铺周期（米）
   */
  makeRibbon(axis, offset, halfLen, width, material, yOff, tileLen) {
    const SEG = 8; // 每 8 米采样一次地形高度
    const n = Math.max(2, Math.ceil((halfLen * 2) / SEG));
    const halfW = width / 2;

    const positions = new Float32Array((n + 1) * 2 * 3);
    const uvs = new Float32Array((n + 1) * 2 * 2);
    const indices = [];

    for (let i = 0; i <= n; i++) {
      const t = -halfLen + (i / n) * halfLen * 2; // 沿道路方向的坐标
      // 左右两个边缘点的世界坐标
      let x1, z1, x2, z2;
      if (axis === 'x') {
        x1 = t; z1 = offset - halfW;
        x2 = t; z2 = offset + halfW;
      } else {
        x1 = offset - halfW; z1 = t;
        x2 = offset + halfW; z2 = t;
      }
      const y1 = getHeight(x1, z1) + yOff;
      const y2 = getHeight(x2, z2) + yOff;

      const vi = i * 2;
      positions.set([x1, y1, z1], vi * 3);
      positions.set([x2, y2, z2], (vi + 1) * 3);

      // UV：U 横跨路面（0..1），V 沿道路按 tileLen 周期平铺
      const v = (t + halfLen) / tileLen;
      uvs.set([0, v], vi * 2);
      uvs.set([1, v], (vi + 1) * 2);

      if (i < n) {
        const a = vi, b = vi + 1, cIdx = vi + 2, d = vi + 3;
        indices.push(a, b, cIdx, b, d, cIdx);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;       // 路面接收建筑/树木阴影
    mesh.matrixAutoUpdate = false;   // 静态网格
    return mesh;
  }
}
