// ============================================================
// vehicle.js — 车辆系统
//
// 内容：
//  1. 程序化 GTA 风格家用轿车（车身 + 座舱 + 四轮 + 车灯）；
//  2. 交通 AI：沿路网车道自动行驶，路口随机转向，边界掉头；
//  3. 玩家驾驶：街机式物理（油门/刹车/转向/滑行），
//     与建筑 AABB 碰撞减速，车身随地形俯仰/侧倾；
//  4. 多车型扩展：CAR_TYPES 里加一款配置即可生成新车型。
//
// 物理模型参考成熟做法：速度标量 + 航向角 + 摩擦衰减 +
// 帧率无关阻尼追尾相机（相机部分在 player/camera.js）。
// ============================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { getHeight } from '../world/terrain.js';
import { mulberry32 } from '../world/city.js';
import { disposeObjectTree } from '../core/watchdog.js';

// ---------------- 车型配置表（扩展点：加一项 = 新车型） ----------------
export const CAR_TYPES = {
  sedan: {  // 家用轿车
    bodyW: 1.85, bodyH: 0.55, bodyL: 4.4,
    cabinW: 1.65, cabinH: 0.5, cabinL: 2.1, cabinOffset: -0.25,
    wheelR: 0.34, wheelW: 0.26, wheelBase: 1.5, wheelTrack: 0.88,
    maxSpeedScale: 1.0,
  },
  hatchback: { // 小两厢（更短更矮，预留示例）
    bodyW: 1.75, bodyH: 0.6, bodyL: 3.7,
    cabinW: 1.6, cabinH: 0.55, cabinL: 1.9, cabinOffset: -0.1,
    wheelR: 0.31, wheelW: 0.24, wheelBase: 1.25, wheelTrack: 0.82,
    maxSpeedScale: 0.9,
  },
  sport: {   // 跑车（更低更长，极速高 —— 车行出售）
    bodyW: 1.9, bodyH: 0.45, bodyL: 4.5,
    cabinW: 1.6, cabinH: 0.42, cabinL: 1.9, cabinOffset: 0.15,
    wheelR: 0.32, wheelW: 0.3, wheelBase: 1.55, wheelTrack: 0.92,
    maxSpeedScale: 1.45,
  },
};

// GTA 式车身配色
const CAR_COLORS = [0xc0c4c8, 0x1e1e22, 0x8a1f1f, 0x1f3a6e, 0x4a4d52, 0xb8a888, 0x2a5a3a, 0x7a7f86];

/**
 * 程序化轿车网格（一次构建，克隆复用）
 * @param {string} type CAR_TYPES 键名
 * @param {number} color 车身颜色
 */
