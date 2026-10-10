// ============================================================
// policeSystem.js — GTA 式警察通缉系统
//
//  通缉等级 0~4 星：
//  · 犯罪触发：撞倒行人 +1、撞击警车 +1、严重肇事（撞车冲击>12）+1；
//  · 警力响应：星级 = 出动警车数量（警车追击碰撞玩家），
//    2 星起增派徒步警察追跑逮捕；
//  · 逃脱：甩开所有警力（距离 > 70+15×星）保持数秒 → 通缉解除；
//  · 被捕：徒步时被警察贴近 1.5 秒，或车辆静止被警车围住 2.5 秒
//    → "BUSTED"：罚款、任务中断、回出生点；
//  · HUD：右上角星级（红蓝闪烁）+ 警笛 + 红蓝警灯爆闪。
// ============================================================

import * as THREE from 'three';
import { Vehicle } from '../entities/vehicle.js';
import { createPedestrianMesh } from '../entities/npc.js';
import { getHeight } from '../world/terrain.js';
import { mulberry32 } from '../world/city.js';
import { disposeObjectTree } from '../core/watchdog.js';

const POLICE_COLOR = 0x24355c; // 警车深蓝

export class PoliceSystem {
  /**
   * @param {object} ctx { scene, player, vehicles, npcs, quest, audio, collision }
   */
  constructor(ctx) {
    this.scene = ctx.scene;
    this.player = ctx.player;
    this.vehicles = ctx.vehicles;
    this.npcs = ctx.npcs;
    this.quest = ctx.quest;
    this.audio = ctx.audio;
    this.collision = ctx.collision;

    this.wanted = 0;          // 0~4
    this.escapeTimer = 0;     // 甩脱计时
    this.arrestTimer = 0;     // 被捕进度
    this.bustedT = 0;         // >0 表示正在播放被捕流程
    this.rand = mulberry32(Date.now() & 0xffff);

    this.policeCars = [];     // { car, lightbar, flashT }
    this.officers = [];       // { mesh, pos, parts }

    this.elStars = document.getElementById('wanted-stars');
    this.elBusted = document.getElementById('busted');
    this._lastStarsShown = -1;
  }

  get isBusted() { return this.bustedT > 0; }

  // ==================== 犯罪 ====================
  /** 增加通缉星级 */
  addCrime(stars, reason) {
    if (this.bustedT > 0) return;
    const before = this.wanted;
    this.wanted = Math.min(4, this.wanted + stars);
    this.escapeTimer = 0;
    if (this.wanted > before) {
      this.quest.ui.showBanner(`⚠ ${reason} —— 通缉等级 ${'★'.repeat(this.wanted)}`);
      this.audio.wantedUp();
      this.audio.setSiren(true);
    }
  }

  /** 玩家车辆碰撞回调（由 main 挂到 activeCar.onCrash） */
  onPlayerCrash(impact, other) {
    if (this.wanted >= 4) return;
    if (other && other.police) this.addCrime(1, '撞击警车');
    else if (impact > 12) this.addCrime(1, '严重肇事');
  }

