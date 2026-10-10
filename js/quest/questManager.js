// ============================================================
// questManager.js — 任务系统引擎
//
// 职责：
//  1. 任务状态机：locked → available → active → done / failed；
//  2. 通用步骤执行器（talk/goto/drive_to/collect/clear/follow/
//     intercept/wait/race），全部任务数据驱动；
//  3. 触发方式：NPC 对话接取 / 手机来电 / 步骤自动推进；
//  4. 失败判定：超时、车辆损毁、跟丢目标，支持重试/放弃；
//  5. 奖励发放：金钱、解锁车辆、更多 NPC、河滩营地；
//  6. 进度持久化（localStorage，重开网页可继续）。
// ============================================================

import * as THREE from 'three';
import { QUESTS } from './questData.js';
import { DialogUI } from './dialogUI.js';
import { Navigation } from './navigation.js';
import { MapScreen } from './mapScreen.js';
import { createPedestrianMesh } from '../entities/npc.js';
import { Vehicle } from '../entities/vehicle.js';
import { getHeight } from '../world/terrain.js';
import { mulberry32 } from '../world/city.js';
import { disposeObjectTree } from '../core/watchdog.js';

const SAVE_KEY = 'gta_quests_v1';

export class QuestManager {
  /**
   * @param {object} ctx { scene, player, vehicles, npcs }
   */
  constructor(ctx) {
    this.scene = ctx.scene;
    this.player = ctx.player;
    this.vehicles = ctx.vehicles;
    this.npcs = ctx.npcs;
    this.audio = ctx.audio || null;

    this.ui = new DialogUI();
    this.nav = new Navigation(ctx.scene);
    this.map = new MapScreen();

    // 任务 UI 音效挂钩（AudioManager 可选）
    if (this.audio) {
      const ui = this.ui, au = this.audio;
      const _phone = ui.showPhone.bind(ui);
      ui.showPhone = (c, t) => { _phone(c, t); au.uiPhone(); };
      const _result = ui.showResult.bind(ui);
      ui.showResult = (ok, t, d, cb) => { _result(ok, t, d, cb); ok ? au.uiSuccess() : au.uiFail(); };
      const _banner = ui.showBanner.bind(ui);
      ui.showBanner = (t, s) => { _banner(t, s); au.uiBanner(); };
      const _advance = ui.advance.bind(ui);
      ui.advance = () => { const r = _advance(); if (r) au.uiDialog(); return r; };
    }

    // ---- 状态 ----
    this.states = {};       // id -> 'active' | 'done'（缺省 = 按解锁条件计算）
    this.money = 0;
    this.activeQuest = null;
    this.stepIdx = 0;
    this.timeLeft = null;
    this.stepRT = {};       // 当前步骤运行时数据
    this.phoneQueue = [];   // 待接听的来电任务
    this.followLostTimer = 0;

    // ---- 场景实体 ----
    this.givers = [];       // { quest, mesh, marker }
    this.tempNPC = null;    // 步骤临时对话 NPC
    this.itemMeshes = [];   // collect/clear 物品
    this.targetCar = null;  // follow/intercept 目标车
    this.campGroup = null;  // 河滩营地（奖励）

    this.load();
    this.buildGivers();
    this.refreshUnlocks();
  }