export function createCarMesh(type = 'sedan', color = 0xc0c4c8) {
  const T = CAR_TYPES[type] || CAR_TYPES.sedan;
  const g = new THREE.Group();

  // 车身（清漆层车漆：底色 + 表面清漆高光，真实汽车漆面层次）
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.38, metalness: 0.5,
    clearcoat: 0.7, clearcoatRoughness: 0.22,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(T.bodyW, T.bodyH, T.bodyL), bodyMat);
  body.position.y = T.wheelR + T.bodyH / 2;
  g.add(body);

  // 座舱（深色玻璃：低粗糙度高金属感 → 反射天空）
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x141a20, roughness: 0.08, metalness: 0.75 });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(T.cabinW, T.cabinH, T.cabinL), glassMat);
  cabin.position.set(0, T.wheelR + T.bodyH + T.cabinH / 2 - 0.05, T.cabinOffset);
  g.add(cabin);

  // 四轮（轮胎 + 浅灰轮毂盖）
  const wheelGeo = new THREE.CylinderGeometry(T.wheelR, T.wheelR, T.wheelW, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.9 });
  const hubGeo = new THREE.CylinderGeometry(T.wheelR * 0.55, T.wheelR * 0.55, T.wheelW + 0.02, 10);
  hubGeo.rotateZ(Math.PI / 2);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x8a8e92, roughness: 0.35, metalness: 0.7 });
  const wheels = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(sx * T.wheelTrack, T.wheelR, sz * T.wheelBase);
      g.add(w);
      wheels.push(w);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.position.copy(w.position);
      g.add(hub);
      wheels.push(hub); // 轮毂随车轮一起滚动
    }
  }

  // 底盘接触影（软阴影贴地，车辆"落地感"的关键）
  {
    const shadowGeo = new THREE.CircleGeometry(1, 16);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const blob = new THREE.Mesh(shadowGeo, shadowMat);
    blob.scale.set(T.bodyW * 0.75, 1, T.bodyL * 0.62);
    blob.position.y = 0.02;
    g.add(blob);
  }

  // 前后保险杠（深灰塑料包覆件）
  const bumperMat = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.6, metalness: 0.2 });
  for (const sz of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(T.bodyW + 0.08, 0.2, 0.28), bumperMat);
    b.position.set(0, T.wheelR + 0.14, sz * (T.bodyL / 2 + 0.06));
    g.add(b);
  }
  // 前格栅（黑色网状感）
  const grille = new THREE.Mesh(new THREE.BoxGeometry(T.bodyW * 0.5, 0.16, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.5, metalness: 0.3 }));
  grille.position.set(0, T.wheelR + T.bodyH * 0.75, -T.bodyL / 2 - 0.03);
  g.add(grille);
  // 后牌照
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.03),
    new THREE.MeshStandardMaterial({ color: 0xd8d8cc, roughness: 0.6 }));
  plate.position.set(0, T.wheelR + T.bodyH * 0.45, T.bodyL / 2 + 0.15);
  g.add(plate);
  // 左右侧后视镜
  const mirrorMat = new THREE.MeshStandardMaterial({ color: 0x1e2022, roughness: 0.4, metalness: 0.4 });
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.12), mirrorMat);
    m.position.set(sx * (T.bodyW / 2 + 0.08), T.wheelR + T.bodyH + 0.12, T.cabinOffset - T.cabinL / 2 - 0.05);
    g.add(m);
  }

  // 车灯：前白后红（emissive 提亮；夜间由昼夜系统增强为"开大灯"）
  const frontMat = new THREE.MeshStandardMaterial({ color: 0xf0ead0, emissive: 0x555040, roughness: 0.3 });
  const rearMat = new THREE.MeshStandardMaterial({ color: 0xa02020, emissive: 0x400808, roughness: 0.3 });
  for (const sx of [-1, 1]) {
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.06), frontMat);
    fl.position.set(sx * (T.bodyW / 2 - 0.35), T.wheelR + T.bodyH * 0.7, -T.bodyL / 2 - 0.01);
    g.add(fl);
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.06), rearMat);
    rl.position.set(sx * (T.bodyW / 2 - 0.35), T.wheelR + T.bodyH * 0.7, T.bodyL / 2 + 0.01);
    g.add(rl);
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return { group: g, wheels, spec: T, frontMat, rearMat };
}

// ============================================================
// Vehicle — 单辆车（AI 或玩家驾驶）
// ============================================================
export class Vehicle {
  /**
   * @param {THREE.Scene} scene
   * @param {object} opts { x, z, heading, color, type, parked, traffic, road }
   */
  constructor(scene, opts) {
    const { group, wheels, spec, frontMat, rearMat } = createCarMesh(opts.type, opts.color);
    this.mesh = group;
    this.wheels = wheels;
    this.frontMat = frontMat;
    this.rearMat = rearMat;
    this.spec = spec;
    scene.add(group);

    this.pos = new THREE.Vector3(opts.x, 0, opts.z);
    this.heading = opts.heading ?? 0;
    this.speed = 0;
    this.health = 100;             // 车况：碰撞扣减，任务失败判定用
    this.parked = !!opts.parked;   // 停车场停放车辆（不动，可被玩家开走）
    this.traffic = !!opts.traffic; // AI 车流
    this.police = !!opts.police;   // 警车（通缉系统调度）
    this.owned = !!opts.owned;     // 玩家购买的车辆
    this.playerControlled = false;
    this.boostTimer = 0;           // 氮气加速剩余时间（商店道具）
    this.onCrash = null;           // 碰撞回调（音效/通缉挂钩）：fn(impact)
    this.road = opts.road || null; // AI 路径：{axis, line, dir, s}
    this.rand = mulberry32((opts.x * 131 + opts.z * 17) | 0);

    // 固定路线行驶（任务目标车：追逐/拦截用）
    this.route = null;
    this.routeIdx = 0;
    this.routeSpeed = 0;
    this.routeMode = false;
    this.routeDone = false;

    this.syncToGround(1);
  }

  /** 开始沿固定路线行驶（waypoints: [[x,z],...]） */
  startRoute(waypoints, speed) {
    this.route = waypoints.map((pt) => ({ x: pt[0], z: pt[1] }));
    this.routeIdx = 0;
    this.routeSpeed = speed;
    this.routeMode = true;
    this.routeDone = false;
  }

