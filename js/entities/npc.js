// ============================================================
// npc.js — 路人 NPC 系统
//
// 内容：
//  1. 程序化低多边形行人（头/躯干/双臂/双腿，随机肤色衣色）；
//  2. 步行动画：四肢正弦摆动 + 身体起伏（程序化，无需动画文件）；
//  3. 行为：沿人行道行走，路口随机转向，遇障碍（玩家/同伴/
//     车辆）暂停避让；
//  4. 确定性生成：每次进入世界，同一批行人在同一路线上。
// ============================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { getHeight } from '../world/terrain.js';
import { mulberry32 } from '../world/city.js';
import { disposeObjectTree } from '../core/watchdog.js';

// 行人配色
const SKIN_COLORS = [0xd9b08c, 0xc89468, 0x8a5c3a, 0xe8c8a8];
const SHIRT_COLORS = [0x8a2a2a, 0x2a4a7a, 0x3a6a3a, 0xd0c8b8, 0x4a4a52, 0xb86a2a];
const PANTS_COLORS = [0x2a3242, 0x3a3a3a, 0x5a5248, 0x6a7a8a];
const HAIR_COLORS = [0x1c140e, 0x3a2a1a, 0x5a4a2a, 0x777777, 0x242424];

/** 创建一个行人网格，返回各肢体引用供动画使用（任务系统也会复用） */
export function createPedestrianMesh(rand) {
  const g = new THREE.Group();
  const skin = SKIN_COLORS[Math.floor(rand() * SKIN_COLORS.length)];
  const shirt = SHIRT_COLORS[Math.floor(rand() * SHIRT_COLORS.length)];
  const pants = PANTS_COLORS[Math.floor(rand() * PANTS_COLORS.length)];

  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });

  // 腿（以髋部为轴心摆动 → 几何体下沉半长）
  const legGeo = new THREE.BoxGeometry(0.16, 0.8, 0.18);
  legGeo.translate(0, -0.4, 0);
  const legL = new THREE.Mesh(legGeo, pantsMat);
  legL.position.set(-0.11, 0.85, 0);
  const legR = new THREE.Mesh(legGeo, pantsMat);
  legR.position.set(0.11, 0.85, 0);

  // 躯干
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.26), shirtMat);
  torso.position.y = 1.18;

  // 手臂（以肩部为轴心）
  const armGeo = new THREE.BoxGeometry(0.11, 0.62, 0.13);
  armGeo.translate(0, -0.31, 0);
  const armL = new THREE.Mesh(armGeo, shirtMat);
  armL.position.set(-0.3, 1.45, 0);
  const armR = new THREE.Mesh(armGeo, shirtMat);
  armR.position.set(0.3, 1.45, 0);

  // 头 + 头发（头顶贴一片深色盒，远处看就是发色）
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), skinMat);
  head.position.y = 1.66;
  const hair = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.1, 0.26),
    new THREE.MeshStandardMaterial({
      color: HAIR_COLORS[Math.floor(rand() * HAIR_COLORS.length)], roughness: 0.95,
    })
  );
  hair.position.y = 1.8;

  // 脚下接触影（人物"落地感"）
  const blobGeo = new THREE.CircleGeometry(0.32, 12);
  blobGeo.rotateX(-Math.PI / 2);
  const blob = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }));
  blob.position.y = 0.02;

  g.add(legL, legR, torso, armL, armR, head, hair, blob);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  return { group: g, legL, legR, armL, armR };
}