  // ==================== 警力生成 ====================
  _spawnPoliceCar() {
    const p = this.player.pos;
    // 在玩家 70~95m 外的道路网格点上生成（避免凭空出现在眼前）
    const PITCH = 64;
    const ang = this.rand() * Math.PI * 2;
    const dist = 70 + this.rand() * 25;
    let x = p.x + Math.cos(ang) * dist;
    let z = p.z + Math.sin(ang) * dist;
    // 吸附到最近的道路线
    if (this.rand() < 0.5) z = Math.round(z / PITCH) * PITCH + 2.75;
    else x = Math.round(x / PITCH) * PITCH - 2.75;

    const car = new Vehicle(this.scene, {
      x, z, heading: 0, color: POLICE_COLOR, type: 'sedan', police: true,
    });
    // 车顶警灯（红蓝小盒，交替爆闪）
    const lightbar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x881111, emissive: 0xff2020, emissiveIntensity: 1 }));
    red.position.x = -0.2;
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x111a88, emissive: 0x2040ff, emissiveIntensity: 1 }));
    blue.position.x = 0.2;
    lightbar.add(red, blue);
    lightbar.position.y = 1.35;
    car.mesh.add(lightbar);
    car.health = 200; // 警车更耐撞

    this.vehicles.cars.push(car); // 加入车辆列表：玩家可与之碰撞，NPC 会避让
    this.policeCars.push({ car, red, blue, flashT: this.rand() * 10 });
  }

  _spawnOfficer(x, z) {
    const parts = createPedestrianMesh(this.rand);
    // 警服化：深蓝躯干/手臂（与躯干共享材质），藏青裤子
    parts.armL.material.color.setHex(0x24406e);
    parts.armR.material.color.setHex(0x24406e);
    parts.legL.material.color.setHex(0x1a2438);
    parts.legR.material.color.setHex(0x1a2438);
    const y = getHeight(x, z);
    parts.group.position.set(x, y, z);
    this.scene.add(parts.group);
    this.officers.push({ mesh: parts.group, parts, pos: new THREE.Vector3(x, y, z), walkPhase: this.rand() * 6 });
  }

  _despawnAll() {
    // 警车/警官都是动态生成实体，回收时必须释放 geometry/material GPU 资源，
    // 否则反复进出通缉状态会持续泄漏显存
    for (const pc of this.policeCars) {
      const i = this.vehicles.cars.indexOf(pc.car);
      if (i >= 0) this.vehicles.cars.splice(i, 1);
      disposeObjectTree(pc.car.mesh);
    }
    this.policeCars = [];
    for (const o of this.officers) disposeObjectTree(o.mesh);
    this.officers = [];
  }

  // ==================== 主更新 ====================
  /**
   * @returns {boolean} true 表示本帧处于被捕演出中（主循环应冻结玩家操作）
   */
  update(dt, mode, activeCar, night01) {
    // ---- 被捕演出 ----
    if (this.bustedT > 0) {
      this.bustedT -= dt;
      if (this.bustedT <= 0) this._afterBusted();
      return true;
    }

    const p = this.player.pos;

    // ---- 犯罪检测：玩家车撞倒行人 ----
    if (activeCar && Math.abs(activeCar.speed) > 2) {
      for (const npc of this.npcs.npcs) {
        if (npc.knocked) continue;
        const d = Math.hypot(npc.pos.x - activeCar.pos.x, npc.pos.z - activeCar.pos.z);
        if (d < 1.5) {
          npc.knock();
          this.addCrime(1, '撞倒行人');
          this.audio.crash(0.4);
        }
      }
    }

    // ---- 警力数量调度 ----
    const wantCars = this.wanted;
    while (this.policeCars.length < wantCars) this._spawnPoliceCar();
    const wantOfficers = this.wanted >= 2 ? 2 : 0;
    while (this.officers.length < wantOfficers) {
      const base = this.policeCars[0]?.car.pos ?? p;
      this._spawnOfficer(base.x + (this.rand() - 0.5) * 6, base.z + (this.rand() - 0.5) * 6);
    }
    if (this.wanted === 0 && (this.policeCars.length || this.officers.length)) this._despawnAll();

    // ---- 警车追击 AI ----
    let nearest = Infinity;
    for (const pc of this.policeCars) {
      const car = pc.car;
      const dx = p.x - car.pos.x, dz = p.z - car.pos.z;
      const d = Math.hypot(dx, dz);
      nearest = Math.min(nearest, d);

      // 转向追踪（同车辆约定：pos -= sin/cos(heading)*speed）
      const targetH = Math.atan2(-dx, -dz);
      let dh = targetH - car.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      car.heading += Math.max(-2.6 * dt, Math.min(2.6 * dt, dh));

      // 速度：星级越高越凶；近身减速防止 overshoot
      const maxSpd = Math.min(11 + this.wanted * 3.5, d * 1.4);
      car.speed += (maxSpd - car.speed) * Math.min(1, dt * 1.8);
      car.pos.x -= Math.sin(car.heading) * car.speed * dt;
      car.pos.z -= Math.cos(car.heading) * car.speed * dt;
      if (this.collision.resolveCircle(car.pos, 1.35, car.pos.y + 0.5)) car.speed *= 0.5;
      car.syncToGround(Math.min(1, dt * 10));
      const spin = (car.speed * dt) / car.spec.wheelR;
      for (const w of car.wheels) w.rotation.x += spin;

      // 警灯爆闪（红蓝交替）
      pc.flashT += dt * 6;
      const phase = Math.floor(pc.flashT) % 2;
      pc.red.material.emissiveIntensity = phase === 0 ? 2.5 : 0.15;
      pc.blue.material.emissiveIntensity = phase === 1 ? 2.5 : 0.15;

      // 撞击玩家车（别停）
      if (activeCar && d < 3.2) {
        activeCar.speed *= Math.max(0, 1 - dt * 1.2);
        activeCar.health = Math.max(0, activeCar.health - dt * 9);
        const px = activeCar.pos.x - car.pos.x, pz = activeCar.pos.z - car.pos.z;
        const pl = Math.hypot(px, pz) || 1;
        activeCar.pos.x += (px / pl) * dt * 3;
        activeCar.pos.z += (pz / pl) * dt * 3;
      }
    }

    // ---- 徒步警察追赶 ----
    for (const o of this.officers) {
      const dx = p.x - o.pos.x, dz = p.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      nearest = Math.min(nearest, d);
      if (d > 0.6) {
        const spd = 4.8;
        o.pos.x += (dx / d) * spd * dt;
        o.pos.z += (dz / d) * spd * dt;
        o.pos.y = getHeight(o.pos.x, o.pos.z);
        o.walkPhase += dt * 9;
        const sw = Math.sin(o.walkPhase) * 0.6;
        o.parts.legL.rotation.x = sw;
        o.parts.legR.rotation.x = -sw;
        o.parts.armL.rotation.x = -sw * 0.8;
        o.parts.armR.rotation.x = sw * 0.8;
        o.mesh.rotation.y = Math.atan2(dx, dz);
      }
      o.mesh.position.copy(o.pos);
    }

    // ---- 被捕判定 ----
    if (this.wanted > 0) {
      let arresting = false;
      if (mode === 'foot') {
        for (const o of this.officers) {
          if (Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 1.6) { arresting = true; break; }
        }
      } else if (activeCar && Math.abs(activeCar.speed) < 1) {
        // 车停着被警车贴住 → 拖下车逮捕
        for (const pc of this.policeCars) {
          if (Math.hypot(pc.car.pos.x - p.x, pc.car.pos.z - p.z) < 5) { arresting = true; break; }
        }
      }
      if (arresting) {
        this.arrestTimer += dt;
        if (this.arrestTimer > (mode === 'foot' ? 1.5 : 2.5)) { this._busted(); return true; }
      } else {
        this.arrestTimer = Math.max(0, this.arrestTimer - dt * 2);
      }
    }

    // ---- 逃脱判定 ----
    if (this.wanted > 0) {
      const escapeR = 70 + this.wanted * 15;
      if (nearest > escapeR) {
        this.escapeTimer += dt;
        if (this.escapeTimer > 5 + this.wanted * 3) {
          this.wanted = 0;
          this.arrestTimer = 0;
          this._despawnAll();
          this.audio.setSiren(false);
          this.quest.ui.showBanner('成功摆脱通缉');
        }
      } else {
        this.escapeTimer = Math.max(0, this.escapeTimer - dt);
      }
    }

    // ---- HUD 星级 ----
    if (this.wanted !== this._lastStarsShown) {
      this._lastStarsShown = this.wanted;
      if (this.wanted === 0) {
        this.elStars.classList.add('hidden');
      } else {
        this.elStars.classList.remove('hidden');
        this.elStars.textContent = '★'.repeat(this.wanted) + '☆'.repeat(4 - this.wanted);
      }
    }
    return false;
  }

  // ==================== 被捕 ====================
  _busted() {
    this.bustedT = 3;
    this.audio.busted();
    this.audio.setSiren(false);
    this.elBusted.classList.remove('hidden');
  }

  _afterBusted() {
    this.elBusted.classList.add('hidden');

    // 罚款（通缉越重罚越多）
    const fine = Math.min(this.quest.money, 150 * this.wanted);
    this.quest.money -= fine;

    // 任务中断（回到可接取）
    if (this.quest.activeQuest) this.quest.abortActive('被逮捕，任务中断');

    // 清场 + 回出生点
    this.wanted = 0;
    this.arrestTimer = 0;
    this.escapeTimer = 0;
    this._despawnAll();
    if (this.vehicles.activeCar) this.vehicles.exit();
    this.player.spawn(24, 7.5);
    this.quest.ui.showBanner(`被逮捕：罚款 ¥${fine}，已释放`);
  }
}
