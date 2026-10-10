// ============================================================
// props.js — 环境道具系统
//
// 街道：路灯、垃圾桶、长椅、消防栓、交通指示牌、绿化带、
//       行道树、停车场（地坪 + 车位线）、高速护栏
// 郊区：岩石、灌木丛、野树
//
// 全部 InstancedMesh 合批渲染；所有物件摆点时调用 getHeight()
// 采样地面高度，贴地放置，杜绝浮空/埋地。
// 摆放全部使用确定性随机（mulberry32），每次进入世界布局一致。
// ============================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { getHeight, getSlope, riverCenterX } from './terrain.js';
import { mulberry32 } from './city.js';

// 临时复用对象（避免循环内分配）
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();

/** 快速建一个 InstancedMesh 并加入组（cell>0 时按空间网格拆分成多个实例块，
 *  每块单独计算包围球 → 视锥外整片剔除，大场景 FPS 显著提升） */
function makeInstanced(group, geo, mat, transforms, { shadow = true, cell = 0 } = {}) {
  if (transforms.length === 0) return null;

  const build = (list) => {
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => {
      _p.set(t.x, t.y, t.z);
      _e.set(t.rx || 0, t.ry || 0, t.rz || 0);
      _q.setFromEuler(_e);
      _s.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1);
      _m.compose(_p, _q, _s);
      inst.setMatrixAt(i, _m);
    });
    inst.castShadow = shadow;
    inst.receiveShadow = true;
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere(); // 实例级包围球 → 视锥裁剪生效
    inst.matrixAutoUpdate = false;
    group.add(inst);
    return inst;
  };

  if (!cell) return build(transforms);

  const chunks = new Map();
  for (const t of transforms) {
    const k = Math.floor(t.x / cell) + ',' + Math.floor(t.z / cell);
    if (!chunks.has(k)) chunks.set(k, []);
    chunks.get(k).push(t);
  }
  let first = null;
  for (const sub of chunks.values()) first = build(sub) || first;
  return first; // 返回第一个块（材质共享，供路灯 emissive 等统一控制）
}