  /** 沿路线行驶：平滑转向 + 匀速，到达终点后置 routeDone */
  updateRoute(dt) {
    if (!this.routeMode || this.routeDone) return;
    const wp = this.route[this.routeIdx];
    const dx = wp.x - this.pos.x;
    const dz = wp.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 7) {
      this.routeIdx++;
      if (this.routeIdx >= this.route.length) {
        this.routeDone = true;
        this.routeMode = false;
        this.speed = 0;
        this.syncToGround(1);
        return;
      }
    }

    // 目标航向（与本车移动约定一致：pos -= sin/cos * speed）
    const targetHeading = Math.atan2(-dx, -dz);
    let dh = targetHeading - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const maxTurn = 2.0 * dt;
    this.heading += Math.max(-maxTurn, Math.min(maxTurn, dh));

    // 速度趋向 routeSpeed（可被外部压低实现"逼停"）
    this.speed += (this.routeSpeed - this.speed) * Math.min(1, dt * 2);
    if (this.speed < 0) this.speed = 0;

    this.pos.x -= Math.sin(this.heading) * this.speed * dt;
    this.pos.z -= Math.cos(this.heading) * this.speed * dt;

    // 车轮滚动
    const spin = (this.speed * dt) / this.spec.wheelR;
    for (const w of this.wheels) w.rotation.x += spin;

    this.syncToGround(Math.min(1, dt * 10));
  }

  /** 贴地 + 姿态对齐地形（pitch/roll 由前后左右四点高度差得出） */
  syncToGround(lerp = 1) {
    const T = this.spec;
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    // 车前/后/左/右采样点
    const hF = getHeight(this.pos.x - sin * T.wheelBase, this.pos.z - cos * T.wheelBase);
    const hB = getHeight(this.pos.x + sin * T.wheelBase, this.pos.z + cos * T.wheelBase);
    const hL = getHeight(this.pos.x - cos * T.wheelTrack, this.pos.z + sin * T.wheelTrack);
    const hR = getHeight(this.pos.x + cos * T.wheelTrack, this.pos.z - sin * T.wheelTrack);
    const targetY = (hF + hB + hL + hR) / 4;

    this.pos.y += (targetY - this.pos.y) * lerp;

    const pitch = Math.atan2(hF - hB, T.wheelBase * 2);
    const roll = Math.atan2(hL - hR, T.wheelTrack * 2);
    this.mesh.position.copy(this.pos);
    // 注意：模型车头朝本地 -Z，heading=0 时移动方向也是 -Z，朝向直接对齐
    this.mesh.quaternion.setFromEuler(_e.set(pitch, this.heading, roll, 'YXZ'));
  }

  /** 玩家驾驶物理（街机式：油门/刹车/转向/滑行 + 碰撞减速） */
  drive(dt, keys, collision) {
    const V = CONFIG.vehicle;
    const boost = this.boostTimer > 0 ? 1.55 : 1; // 氮气：动力提升
    if (this.boostTimer > 0) this.boostTimer -= dt;
    const maxSpd = V.maxSpeed * this.spec.maxSpeedScale * boost;

    // 油门 / 刹车 / 倒车
    if (keys.has('KeyW')) {
      this.speed += V.accel * boost * dt;
    } else if (keys.has('KeyS')) {
      this.speed -= (this.speed > 0.5 ? V.brake : V.accel * 0.6) * dt;
    } else {
      // 滑行阻力
      this.speed -= this.speed * V.drag * dt;
      if (Math.abs(this.speed) < 0.1) this.speed = 0;
    }
    this.speed = Math.max(-V.reverseSpeed, Math.min(maxSpd, this.speed));

    // 转向（随速度衰减，倒车反向）
    const steer = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
    if (steer !== 0 && Math.abs(this.speed) > 0.3) {
      const grip = Math.min(1, Math.abs(this.speed) / 12);
      this.heading += steer * V.steerRate * grip * dt * Math.sign(this.speed);
    }

    // 位移（车头朝 -Z 方向为 heading=0）
    const prevX = this.pos.x, prevZ = this.pos.z;
    this.pos.x -= Math.sin(this.heading) * this.speed * dt;
    this.pos.z -= Math.cos(this.heading) * this.speed * dt;

    // 建筑碰撞：被推回则损失速度并扣车况
    if (collision.resolveCircle(this.pos, V.radius, this.pos.y + 0.5)) {
      const impact = Math.abs(this.speed);
      if (impact > 3) {
        this.health = Math.max(0, this.health - impact * 0.5);
        if (this.onCrash) this.onCrash(impact);
      }
      this.speed *= 0.35;
    }

    // 地图边界
    const B = CONFIG.world.mapHalf - 16;
    this.pos.x = Math.max(-B, Math.min(B, this.pos.x));
    this.pos.z = Math.max(-B, Math.min(B, this.pos.z));

    // 车轮滚动
    const spin = (this.speed * dt) / this.spec.wheelR;
    for (const w of this.wheels) w.rotation.x += spin;

    this.syncToGround(Math.min(1, dt * 10));
  }

  /** 交通 AI：沿车道直线行驶，路口随机转向，出城掉头 */
  updateTraffic(dt) {
    if (!this.road) return;
    const V = CONFIG.vehicle;
    const r = this.road;
    r.s += V.trafficSpeed * r.dir * dt;

    const PITCH = 64, GRID = 256;
    // 到达路口：概率转向
    const atCross = Math.abs(((r.s % PITCH) + PITCH) % PITCH) < V.trafficSpeed * dt * 1.2;
    if (atCross && this.rand() < 0.35) {
      const other = r.axis === 'x' ? this.pos.z : this.pos.x;
      const newLine = Math.round(other / PITCH) * PITCH;
      if (Math.abs(newLine) <= GRID) {
        const newAxis = r.axis === 'x' ? 'z' : 'x';
        this.road = {
          axis: newAxis,
          line: newLine,
          dir: this.rand() < 0.5 ? 1 : -1,
          s: r.axis === 'x' ? this.pos.x : this.pos.z,
        };
      }
    }
    // 出城掉头
    if (Math.abs(this.road.s) > GRID + 20) this.road.dir *= -1;

    // 由路径坐标换算世界坐标（含右侧车道偏移）
    const LANE = 2.75;
    const rr = this.road;
    if (rr.axis === 'x') {
      this.pos.x = rr.s;
      this.pos.z = rr.line + LANE * rr.dir;
      this.heading = rr.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    } else {
      this.pos.z = rr.s;
      this.pos.x = rr.line - LANE * rr.dir;
      this.heading = rr.dir > 0 ? Math.PI : 0;
    }
    this.speed = V.trafficSpeed;
    this.syncToGround(Math.min(1, dt * 10));
  }

  update(dt, keys, collision) {
    if (this.playerControlled) this.drive(dt, keys, collision);
    else if (this.routeMode) this.updateRoute(dt); // 任务目标车优先走固定路线
    else if (this.traffic) this.updateTraffic(dt);
    else this.syncToGround(Math.min(1, dt * 5)); // 停放车辆保持贴地
  }
}