  // ==================== 持久化 ====================
  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        done: Object.keys(this.states).filter((k) => this.states[k] === 'done'),
        money: this.money,
      }));
    } catch (e) { /* 隐私模式等场景下静默失败 */ }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        for (const id of data.done || []) this.states[id] = 'done';
        this.money = data.money || 0;
      }
    } catch (e) { /* 损坏存档忽略 */ }
  }

  // ==================== 解锁与触发 ====================
  questById(id) {
    return QUESTS.find((q) => q.id === id);
  }

  isUnlocked(q) {
    if (!q.requires) return true;
    return q.requires.every((r) => this.states[r] === 'done');
  }

  stateOf(q) {
    if (this.states[q.id]) return this.states[q.id];
    return this.isUnlocked(q) ? 'available' : 'locked';
  }

  /** 刷新解锁：新解锁的电话任务进入来电队列 */
  refreshUnlocks() {
    for (const q of QUESTS) {
      if (q.auto === 'phone' && this.stateOf(q) === 'available' &&
          !this.phoneQueue.includes(q.id) && this.activeQuest?.id !== q.id) {
        this.phoneQueue.push(q.id);
      }
    }
  }

  // ==================== 任务给予者（NPC + 感叹号标记） ====================
  buildGivers() {
    // 同一位置可能发布多个任务（如老陈发布 m1 和 m8）：NPC/标记只建一份
    const spots = new Map(); // key -> { mesh, marker, baseY }
    for (const q of QUESTS) {
      if (!q.giver) continue;
      const key = `${q.giver.x},${q.giver.z}`;
      let spot = spots.get(key);
      if (!spot) {
        const rand = mulberry32((q.giver.x * 131 + q.giver.z * 17) | 0);
        const parts = createPedestrianMesh(rand);
        const y = getHeight(q.giver.x, q.giver.z);
        parts.group.position.set(q.giver.x, y, q.giver.z);
        parts.group.rotation.y = rand() * Math.PI * 2;
        this.scene.add(parts.group);

        // 感叹号标记（主线黄色 / 支线白色），头顶悬浮
        const marker = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.22),
          new THREE.MeshBasicMaterial({ color: 0xffc832, fog: false })
        );
        marker.position.set(q.giver.x, y + 2.3, q.giver.z);
        this.scene.add(marker);

        spot = { mesh: parts.group, marker, baseY: y + 2.3, quests: [] };
        spots.set(key, spot);
      }
      spot.quests.push(q);
      this.givers.push({ quest: q, spot });
    }
    this.giverSpots = [...spots.values()];
  }

  // ==================== 接取 / 激活 ====================
  activateQuest(q) {
    this.activeQuest = q;
    this.states[q.id] = 'active';
    this.stepIdx = 0;
    this.timeLeft = q.time || null;
    this.followLostTimer = 0;
    this.ui.showBanner(`接受任务：${q.name}`);
    this.initStep();
    this.save();
  }

  /** 初始化当前步骤（生成临时 NPC / 物品 / 目标车） */
  initStep() {
    this.clearStepEntities();
    const step = this.activeQuest?.steps[this.stepIdx];
    if (!step) return;
    this.stepRT = { collected: 0, waitT: 0, raceIdx: 0, items: [] };

    if (step.k === 'talk' && !this.isGiverAt(step)) {
      // 临时对话 NPC
      const rand = mulberry32(this.stepIdx * 31 + 7);
      const parts = createPedestrianMesh(rand);
      const y = getHeight(step.x, step.z);
      parts.group.position.set(step.x, y, step.z);
      this.scene.add(parts.group);
      this.tempNPC = parts.group;
    }

    if (step.k === 'collect' || step.k === 'clear') {
      for (const it of step.items) {
        const mesh = this.makeItemMesh(it.kind);
        const y = getHeight(it.x, it.z);
        mesh.position.set(it.x, y + mesh.userData.yOff, it.z);
        mesh.userData.item = it;
        this.scene.add(mesh);
        this.itemMeshes.push(mesh);
        this.stepRT.items.push(mesh);
      }
    }

    if (step.k === 'follow' || step.k === 'intercept') {
      // 生成目标车辆（加入车流列表，玩家车可与其碰撞）
      const start = step.route[0];
      this.targetCar = new Vehicle(this.scene, {
        x: start[0], z: start[1], heading: 0,
        color: 0x1e1e24, type: 'sedan',
      });
      this.targetCar.startRoute(step.route, step.speed);
      this.vehicles.cars.push(this.targetCar);
    }
  }

  /** 清理步骤实体（释放 GPU 资源：临时 NPC / 物品 / 目标车都是动态生成的） */
  clearStepEntities() {
    if (this.tempNPC) { disposeObjectTree(this.tempNPC); this.tempNPC = null; }
    for (const m of this.itemMeshes) disposeObjectTree(m);
    this.itemMeshes = [];
    if (this.targetCar) {
      const idx = this.vehicles.cars.indexOf(this.targetCar);
      if (idx >= 0) this.vehicles.cars.splice(idx, 1);
      disposeObjectTree(this.targetCar.mesh);
      this.targetCar = null;
    }
  }

  /** 判断 talk 步骤的 NPC 是否为该任务的 giver 本人（复用常驻 NPC） */
  isGiverAt(step) {
    const g = this.activeQuest?.giver;
    return g && Math.abs(g.x - step.x) < 1 && Math.abs(g.z - step.z) < 1;
  }

  /** 物品网格工厂 */
  makeItemMesh(kind) {
    let mesh;
    if (kind === 'bag') {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.35, 0.28),
        new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 }));
      mesh.userData.yOff = 0.2;
    } else if (kind === 'dog') {
      mesh = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0xc8a060, roughness: 0.9 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.25), mat);
      body.position.y = 0.25;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), mat);
      head.position.set(0.32, 0.4, 0);
      mesh.add(body, head);
      mesh.userData.yOff = 0;
    } else if (kind === 'crate') {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.6, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.95 }));
      mesh.userData.yOff = 0.3;
    } else { // rock 落石
      mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.1, 0),
        new THREE.MeshStandardMaterial({ color: 0x6a6660, roughness: 0.95, flatShading: true }));
      mesh.userData.yOff = 0.5;
    }
    mesh.castShadow = true;
    return mesh;
  }

  // ==================== 交互（E 键，主循环转发） ====================
  /**
   * @returns {boolean} true = 按键被任务系统消费（不再触发上下车）
   */
  interact(mode) {
    // 对话中：推进对话
    if (this.ui.isDialogOpen) { this.ui.advance(); return true; }
    // 来电中：接听并激活任务
    if (this.ui.isPhoneOpen) {
      const q = this.questById(this.phoneQueue.shift());
      this.ui.hidePhone();
      if (q) this.activateQuest(q);
      return true;
    }
    if (mode !== 'foot') return false;

    const p = this.player.pos;

    // 附近可接任务的 NPC（有进行中任务时不允许接新任务，避免状态被覆盖）
    if (!this.activeQuest) for (const g of this.givers) {
      if (this.stateOf(g.quest) !== 'available') continue;
      const d = Math.hypot(g.quest.giver.x - p.x, g.quest.giver.z - p.z);
      if (d < 3) {
        this.ui.showDialog(g.quest.intro || [`${g.quest.giver.name}：${g.quest.brief}`],
          () => this.activateQuest(g.quest));
        return true;
      }
    }

    // 进行中任务的 talk 步骤
    if (this.activeQuest) {
      const step = this.activeQuest.steps[this.stepIdx];
      if (step?.k === 'talk') {
        const d = Math.hypot(step.x - p.x, step.z - p.z);
        if (d < 3) {
          this.ui.showDialog(step.lines, () => this.advanceStep());
          return true;
        }
      }
      // clear 步骤：E 清除落石
      if (step?.k === 'clear') {
        for (const m of [...this.stepRT.items]) {
          const d = Math.hypot(m.position.x - p.x, m.position.z - p.z);
          if (d < 2.5) {
            this.removeItem(m);
            this.ui.showBanner('移除了落石');
            this.checkCollectDone();
            return true;
          }
        }
      }
    }
    return false;
  }

  /** 附近是否有可交互对象（HUD 提示用） */
  nearbyInteractable(playerPos, mode) {
    if (this.ui.isPhoneOpen) return '按 E 接听电话';
    if (this.ui.isDialogOpen) return '按 E 继续对话';
    if (mode !== 'foot') return null;
    if (!this.activeQuest) for (const g of this.givers) {
      if (this.stateOf(g.quest) !== 'available') continue;
      if (Math.hypot(g.quest.giver.x - playerPos.x, g.quest.giver.z - playerPos.z) < 3) {
        return `按 E 与 ${g.quest.giver.name} 对话`;
      }
    }
    if (this.activeQuest) {
      const step = this.activeQuest.steps[this.stepIdx];
      if (step?.k === 'talk' &&
          Math.hypot(step.x - playerPos.x, step.z - playerPos.z) < 3) {
        return `按 E 与 ${step.npc} 对话`;
      }
      if (step?.k === 'clear') {
        for (const m of this.stepRT.items) {
          if (Math.hypot(m.position.x - playerPos.x, m.position.z - playerPos.z) < 2.5) {
            return '按 E 移除落石';
          }
        }
      }
    }
    return null;
  }

  // ==================== 步骤推进 ====================
  advanceStep() {
    this.stepIdx++;
    if (this.stepIdx >= this.activeQuest.steps.length) {
      this.completeQuest();
    } else {
      this.initStep();
    }
  }

  removeItem(mesh) {
    disposeObjectTree(mesh);
    const i1 = this.itemMeshes.indexOf(mesh);
    if (i1 >= 0) this.itemMeshes.splice(i1, 1);
    const i2 = this.stepRT.items.indexOf(mesh);
    if (i2 >= 0) this.stepRT.items.splice(i2, 1);
  }

  checkCollectDone() {
    if (this.stepRT.items.length === 0) this.advanceStep();
  }

  // ==================== 完成 / 失败 ====================
  /** 外部中断（被捕等特殊事件）：不进行失败结算，直接回到可接取 */
  abortActive(reason) {
    const q = this.activeQuest;
    if (!q) return;
    this.clearStepEntities();
    delete this.states[q.id];
    this.activeQuest = null;
    this.nav.setTarget(null);
    this.ui.showBanner(reason);
    if (q.auto === 'phone') {
      setTimeout(() => { this.refreshUnlocks(); }, 15000);
    }
  }

  completeQuest() {
    const q = this.activeQuest;
    this.states[q.id] = 'done';
    this.money += q.money;
    this.clearStepEntities();
    this.activeQuest = null;
    this.nav.setTarget(null);

    // 结尾台词（如有）
    if (q.outro) this.ui.showDialog(q.outro, null);

    // 奖励
    const rewards = [];
    if (q.rewards?.npcBoost) { this.npcs.spawnAll(12); rewards.push('街头人气提升'); }
    if (q.rewards?.unlockCar) {
      // 黑色轿车停在老陈楼下路边（出生点旁）
      this.vehicles.spawnRewardCar(40, -2.75, 0x14141a, 'sedan', -Math.PI / 2);
      rewards.push('特别车辆已送达');
    }
    if (q.rewards?.camp) { this.spawnCamp(); rewards.push('河滩营地解锁'); }

    this.ui.showResult(true, '任务完成',
      `${q.name}  ·  奖励 ¥${q.money}${rewards.length ? ' · ' + rewards.join('、') : ''}`, null);
    this.refreshUnlocks();
    this.save();
  }

  failQuest(reason) {
    const q = this.activeQuest;
    this.ui.showResult(false, '任务失败', `${q.name} —— ${reason}`, (choice) => {
      this.clearStepEntities();
      if (choice === 'retry') {
        this.stepIdx = 0;
        this.timeLeft = q.time || null;
        this.followLostTimer = 0;
        this.initStep();
        this.ui.showBanner(`重新开始：${q.name}`);
      } else {
        this.states[q.id] = 'available';
        delete this.states[q.id]; // 回到可接取
        this.activeQuest = null;
        this.nav.setTarget(null);
        // 电话任务稍后重新来电
        if (q.auto === 'phone') {
          setTimeout(() => { this.refreshUnlocks(); }, 15000);
        }
      }
    });
  }

  // ==================== 河滩营地（奖励场景） ====================
  spawnCamp() {
    if (this.campGroup) return;
    const g = new THREE.Group();
    const cx = -560, cz = 100;
    const y = getHeight(cx, cz);
    // 帐篷（两色三角柱近似：倾斜盒）
    const tentMat = new THREE.MeshStandardMaterial({ color: 0xb86030, roughness: 0.9 });
    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.8, 4), tentMat);
    tent.position.set(cx, y + 0.9, cz);
    tent.rotation.y = Math.PI / 4;
    // 篝火（石圈 + 发光核心）
    const fire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.4, 0.3, 8),
      new THREE.MeshStandardMaterial({ color: 0xff8830, emissive: 0xcc5500, emissiveIntensity: 1.5 }));
    fire.position.set(cx + 3, y + 0.15, cz + 1);
    // 物资箱
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.7, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.95 }));
    crate.position.set(cx - 2, y + 0.35, cz + 1.5);
    g.add(tent, fire, crate);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(g);
    this.campGroup = g;
  }

  // ==================== 主更新 ====================
  /**
   * @param {number} dt
   * @param {string} mode 'foot' | 'drive'
   * @param {Vehicle|null} activeCar
   * @param {number} yaw 玩家视角朝向
   */
  update(dt, mode, activeCar, yaw) {
    const p = this.player.pos;

    // ---- 来电弹出（无任务时、无弹窗时） ----
    if (this.phoneQueue.length && !this.activeQuest &&
        !this.ui.isPhoneOpen && !this.ui.isDialogOpen && !this.ui.isResultOpen) {
      const q = this.questById(this.phoneQueue[0]);
      this.ui.showPhone(q.caller, q.phoneText);
    }

    // ---- giver 标记动画与可见性（同一 NPC 处有任一可接任务即显示） ----
    const t = performance.now() / 1000;
    for (const spot of this.giverSpots) {
      const anyAvailable = spot.quests.some((q) => this.stateOf(q) === 'available');
      spot.marker.visible = anyAvailable;
      if (anyAvailable) {
        // 有可接主线显示黄色，否则白色
        const hasMain = spot.quests.some(
          (q) => q.type === 'main' && this.stateOf(q) === 'available');
        spot.marker.material.color.setHex(hasMain ? 0xffc832 : 0xe8e8e8);
        spot.marker.position.y = spot.baseY + Math.sin(t * 2.5 + spot.baseY) * 0.12;
        spot.marker.rotation.y += dt * 2;
      }
    }

    // ---- 进行中任务 ----
    if (this.activeQuest) {
      const q = this.activeQuest;
      const step = q.steps[this.stepIdx];

      // 超时失败
      if (this.timeLeft != null) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) { this.failQuest('时间耗尽'); return; }
      }
      // 车辆损毁失败
      if (q.minCarHealth && activeCar && activeCar.health < q.minCarHealth) {
        this.failQuest('车辆严重损毁'); return;
      }

      this.updateStep(dt, step, mode, activeCar);
      this.updateNavigation(step, activeCar);
    } else {
      this.nav.setTarget(null);
    }

    // ---- 地图界面 ----
    if (this.map.isOpen) {
      this.map.render({
        playerPos: p, yaw,
        givers: this.givers
          .filter((g) => this.stateOf(g.quest) === 'available')
          .map((g) => ({ x: g.quest.giver.x, z: g.quest.giver.z, type: g.quest.type })),
        objective: this.nav.target,
      }, dt);
      this.map.renderList(QUESTS.map((q) => ({
        ...q, state: this.stateOf(q) === 'locked' ? 'locked' : this.stateOf(q),
      })));
    }
  }

  /** 步骤逻辑 */
  updateStep(dt, step, mode, activeCar) {
    if (!step) return;
    const p = this.player.pos;

    switch (step.k) {
      case 'goto':
        if (Math.hypot(step.x - p.x, step.z - p.z) < step.r) this.advanceStep();
        break;

      case 'drive_to':
        if (mode === 'drive' && Math.hypot(step.x - p.x, step.z - p.z) < step.r) this.advanceStep();
        break;

      case 'wait':
        if (Math.hypot(step.x - p.x, step.z - p.z) < step.r) {
          this.stepRT.waitT += dt;
          if (this.stepRT.waitT >= step.seconds) this.advanceStep();
        } else {
          this.stepRT.waitT = Math.max(0, this.stepRT.waitT - dt * 2);
        }
        break;

      case 'collect':
        for (const m of [...this.stepRT.items]) {
          m.rotation.y += dt * 1.5; // 物品旋转提示
          if (Math.hypot(m.position.x - p.x, m.position.z - p.z) < 2.2) {
            this.removeItem(m);
            this.ui.showBanner(`找到了 ${m.userData.item.name}（剩余 ${this.stepRT.items.length}）`);
          }
        }
        if (this.stepRT.items.length === 0) this.advanceStep();
        break;

      case 'clear':
        // 开车撞碎（速度 > 8）
        if (mode === 'drive' && activeCar && Math.abs(activeCar.speed) > 8) {
          for (const m of [...this.stepRT.items]) {
            if (Math.hypot(m.position.x - p.x, m.position.z - p.z) < 2.6) {
              this.removeItem(m);
              this.ui.showBanner(`撞碎了落石（剩余 ${this.stepRT.items.length}）`);
            }
          }
          if (this.stepRT.items.length === 0) this.advanceStep();
        }
        break;

      case 'race': {
        const pt = step.points[this.stepRT.raceIdx];
        if (mode === 'drive' && Math.hypot(pt[0] - p.x, pt[1] - p.z) < 12) {
          this.stepRT.raceIdx++;
          this.ui.showBanner(`通过检查点 ${this.stepRT.raceIdx}/${step.points.length}`);
          if (this.stepRT.raceIdx >= step.points.length) this.advanceStep();
        }
        break;
      }

      case 'follow': {
        if (!this.targetCar) break;
        const d = Math.hypot(this.targetCar.pos.x - p.x, this.targetCar.pos.z - p.z);
        // 跟丢判定
        if (d > step.maxD) {
          this.followLostTimer += dt;
          if (this.followLostTimer > 6) { this.failQuest('跟丢了目标'); return; }
        } else {
          this.followLostTimer = Math.max(0, this.followLostTimer - dt * 2);
        }
        // 目标到达终点且玩家跟住 → 完成
        if (this.targetCar.routeDone && d < step.maxD) this.advanceStep();
        break;
      }

      case 'intercept': {
        if (!this.targetCar) break;
        const d = Math.hypot(this.targetCar.pos.x - p.x, this.targetCar.pos.z - p.z);
        // 贴近压制：目标减速
        if (mode === 'drive' && d < 6 && Math.abs(activeCar.speed) > 2) {
          this.targetCar.routeSpeed = Math.max(0, this.targetCar.routeSpeed - dt * 6);
        }
        // 目标被逼停 → 完成
        if (this.targetCar.speed < 0.5 && d < 8) {
          this.targetCar.routeMode = false;
          this.advanceStep();
        }
        // 目标逃到终点 → 失败
        if (this.targetCar.routeDone) { this.failQuest('目标逃脱了'); return; }
        break;
      }
    }
  }

  /** 导航目标与 HUD 信息 */
  updateNavigation(step, activeCar) {
    if (!step) { this.nav.setTarget(null); return; }
    const q = this.activeQuest;
    let target = null;
    let extra = '';

    switch (step.k) {
      case 'talk': case 'goto': case 'drive_to':
        target = { x: step.x, z: step.z };
        break;
      case 'wait':
        target = { x: step.x, z: step.z };
        extra = `停留 ${(step.seconds - this.stepRT.waitT).toFixed(0)} 秒`;
        break;
      case 'collect': case 'clear': {
        const items = this.stepRT.items;
        if (items.length) {
          let best = items[0], bd = Infinity;
          for (const m of items) {
            const d = Math.hypot(m.position.x - this.player.pos.x, m.position.z - this.player.pos.z);
            if (d < bd) { bd = d; best = m; }
          }
          target = { x: best.position.x, z: best.position.z };
        }
        extra = `${step.k === 'collect' ? '已找到' : '已清除'} ${step.items.length - items.length}/${step.items.length}`;
        break;
      }
      case 'race': {
        const pt = step.points[this.stepRT.raceIdx] || step.points[step.points.length - 1];
        target = { x: pt[0], z: pt[1] };
        extra = `检查点 ${this.stepRT.raceIdx}/${step.points.length}`;
        break;
      }
      case 'follow': case 'intercept':
        if (this.targetCar) {
          target = { x: this.targetCar.pos.x, z: this.targetCar.pos.z };
          const d = Math.hypot(target.x - this.player.pos.x, target.z - this.player.pos.z);
          extra = step.k === 'follow'
            ? (d > step.maxD ? '⚠ 距离过远！' : `距离 ${d.toFixed(0)}m`)
            : (d < 6 ? '压制中……' : `距离 ${d.toFixed(0)}m`);
        }
        break;
    }

    if (target) {
      this.nav.setTarget(target);
    } else {
      this.nav.setTarget(null);
    }
    this.navInfo = { label: `【${q.name}】${step.label}`, timeLeft: this.timeLeft, extra };
  }
}