/** 停车场地面纹理：沥青 + 白色车位线 */
function makeParkingTexture() {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3d3d3f';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 1200; i++) {
    const v = 55 + Math.random() * 25;
    ctx.fillStyle = `rgb(${v},${v},${v + 2})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  // 车位线：横向两排
  ctx.strokeStyle = 'rgba(220,220,210,0.85)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= S; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, 100); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, 156); ctx.lineTo(x, 248); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(0, 100); ctx.lineTo(S, 100); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 156); ctx.lineTo(S, 156); ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ============================================================
// PropsGenerator
// ============================================================
export class PropsGenerator {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Props';
  }

  /**
   * @param {{emptyBlocks: Array}} opts 城市生成器提供的空街区（停车场用地）
   */
  build({ emptyBlocks = [] } = {}) {
    this.buildStreetLights();
    this.buildStreetFurniture();
    this.buildGreenery();
    this.buildGuardrails();
    this.buildParkingLots(emptyBlocks);
    this.buildRocksAndBushes();
    this.buildPowerLines();
    this.buildManholesAndCones();
    this.buildGrassTufts();
    this.buildSuburbClutter();
    this.scene.add(this.group);
    return this;
  }

  // ---------------- 路灯（沿城市路网双侧等距） ----------------
  buildStreetLights() {
    const c = CONFIG.world.city;
    const PITCH = 64;
    const lines = Math.floor(c.radius / PITCH);
    const half = lines * PITCH;
    const rand = mulberry32(CONFIG.world.seed ^ 0x1a9);

    const poles = [], heads = [];
    const OFFSET = 7.6;  // 人行道边
    const SPACING = 32;

    for (let k = -lines; k <= lines; k++) {
      const line = k * PITCH;
      for (let t = -half; t <= half; t += SPACING) {
        // 横路两侧（灯头朝路面）
        for (const side of [-1, 1]) {
          const x = t + (side > 0 ? SPACING / 2 : 0); // 两侧交错
          const z = line + OFFSET * side;
          poles.push({ x, y: getHeight(x, z) + 3, z, s: 1 });
          heads.push({ x, y: getHeight(x, z) + 6.05, z: z - 1.2 * side, ry: side > 0 ? 0 : Math.PI });
        }
        // 纵路两侧
        for (const side of [-1, 1]) {
          const z = t + (side > 0 ? SPACING / 2 : 0);
          const x = line + OFFSET * side;
          poles.push({ x, y: getHeight(x, z) + 3, z, s: 1 });
          heads.push({ x: x - 1.2 * side, y: getHeight(x, z) + 6.05, z, ry: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
        }
      }
    }

    // 灯杆（6m 圆柱）
    makeInstanced(this.group,
      new THREE.CylinderGeometry(0.09, 0.12, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.6, metalness: 0.6 }),
      poles, { cell: 160 });
    // 灯头（悬臂小盒；emissive 强度由时间系统控制，白天微亮、夜晚全亮）
    this.lampHeadMat = new THREE.MeshStandardMaterial({
      color: 0x2c3034, roughness: 0.5, metalness: 0.5,
      emissive: 0xffd890, emissiveIntensity: 0.15,
    });
    makeInstanced(this.group,
      new THREE.BoxGeometry(0.5, 0.18, 2.2),
      this.lampHeadMat,
      heads, { cell: 160 });
  }

  // ---------------- 街道家具：垃圾桶 / 长椅 / 消防栓 / 指示牌 ----------------
  buildStreetFurniture() {
    const c = CONFIG.world.city;
    const PITCH = 64;
    const lines = Math.floor(c.radius / PITCH);
    const half = lines * PITCH;
    const rand = mulberry32(CONFIG.world.seed ^ 0xf42);

    const bins = [], benches = [], hydrants = [], signPoles = [], signPlates = [];
    const OFFSET = 7.4;

    for (let k = -lines; k <= lines; k++) {
      const line = k * PITCH;
      for (let t = -half; t <= half; t += 16) {
        const r = rand();
        if (r < 0.12) { // 垃圾桶
          const x = t, z = line + OFFSET * (rand() < 0.5 ? 1 : -1);
          bins.push({ x, y: getHeight(x, z) + 0.45, z });
        } else if (r < 0.2) { // 长椅
          const x = t, z = line + OFFSET * (rand() < 0.5 ? 1 : -1);
          const ry = z > line ? Math.PI : 0;
          benches.push({ x, y: getHeight(x, z), z, ry });
        } else if (r < 0.26) { // 消防栓
          const x = t, z = line + OFFSET * (rand() < 0.5 ? 1 : -1);
          hydrants.push({ x, y: getHeight(x, z), z });
        }
        // 纵路同样撒一些
        const r2 = rand();
        if (r2 < 0.12) {
          const z = t, x = line + OFFSET * (rand() < 0.5 ? 1 : -1);
          bins.push({ x, y: getHeight(x, z) + 0.45, z });
        } else if (r2 < 0.2) {
          const z = t, x = line + OFFSET * (rand() < 0.5 ? 1 : -1);
          benches.push({ x, y: getHeight(x, z), z, ry: x > line ? -Math.PI / 2 : Math.PI / 2 });
        }
      }
      // 每个路口四个角随机放交通指示牌
      for (let t = -lines; t <= lines; t++) {
        if (rand() < 0.55) {
          const cross = t * PITCH;
          const sx = line + 8.5 * (rand() < 0.5 ? 1 : -1);
          const sz = cross + 8.5 * (rand() < 0.5 ? 1 : -1);
          const y = getHeight(sx, sz);
          signPoles.push({ x: sx, y: y + 1.4, z: sz });
          signPlates.push({ x: sx, y: y + 2.6, z: sz, ry: rand() * Math.PI });
        }
      }
    }

    // 垃圾桶（深绿圆柱）
    makeInstanced(this.group,
      new THREE.CylinderGeometry(0.32, 0.28, 0.9, 8),
      new THREE.MeshStandardMaterial({ color: 0x2e4a34, roughness: 0.8, metalness: 0.2 }),
      bins, { cell: 160 });
    // 长椅：座板 + 靠背 + 双腿片合并为一个几何体（一次实例化）
    {
      const seat = new THREE.BoxGeometry(1.8, 0.08, 0.55); seat.translate(0, 0.45, 0);
      const back = new THREE.BoxGeometry(1.8, 0.5, 0.08); back.translate(0, 0.68, -0.24);
      const legL = new THREE.BoxGeometry(0.08, 0.45, 0.5); legL.translate(-0.75, 0.225, 0);
      const legR = new THREE.BoxGeometry(0.08, 0.45, 0.5); legR.translate(0.75, 0.225, 0);
      makeInstanced(this.group,
        mergeGeometries([seat, back, legL, legR]),
        new THREE.MeshStandardMaterial({ color: 0x7a5c38, roughness: 0.85 }),
        benches, { cell: 160 });
    }
    // 消防栓：柱身 + 顶部圆帽 + 侧向接口，合并几何
    {
      const body = new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8); body.translate(0, 0.35, 0);
      const cap = new THREE.SphereGeometry(0.15, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2); cap.translate(0, 0.7, 0);
      const sideA = new THREE.CylinderGeometry(0.06, 0.06, 0.22, 6);
      sideA.rotateZ(Math.PI / 2); sideA.translate(-0.22, 0.42, 0);
      const sideB = sideA.clone(); sideB.translate(0.44, 0, 0);
      makeInstanced(this.group,
        mergeGeometries([body, cap, sideA, sideB]),
        new THREE.MeshStandardMaterial({ color: 0xb8281e, roughness: 0.5, metalness: 0.3 }),
        hydrants, { cell: 160 });
    }
    // 指示牌：杆 + 牌面
    makeInstanced(this.group,
      new THREE.CylinderGeometry(0.05, 0.05, 2.8, 6),
      new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.5, metalness: 0.6 }),
      signPoles, { cell: 160 });
    makeInstanced(this.group,
      new THREE.BoxGeometry(0.7, 0.7, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x1e5aa8, roughness: 0.4, metalness: 0.2 }),
      signPlates, { cell: 160 });
  }

  // ---------------- 绿化：行道树 + 绿篱 ----------------
  buildGreenery() {
    const c = CONFIG.world.city;
    const PITCH = 64;
    const lines = Math.floor(c.radius / PITCH);
    const half = lines * PITCH;
    const rand = mulberry32(CONFIG.world.seed ^ 0x7eee);

    const trunks = [], canopies = [], hedges = [];

    // 行道树：沿人行道外侧，约 24m 一棵
    for (let k = -lines; k <= lines; k++) {
      const line = k * PITCH;
      for (let t = -half; t <= half; t += 24) {
        if (rand() < 0.7) {
          const x = t + rand() * 6, z = line + 9.5 * (rand() < 0.5 ? 1 : -1);
          this.addTree(trunks, canopies, x, z, 0.8 + rand() * 0.5, rand);
        }
        if (rand() < 0.7) {
          const z = t + rand() * 6, x = line + 9.5 * (rand() < 0.5 ? 1 : -1);
          this.addTree(trunks, canopies, x, z, 0.8 + rand() * 0.5, rand);
        }
        // 绿篱（绿化带）：随机一小段
        if (rand() < 0.25) {
          const x = t, z = line + 9.2 * (rand() < 0.5 ? 1 : -1);
          hedges.push({ x, y: getHeight(x, z) + 0.4, z, sx: 3 + rand() * 3, sy: 0.8, sz: 0.8, ry: 0 });
        }
      }
    }

    // 郊野散布树木
    let placed = 0, tries = 0;
    while (placed < 350 && tries < 2000) {
      tries++;
      const x = (rand() * 2 - 1) * 850;
      const z = (rand() * 2 - 1) * 850;
      const dCity = Math.hypot(x, z);
      if (dCity < c.radius * 1.1) continue;              // 城内只放行道树
      if (getSlope(x, z) > 0.5) continue;                // 太陡不长树
      const h = getHeight(x, z);
      if (h < 0.5) continue;                             // 水里/河床不长
      if (Math.abs(x - riverCenterX(z)) < 30) continue;  // 河道留空
      this.addTree(trunks, canopies, x, z, 0.9 + rand() * 0.9, rand);
      placed++;
    }

    makeInstanced(this.group,
      new THREE.CylinderGeometry(0.14, 0.2, 2.6, 6),
      new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.95 }),
      trunks, { cell: 160 });
    makeInstanced(this.group,
      new THREE.IcosahedronGeometry(1.6, 1),
      new THREE.MeshStandardMaterial({ color: 0x3d6b2a, roughness: 0.9, flatShading: true }),
      canopies, { cell: 160 });
    makeInstanced(this.group,
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x3a6630, roughness: 0.95 }),
      hedges, { cell: 160 });
  }

  /** 登记一棵树：树干 + 多球体树冠（2-3 团叠加，更接近真实树形） */
  addTree(trunks, canopies, x, z, s, rand) {
    const y = getHeight(x, z);
    trunks.push({ x, y: y + 1.3 * s, z, sx: s, sy: s, sz: s });
    // 主树冠
    canopies.push({
      x, y: y + (2.6 + 1.2) * s, z,
      sx: s * (0.9 + rand() * 0.3), sy: s * (0.9 + rand() * 0.4), sz: s * (0.9 + rand() * 0.3),
      ry: rand() * Math.PI,
    });
    // 1-2 团偏移的副树冠（不规则的团状轮廓）
    const n = 1 + (rand() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const ang = rand() * Math.PI * 2;
      const r = (0.5 + rand() * 0.4) * s;
      canopies.push({
        x: x + Math.cos(ang) * r, y: y + (3.2 + rand() * 0.8) * s, z: z + Math.sin(ang) * r,
        sx: s * (0.45 + rand() * 0.3), sy: s * (0.4 + rand() * 0.3), sz: s * (0.45 + rand() * 0.3),
        ry: rand() * Math.PI,
      });
    }
  }

  // ---------------- 高速护栏 ----------------
  buildGuardrails() {
    const c = CONFIG.world.city;
    const highwayX = Math.floor(c.radius / 64) * 64 + 150;
    const rails = [];
    for (let z = -1000; z <= 1000; z += 4) {
      for (const side of [-1, 1]) {
        const x = highwayX + 8.6 * side;
        // 护栏高 0.7m，中心放 0.35m 处恰好落地
        rails.push({ x, y: getHeight(x, z) + 0.35, z, sx: 0.12, sy: 0.7, sz: 4.05 });
      }
    }
    makeInstanced(this.group,
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.7 }),
      rails, { shadow: false, cell: 192 }); // 数量多且矮，不投影省性能
  }

  // ---------------- 停车场（空街区 → 地坪 + 车位线） ----------------
  buildParkingLots(emptyBlocks) {
    const tex = makeParkingTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.92,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    for (const b of emptyBlocks) {
      const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
      const geo = new THREE.PlaneGeometry(w, d);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(b.cx, getHeight(b.cx, b.cz) + 0.05, b.cz);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
    }
  }

  // ---------------- 电线杆 + 电线（城市天际线的关键细节） ----------------
  buildPowerLines() {
    const c = CONFIG.world.city;
    const PITCH = 64;
    const lines = Math.floor(c.radius / PITCH);
    const half = lines * PITCH;
    const rand = mulberry32(CONFIG.world.seed ^ 0x9e7e);

    const poles = [], crossarms = [], wires = [];
    const OFFSET = 9.2;  // 人行道外侧
    const SPACING = 32;

    for (let k = -lines; k <= lines; k++) {
      const line = k * PITCH;
      // 每条路的北侧/西侧一侧布杆（不要两侧都有，避免杂乱）
      // 横路（沿 X）
      {
        const side = (k % 2 === 0) ? 1 : -1;
        let prevY = null, prevX = null;
        for (let t = -half; t <= half; t += SPACING) {
          const x = t, z = line + OFFSET * side;
          const y = getHeight(x, z);
          poles.push({ x, y: y + 3.5, z });
          crossarms.push({ x, y: y + 6.6, z, ry: Math.PI / 2 }); // 横担垂直于线路
          if (prevY !== null) {
            // 两档电线（直线近似，远处看不出弧垂缺失）
            const mx = (prevX + x) / 2, mz = (prevY.z + z) / 2;
            const my = (prevY.y + y) / 2 + 6.6;
            const len = Math.hypot(x - prevX, z - prevY.z);
            wires.push({ x: mx, y: my, z: mz - 0.3, sx: len, ry: 0 });
            wires.push({ x: mx, y: my, z: mz + 0.3, sx: len, ry: 0 });
          }
          prevY = { y, z }; prevX = x;
        }
      }
      // 纵路（沿 Z）
      {
        const side = (k % 2 === 0) ? 1 : -1;
        let prevY = null, prevZ = null;
        for (let t = -half; t <= half; t += SPACING) {
          const z = t, x = line + OFFSET * side;
          const y = getHeight(x, z);
          poles.push({ x, y: y + 3.5, z });
          crossarms.push({ x, y: y + 6.6, z, ry: 0 }); // 横担垂直于线路
          if (prevY !== null) {
            const mx = (prevY.x + x) / 2, mz = (prevZ + z) / 2;
            const my = (prevY.y + y) / 2 + 6.6;
            const len = Math.hypot(z - prevZ, x - prevY.x);
            wires.push({ x: mx - 0.3, y: my, z: mz, sx: len, ry: Math.PI / 2 });
            wires.push({ x: mx + 0.3, y: my, z: mz, sx: len, ry: Math.PI / 2 });
          }
          prevY = { y, x }; prevZ = z;
        }
      }
    }

    // 水泥电线杆（7m）
    makeInstanced(this.group,
      new THREE.CylinderGeometry(0.12, 0.16, 7, 7),
      new THREE.MeshStandardMaterial({ color: 0x7a766e, roughness: 0.9 }),
      poles, { cell: 192 });
    // 横担
    makeInstanced(this.group,
      new THREE.BoxGeometry(1.4, 0.1, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x5a564e, roughness: 0.85 }),
      crossarms, { cell: 192 });
    // 电线（细长盒代替，黑色）
    makeInstanced(this.group,
      new THREE.BoxGeometry(1, 0.03, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.7 }),
      wires, { shadow: false, cell: 192 });
  }

  // ---------------- 井盖 + 交通锥 ----------------
  buildManholesAndCones() {
    const c = CONFIG.world.city;
    const PITCH = 64;
    const lines = Math.floor(c.radius / PITCH);
    const half = lines * PITCH;
    const rand = mulberry32(CONFIG.world.seed ^ 0x4a1f);

    // 井盖：路面上的深色圆片
    const holes = [];
    for (let k = -lines; k <= lines; k++) {
      const line = k * PITCH;
      for (let t = -half; t <= half; t += 40) {
        if (rand() < 0.5) holes.push({ x: t + rand() * 10, z: line + (rand() - 0.5) * 6, ry: 0 });
        if (rand() < 0.5) holes.push({ x: line + (rand() - 0.5) * 6, z: t + rand() * 10, ry: 0 });
      }
    }
    {
      const geo = new THREE.CircleGeometry(0.45, 12);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2a2a2c, roughness: 0.55, metalness: 0.5,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      });
      const inst = new THREE.InstancedMesh(geo, mat, holes.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      const p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
      holes.forEach((h, i) => {
        p.set(h.x, getHeight(h.x, h.z) + 0.082, h.z);
        e.set(0, h.ry, 0); q.setFromEuler(e);
        m.compose(p, q, s);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.matrixAutoUpdate = false;
      inst.computeBoundingSphere();
      this.group.add(inst);
    }

    // 交通锥：部分路口施工感（锥体 + 白色反光环）
    const cones = [];
    for (let i = 0; i < 30; i++) {
      const ix = (Math.floor(rand() * 9) - 4) * PITCH + (rand() - 0.5) * 10;
      const iz = (Math.floor(rand() * 9) - 4) * PITCH + (rand() - 0.5) * 10;
      cones.push({ x: ix, z: iz, n: 1 + Math.floor(rand() * 3) });
    }
    const coneTransforms = [];
    for (const c0 of cones) {
      for (let i = 0; i < c0.n; i++) {
        coneTransforms.push({
          x: c0.x + (rand() - 0.5) * 2, z: c0.z + (rand() - 0.5) * 2,
        });
      }
    }
    {
      const body = new THREE.ConeGeometry(0.16, 0.5, 10); body.translate(0, 0.25, 0);
      const band = new THREE.CylinderGeometry(0.11, 0.13, 0.1, 10); band.translate(0, 0.28, 0);
      const geo = mergeGeometries([body, band]);
      const mat = new THREE.MeshStandardMaterial({ color: 0xd05818, roughness: 0.6 });
      const inst = new THREE.InstancedMesh(geo, mat, coneTransforms.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      const p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      coneTransforms.forEach((t, i) => {
        p.set(t.x, getHeight(t.x, t.z), t.z);
        m.compose(p, q, s);
        inst.setMatrixAt(i, m);
      });
      inst.castShadow = true;
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.matrixAutoUpdate = false;
      this.group.add(inst);
    }
  }

  // ---------------- 草丛（交叉面片，郊野与空地的主要自然细节） ----------------
  buildGrassTufts() {
    const c = CONFIG.world.city;
    const rand = mulberry32(CONFIG.world.seed ^ 0x6a55);
    const highwayX = Math.floor(c.radius / 64) * 64 + 150;

    // 草叶簇纹理（几片叶子的 alpha 贴图）
    const S = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    for (let b = 0; b < 9; b++) {
      const bx = 8 + Math.random() * (S - 16);
      const green = 90 + Math.random() * 70;
      ctx.strokeStyle = `rgb(${green * 0.55 | 0},${green | 0},${green * 0.4 | 0})`;
      ctx.lineWidth = 2 + Math.random() * 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, S);
      ctx.quadraticCurveTo(bx + (Math.random() - 0.5) * 14, S * 0.5, bx + (Math.random() - 0.5) * 20, Math.random() * S * 0.4);
      ctx.stroke();
    }
    const grassTex = new THREE.CanvasTexture(canvas);
    grassTex.colorSpace = THREE.SRGBColorSpace;

    // 两个交叉面片
    const p1 = new THREE.PlaneGeometry(1, 0.6); p1.translate(0, 0.3, 0);
    const p2 = p1.clone(); p2.rotateY(Math.PI / 2);
    const geo = mergeGeometries([p1, p2]);
    const mat = new THREE.MeshStandardMaterial({
      map: grassTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.95,
    });

    // 草丛独立子组（O 键画质面板可整体开关）
    this.grassGroup = new THREE.Group();
    this.grassGroup.name = 'GrassTufts';
    this.group.add(this.grassGroup);

    const transforms = [];
    let tries = 0;
    while (transforms.length < 2600 && tries < 20000) {
      tries++;
      const x = (rand() * 2 - 1) * 950;
      const z = (rand() * 2 - 1) * 950;
      const h = getHeight(x, z);
      if (h < 0.4) continue;                               // 水里不长
      if (getSlope(x, z) > 0.4) continue;
      if (Math.abs(x - riverCenterX(z)) < 26) continue;    // 河道留空
      if (Math.abs(x - highwayX) < 12) continue;           // 高速留空
      const dCity = Math.hypot(x, z);
      // 城区内只长在留空街区（公园感）与路缘，城外到处长
      if (dCity < c.radius * 1.05 && rand() < 0.75) continue;
      transforms.push({
        x, y: h - 0.02, z,
        s: 0.7 + rand() * 0.9, ry: rand() * Math.PI,
      });
    }
    makeInstanced(this.grassGroup, geo, mat, transforms, { shadow: false, cell: 192 });
  }

  // ---------------- 郊区杂物：破旧围墙 / 垃圾堆 / 旧轮胎 ----------------
  buildSuburbClutter() {
    const c = CONFIG.world.city;
    const rand = mulberry32(CONFIG.world.seed ^ 0xc1a1);

    // 破旧围墙（城郊矮房周边，部分倾斜）
    const walls = [];
    for (let i = 0; i < 60; i++) {
      const ang = rand() * Math.PI * 2;
      const r = c.radius + 30 + rand() * 200;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (getSlope(x, z) > 0.4) continue;
      walls.push({
        x, y: getHeight(x, z) + 0.6, z,
        sx: 3 + rand() * 3, sy: 1.2, sz: 0.18,
        ry: rand() * Math.PI, rz: (rand() - 0.5) * 0.08, // 轻微歪斜
      });
    }
    makeInstanced(this.group,
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.95 }),
      walls, { cell: 192 });

    // 垃圾堆（深色压扁堆块，街角/巷尾）
    const junk = [];
    for (let i = 0; i < 45; i++) {
      const inCity = rand() < 0.5;
      let x, z;
      if (inCity) {
        const line = (Math.floor(rand() * 9) - 4) * 64;
        x = (rand() * 2 - 1) * 240; z = line + 10.5 * (rand() < 0.5 ? 1 : -1);
      } else {
        const ang = rand() * Math.PI * 2;
        const r = c.radius + 40 + rand() * 180;
        x = Math.cos(ang) * r; z = Math.sin(ang) * r;
      }
      junk.push({
        x, y: getHeight(x, z) + 0.15, z,
        sx: 0.7 + rand() * 0.8, sy: 0.3 + rand() * 0.3, sz: 0.7 + rand() * 0.8,
        ry: rand() * Math.PI,
      });
    }
    makeInstanced(this.group,
      new THREE.DodecahedronGeometry(0.5, 0),
      new THREE.MeshStandardMaterial({ color: 0x3a3733, roughness: 0.95, flatShading: true }),
      junk, { cell: 192 });

    // 旧轮胎（黑色圆环，郊区/路边）
    const tires = [];
    for (let i = 0; i < 25; i++) {
      const ang = rand() * Math.PI * 2;
      const r = c.radius + 20 + rand() * 260;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      tires.push({
        x, y: getHeight(x, z) + 0.15, z,
        rx: Math.PI / 2 + (rand() - 0.5) * 0.6, ry: rand() * Math.PI,
      });
    }
    makeInstanced(this.group,
      new THREE.TorusGeometry(0.32, 0.13, 8, 14),
      new THREE.MeshStandardMaterial({ color: 0x1e1e20, roughness: 0.95 }),
      tires, { cell: 192 });
  }
  buildRocksAndBushes() {
    const c = CONFIG.world.city;
    const rand = mulberry32(CONFIG.world.seed ^ 0x90c5);
    const rocks = [], bushes = [];

    let placed = 0, tries = 0;
    while (placed < 260 && tries < 3000) {
      tries++;
      const x = (rand() * 2 - 1) * 950;
      const z = (rand() * 2 - 1) * 950;
      if (Math.hypot(x, z) < c.radius * 1.05) continue;
      if (Math.abs(x - riverCenterX(z)) < 26) continue;
      const slope = getSlope(x, z);
      const h = getHeight(x, z);
      if (h < 0.3) continue;
      // 岩石偏爱陡坡和山地，灌木偏爱平缓草地
      if (slope > 0.3 && rand() < 0.75) {
        rocks.push({
          x, y: h + 0.1, z,
          sx: 0.5 + rand() * 1.8, sy: 0.4 + rand() * 1.2, sz: 0.5 + rand() * 1.8,
          ry: rand() * Math.PI,
        });
        placed++;
      } else if (slope <= 0.35) {
        bushes.push({
          x, y: h + 0.25, z,
          sx: 0.6 + rand() * 1.0, sy: 0.5 + rand() * 0.6, sz: 0.6 + rand() * 1.0,
          ry: rand() * Math.PI,
        });
        placed++;
      }
    }

    makeInstanced(this.group,
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.95, flatShading: true }),
      rocks, { cell: 192 });
    makeInstanced(this.group,
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: 0x4a7038, roughness: 0.95, flatShading: true }),
      bushes, { cell: 192 });
  }
}