// ============================================================
// VehicleManager — 生成车流 / 停放车辆 / 上下车逻辑
// ============================================================
export class VehicleManager {
  constructor(scene, collision) {
    this.scene = scene;
    this.collision = collision;
    this.cars = [];
    this.activeCar = null; // 玩家当前驾驶的车
    this.keys = new Set();
    document.addEventListener('keydown', (e) => this.keys.add(e.code));
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  /** 生成 AI 车流（随机分配到城市路网车道）—— 数量上限防低端机过载 */
  spawnTraffic(count) {
    const rand = mulberry32(CONFIG.world.seed ^ 0xca9);
    const GRID = 256, PITCH = 64, MAX_TRAFFIC = 24;
    const total = Math.min(count, MAX_TRAFFIC);
    for (let i = 0; i < total; i++) {
      const axis = rand() < 0.5 ? 'x' : 'z';
      const line = (Math.floor(rand() * 9) - 4) * PITCH;
      const dir = rand() < 0.5 ? 1 : -1;
      const s = (rand() * 2 - 1) * GRID;
      const LANE = 2.75;
      const x = axis === 'x' ? s : line - LANE * dir;
      const z = axis === 'x' ? line + LANE * dir : s;
      const car = new Vehicle(this.scene, {
        x, z,
        heading: 0,
        color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)],
        type: rand() < 0.8 ? 'sedan' : 'hatchback',
        traffic: true,
        road: { axis, line, dir, s },
      });
      this.cars.push(car);
    }
  }

  /** 在停车场街区生成停放车辆（其中一辆可作为玩家初始座驾） */
  spawnParked(emptyBlocks) {
    const rand = mulberry32(CONFIG.world.seed ^ 0x9a);
    for (const b of emptyBlocks) {
      const n = 2 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const x = b.minX + 6 + rand() * (b.maxX - b.minX - 12);
        const z = b.minZ + 6 + rand() * (b.maxZ - b.minZ - 12);
        this.cars.push(new Vehicle(this.scene, {
          x, z,
          heading: rand() < 0.5 ? 0 : Math.PI,
          color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)],
          type: rand() < 0.8 ? 'sedan' : 'hatchback',
          parked: true,
        }));
      }
    }
    // 出生点旁的初始车辆（红色轿车，方便玩家进入世界后立即试驾）
    this.cars.push(new Vehicle(this.scene, {
      x: 32, z: 2.75, heading: -Math.PI / 2,
      color: 0x8a1f1f, type: 'sedan', parked: true,
    }));
  }

  /** 任务奖励车：生成在指定位置的可驾驶车辆（如最终交接奖励跑车） */
  spawnRewardCar(x, z, color = 0xd4a017, type = 'sedan', heading = 0) {
    const car = new Vehicle(this.scene, {
      x, z, heading,
      color, type, parked: true,
    });
    this.cars.push(car);
    return car;
  }

  /** 找玩家附近可上的车（任务目标车/警车不可驾驶） */
  nearestCar(pos, maxDist = 3.4) {
    let best = null, bestD = maxDist;
    for (const c of this.cars) {
      if (c.playerControlled || c.routeMode || c.police) continue;
      const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  /** 商店购车：在指定位置生成玩家名下的车 */
  spawnOwnedCar(x, z, type, color, heading = 0) {
    const car = new Vehicle(this.scene, { x, z, heading, color, type, parked: true, owned: true });
    this.cars.push(car);
    return car;
  }

  /** 夜间开大灯：night01 0..1 控制全车灯 emissive 强度 */
  setHeadlights(night01) {
    const front = 0.35 + night01 * 2.2;
    const rear = 0.3 + night01 * 1.2;
    for (const c of this.cars) {
      c.frontMat.emissiveIntensity = front;
      c.rearMat.emissiveIntensity = rear;
    }
  }

  /** 上车 */
  enter(car) {
    car.playerControlled = true;
    car.traffic = false;
    car.parked = false;
    car.speed = 0;
    this.activeCar = car;
  }

  /** 下车：把玩家放到车门侧 */
  exit() {
    if (!this.activeCar) return null;
    const car = this.activeCar;
    car.playerControlled = false;
    car.speed = 0;
    this.activeCar = null;
    // 车门在右侧（+X 相对车身）
    const sx = car.pos.x + Math.cos(car.heading) * 2.0;
    const sz = car.pos.z - Math.sin(car.heading) * 2.0;
    return { x: sx, z: sz };
  }

  /** 从世界移除一辆车并释放其 GPU 资源（动态生成/回收的车辆用） */
  removeCar(car) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    if (this.activeCar === car) this.activeCar = null;
    disposeObjectTree(car.mesh);
  }

  /**
   * 每帧更新（带远距裁剪）
   * @param {number} dt
   * @param {THREE.Vector3} playerPos 玩家位置（远距裁剪基准；飞行模式传相机位置）
   */
  update(dt, playerPos) {
    // 远距裁剪距离：超过即隐藏 + 跳过 AI 计算
    const CULL_DIST = 450;
    for (const car of this.cars) {
      // 玩家车 / 任务目标车（固定路线）/ 警车：必须始终更新
      if (playerPos && !car.playerControlled && !car.routeMode && !car.police) {
        const d = Math.hypot(car.pos.x - playerPos.x, car.pos.z - playerPos.z);
        car.mesh.visible = d < CULL_DIST;
        if (d >= CULL_DIST) continue;
      }
      car.mesh.visible = true;
      car.update(dt, this.keys, this.collision);
    }

    // ---- 车与车碰撞（玩家车 vs 其他车：圆形推挤 + 减速） ----
    const active = this.activeCar;
    if (active) {
      for (const c of this.cars) {
        if (c === active) continue;
        const dx = c.pos.x - active.pos.x;
        const dz = c.pos.z - active.pos.z;
        const d = Math.hypot(dx, dz);
        const MIN = 2.6; // 两车最小间距
        if (d < MIN && d > 1e-4) {
          const push = MIN - d;
          active.pos.x -= (dx / d) * push * 0.6;
          active.pos.z -= (dz / d) * push * 0.6;
          // 碰撞扣车况（速度越大损伤越大，任务失败判定用）
          const impact = Math.abs(active.speed);
          if (impact > 3) {
            active.health = Math.max(0, active.health - impact * 0.6);
            c.health = Math.max(0, c.health - impact * 0.3);
            if (active.onCrash) active.onCrash(impact, c);
          }
          active.speed *= 0.55; // 碰撞损失速度
        }
      }
    }
  }
}

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