// ============================================================
// NPC — 单个行人
// ============================================================
class NPC {
  constructor(scene, rand) {
    const parts = createPedestrianMesh(rand);
    this.mesh = parts.group;
    this.parts = parts;
    // 身高体型差异（0.92 - 1.08 缩放，人群不再整齐划一）
    this.mesh.scale.setScalar(0.92 + rand() * 0.16);
    scene.add(this.mesh);

    // 行走路径：沿某条人行道直线（axis 方向，line ± 7.5 人行道）
    const PITCH = 64, GRID = 256;
    this.path = {
      axis: rand() < 0.5 ? 'x' : 'z',
      line: (Math.floor(rand() * 9) - 4) * PITCH + (rand() < 0.5 ? 7.5 : -7.5),
      dir: rand() < 0.5 ? 1 : -1,
      s: (rand() * 2 - 1) * GRID,
    };
    this.pos = new THREE.Vector3();
    this.walkPhase = rand() * Math.PI * 2; // 随机初始相位，行人不会齐步走
    this.pauseTimer = 0;
    this.rand = rand;
    this.knocked = false;      // 被车撞倒（通缉系统的犯罪证据）
    this.knockTimer = 0;
    this.syncPos();
  }

  /** 被车辆撞倒：平躺 18 秒后爬起继续走 */
  knock() {
    if (this.knocked) return;
    this.knocked = true;
    this.knockTimer = 18;
    this.mesh.rotation.x = -Math.PI / 2; // 向后倒地
    this.mesh.position.y = this.pos.y + 0.15;
  }

  /** 释放 GPU 资源并从场景移除（仅动态生成/销毁的 NPC 使用） */
  dispose() {
    disposeObjectTree(this.mesh);
  }

  /** 路径坐标 → 世界坐标 */
  syncPos() {
    const p = this.path;
    if (p.axis === 'x') { this.pos.x = p.s; this.pos.z = p.line; }
    else { this.pos.z = p.s; this.pos.x = p.line; }
    this.pos.y = getHeight(this.pos.x, this.pos.z);
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} playerPos 玩家位置（避让用）
   * @param {Array} cars 车辆数组（含 pos 和 speed，躲避快车用）
   * @param {Array} npcPositions 其他 NPC 位置
   */
  update(dt, playerPos, cars, npcPositions) {
    const N = CONFIG.npc;
    const p = this.path;

    // ---- 被撞倒状态：躺地计时，时间到爬起 ----
    if (this.knocked) {
      this.knockTimer -= dt;
      this.mesh.position.set(this.pos.x, this.pos.y + 0.15, this.pos.z);
      if (this.knockTimer <= 0) {
        this.knocked = false;
        this.mesh.rotation.x = 0;
      }
      return;
    }

    // ---- 躲车：附近有快速接近的车辆 → 向侧向闪避（视觉偏移，衰减回正） ----
    for (const car of cars) {
      const dCar = Math.hypot(car.pos.x - this.pos.x, car.pos.z - this.pos.z);
      if (dCar < 4.5 && Math.abs(car.speed) > 1.5) {
        this.dodge = Math.min(1, (this.dodge || 0) + dt * 5);
        // 闪避方向：垂直于车前进方向的两侧中较远一侧
        this.dodgeSign = this.dodgeSign || (this.rand() < 0.5 ? 1 : -1);
        break;
      }
    }
    this.dodge = Math.max(0, (this.dodge || 0) - dt * 1.2);

    // ---- 障碍检测：前方 1.6m 内有玩家/车辆/同伴 → 停下等待 ----
    let blocked = false;
    const aheadX = p.axis === 'x' ? this.pos.x + p.dir * 1.6 : this.pos.x;
    const aheadZ = p.axis === 'z' ? this.pos.z + p.dir * 1.6 : this.pos.z;
    if (Math.hypot(playerPos.x - aheadX, playerPos.z - aheadZ) < 1.1) blocked = true;
    if (!blocked) {
      for (const car of cars) {
        if (Math.hypot(car.pos.x - aheadX, car.pos.z - aheadZ) < 1.6) { blocked = true; break; }
      }
    }
    if (!blocked) {
      for (const o of npcPositions) {
        if (o === this.pos) continue;
        if (Math.hypot(o.x - aheadX, o.z - aheadZ) < 1.0) { blocked = true; break; }
      }
    }

    if (blocked) {
      // 站立：四肢缓慢回正
      this.pauseTimer += dt;
      const k = Math.max(0, 1 - dt * 8);
      this.parts.legL.rotation.x *= k;
      this.parts.legR.rotation.x *= k;
      this.parts.armL.rotation.x *= k;
      this.parts.armR.rotation.x *= k;
      return;
    }

    // ---- 前进 ----
    p.s += N.walkSpeed * p.dir * dt;

    // 路口随机换向（人行道横跨马路，模拟行人过街）
    const PITCH = 64, GRID = 256;
    const atCross = Math.abs(((p.s % PITCH) + PITCH) % PITCH) < N.walkSpeed * dt * 1.5;
    if (atCross && this.rand() < CONFIG.npc.turnChance) {
      const other = p.axis === 'x' ? this.pos.z : this.pos.x;
      const newLine = Math.round((other - 7.5 * Math.sign(other % PITCH || 1)) / PITCH) * PITCH;
      const side = this.rand() < 0.5 ? 7.5 : -7.5;
      if (Math.abs(newLine) <= GRID) {
        this.path = {
          axis: p.axis === 'x' ? 'z' : 'x',
          line: newLine + side,
          dir: this.rand() < 0.5 ? 1 : -1,
          s: p.axis === 'x' ? this.pos.x : this.pos.z,
        };
      }
    }
    // 走出城区折返
    if (Math.abs(this.path.s) > GRID + 10) this.path.dir *= -1;

    this.syncPos();

    // ---- 步行动画：四肢正弦摆动 + 身体起伏 ----
    this.walkPhase += N.walkSpeed * dt * 4.4;
    const swing = Math.sin(this.walkPhase);
    this.parts.legL.rotation.x = swing * 0.55;
    this.parts.legR.rotation.x = -swing * 0.55;
    this.parts.armL.rotation.x = -swing * 0.45;
    this.parts.armR.rotation.x = swing * 0.45;

    // ---- 应用到网格（朝向 = 行走方向，轻微上下起伏 + 躲车侧移） ----
    this.mesh.position.copy(this.pos);
    // 躲车侧移：垂直于行走方向偏移，dodge 平滑进出
    if (this.dodge > 0.01) {
      const side = (this.dodgeSign || 1) * this.dodge * 1.1;
      if (p.axis === 'x') this.mesh.position.z += side;
      else this.mesh.position.x += side;
    }
    this.mesh.position.y += Math.abs(Math.sin(this.walkPhase)) * 0.04;
    const heading = p.axis === 'x'
      ? (p.dir > 0 ? -Math.PI / 2 : Math.PI / 2)
      : (p.dir > 0 ? Math.PI : 0);
    this.mesh.rotation.y = heading;
  }
}

// ============================================================
// NPCManager
// ============================================================
// 稳定性参数：
//  MAX_NPCS        行人总数上限（数量与生成参数无关，防止低端机崩）
//  FREEZE_DIST     超过该距离的行人跳过 AI 计算（远看是静止的贴图）
//  HIDE_DIST       超过该距离直接隐藏网格（配合雾效，肉眼不可见）
const MAX_NPCS = 48;
const FREEZE_DIST = 240;
const HIDE_DIST = 300;

export class NPCManager {
  constructor(scene) {
    this.scene = scene;
    this.npcs = [];
  }

  spawnAll(count) {
    const rand = mulberry32(CONFIG.world.seed ^ 0x9c7);
    const total = Math.min(count, MAX_NPCS); // 数量上限：无论配置多少都钳制
    for (let i = 0; i < total; i++) {
      this.npcs.push(new NPC(this.scene, rand));
    }
  }

  /** cars：车辆数组（含 pos/speed），NPC 会避让快车 */
  update(dt, playerPos, cars) {
    const npcPositions = this.npcs.map((n) => n.pos);
    for (const npc of this.npcs) {
      const d = Math.hypot(npc.pos.x - playerPos.x, npc.pos.z - playerPos.z);
      // 远距隐藏：网格不可见时连绘制都省掉
      npc.mesh.visible = d < HIDE_DIST;
      if (d > FREEZE_DIST) continue; // 远距冻结：跳过 AI/动画计算
      npc.update(dt, playerPos, cars, npcPositions);
    }
  }
}
