// ============================================================
// shopSystem.js — 商店与经济系统
//
//  两家实体店（靠近后按 E 打开面板）：
//  · 阿杰车行（市中心东侧）：出售小两厢/轿车/跑车，
//    购买后立即停在店门口路边，可随时开走；
//  · 24h 便利店（市中心西侧）：出售修理包（Q 键修车）
//    与氮气加速（C 键短时动力提升）。
//
//  金钱与任务系统共用（quest.money）；已购车辆与道具数量
//  存入 localStorage，重开网页后恢复。
// ============================================================

import * as THREE from 'three';
import { getHeight } from '../world/terrain.js';
import { mulberry32 } from '../world/city.js';

const SAVE_KEY = 'gta_shop_v1';

// ---------------- 商品定义 ----------------
export const CAR_STOCK = [
  { type: 'hatchback', name: '小两厢', price: 1500, color: 0x4a7ab8, desc: '灵活省油，城市代步首选' },
  { type: 'sedan', name: '家用轿车', price: 2600, color: 0x3a6a3a, desc: '均衡可靠，长途也稳' },
  { type: 'sport', name: '猎豹跑车', price: 6000, color: 0xb8242a, desc: '极速 155km/h，街头之王' },
];

export const ITEM_STOCK = [
  { id: 'repair', name: '修理包', price: 300, desc: 'Q 键使用：当前车辆完全修复' },
  { id: 'nitro', name: '氮气加速', price: 500, desc: 'C 键使用：5 秒动力提升 55%' },
];

// ---------------- 店铺位置 ----------------
const SHOPS = [
  { id: 'car', name: '阿杰车行', x: 88, z: -7.5, spawnX: 88, spawnZ: -2.75, kind: 'car' },
  { id: 'item', name: '24h 便利店', x: -32, z: 7.5, spawnX: 0, spawnZ: 0, kind: 'item' },
];

export class ShopSystem {
  /**
   * @param {object} ctx { scene, player, vehicles, quest, audio }
   */
  constructor(ctx) {
    this.scene = ctx.scene;
    this.player = ctx.player;
    this.vehicles = ctx.vehicles;
    this.quest = ctx.quest;
    this.audio = ctx.audio;

    this.items = { repair: 0, nitro: 0 }; // 道具库存
    this.ownedCars = [];                  // 已购车辆配置（持久化用）
    this.carRefs = [];                    // 已购车辆的场景引用（回收用）
    this.openShop = null;                 // 当前打开的商店
    this.markers = [];

    this.elPanel = document.getElementById('shop-panel');
    this.elTitle = document.getElementById('shop-title');
    this.elList = document.getElementById('shop-list');
    this.elMoney = document.getElementById('shop-money');

    this._buildMarkers();
    this._load();
    this._bindKeys();
  }

  // ==================== 场景标记（绿色 $ 悬浮牌） ====================
  _buildMarkers() {
    for (const s of SHOPS) {
      const y = getHeight(s.x, s.z);
      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.26),
        new THREE.MeshBasicMaterial({ color: 0x40c060, fog: false })
      );
      marker.position.set(s.x, y + 2.4, s.z);
      this.scene.add(marker);
      this.markers.push({ marker, baseY: y + 2.4 });
    }
  }

  // ==================== 持久化 ====================
  _save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        items: this.items, ownedCars: this.ownedCars,
      }));
    } catch (e) { /* 静默失败 */ }
  }

  _load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      this.items = { repair: 0, nitro: 0, ...(data.items || {}) };
      // 恢复已购车辆（停在车行门口沿路排开；上限 6 辆防累积）
      (data.ownedCars || []).slice(0, 6).forEach((cfg, i) => {
        this.ownedCars.push(cfg);
        this._spawnOwnedCar(cfg, i);
      });
    } catch (e) { /* 损坏存档忽略 */ }
  }

  _spawnOwnedCar(cfg, slot = 0) {
    const s = SHOPS[0]; // 车行门口
    const car = this.vehicles.spawnOwnedCar(
      s.spawnX + slot * 5.5, s.spawnZ, cfg.type, cfg.color, -Math.PI / 2);
    this.carRefs.push(car);
    return car;
  }

  // ==================== 交互 ====================
  /** 附近是否有商店（HUD 提示 / E 键判定用） */
  nearbyShop() {
    const p = this.player.pos;
    for (const s of SHOPS) {
      if (Math.hypot(s.x - p.x, s.z - p.z) < 4) return s;
    }
    return null;
  }

  /** E 键尝试打开商店（返回 true = 消费了按键） */
  interact() {
    if (this.openShop) { this.close(); return true; }
    const s = this.nearbyShop();
    if (!s) return false;
    this.open(s);
    return true;
  }

  open(shop) {
    this.openShop = shop;
    document.exitPointerLock();
    this.elTitle.textContent = shop.name;
    this._renderList();
    this.elPanel.classList.remove('hidden');
    this.audio.uiDialog();
  }

  close() {
    this.openShop = null;
    this.elPanel.classList.add('hidden');
  }

  _renderList() {
    const s = this.openShop;
    if (!s) return;
    this.elMoney.textContent = `💰 ¥${this.quest.money}`;
    const stock = s.kind === 'car' ? CAR_STOCK : ITEM_STOCK;
    this.elList.innerHTML = '';
    stock.forEach((item, idx) => {
      const price = item.price;
      const afford = this.quest.money >= price;
      const div = document.createElement('div');
      div.className = 'shop-item' + (afford ? '' : ' shop-item-poor');
      const owned = item.id ? `（持有 ${this.items[item.id]}）` : '';
      div.innerHTML = `
        <div class="shop-item-name">${idx + 1}. ${item.name} <span>¥${price}</span></div>
        <div class="shop-item-desc">${item.desc}${owned}</div>`;
      div.addEventListener('click', () => this.buy(item));
      this.elList.appendChild(div);
    });
  }

  /** 购买 */
  buy(item) {
    if (this.quest.money < item.price) {
      this.quest.ui.showBanner('钱不够，先去跑几单任务吧');
      this.audio.uiFail();
      return;
    }
    this.quest.money -= item.price;
    this.audio.purchase();

    if (item.type) {
      // 买车（上限 6 辆：超过时回收最早的车并释放资源，防止无限累积）
      const MAX_OWNED = 6;
      if (this.ownedCars.length >= MAX_OWNED) {
        const old = this.carRefs[0];
        if (old && old.playerControlled) {
          this.quest.ui.showBanner('车库存满了（6 辆），先把最早买的车开去别处');
          this.audio.uiFail();
          this.quest.money += item.price; // 退款
          return;
        }
        this.ownedCars.shift();
        if (old) this.vehicles.removeCar(old);
        this.carRefs.shift();
      }
      const cfg = { type: item.type, color: item.color };
      this.ownedCars.push(cfg);
      this._spawnOwnedCar(cfg, this.ownedCars.length - 1);
      this.quest.ui.showBanner(`已购入「${item.name}」，就停在店门口`);
    } else {
      // 买道具
      this.items[item.id]++;
      this.quest.ui.showBanner(`已购入「${item.name}」（按 ${item.id === 'repair' ? 'Q' : 'C'} 使用）`);
    }
    this._save();
    this._renderList(); // 刷新金钱显示
  }

  // ==================== 道具使用 ====================
  _bindKeys() {
    document.addEventListener('keydown', (e) => {
      // 商店面板打开时：数字键购买 / Esc 关闭
      if (this.openShop) {
        if (e.code === 'Escape') { this.close(); return; }
        const num = parseInt(e.code.replace('Digit', ''), 10);
        if (num >= 1 && num <= 9) {
          const stock = this.openShop.kind === 'car' ? CAR_STOCK : ITEM_STOCK;
          if (stock[num - 1]) this.buy(stock[num - 1]);
        }
        return;
      }
    });
  }

  /** Q 键：使用修理包（驾驶中） */
  useRepair(activeCar) {
    if (this.items.repair <= 0 || !activeCar) return false;
    if (activeCar.health >= 100) return false;
    this.items.repair--;
    activeCar.health = 100;
    this.audio.repair();
    this.quest.ui.showBanner('车辆已完全修复');
    this._save();
    return true;
  }

  /** C 键：使用氮气（驾驶中） */
  useNitro(activeCar) {
    if (this.items.nitro <= 0 || !activeCar) return false;
    this.items.nitro--;
    activeCar.boostTimer = 5;
    this.audio.nitro();
    this.quest.ui.showBanner('氮气加速！');
    this._save();
    return true;
  }

  /** 每帧：标记动画 */
  update(dt) {
    const t = performance.now() / 1000;
    for (const m of this.markers) {
      m.marker.position.y = m.baseY + Math.sin(t * 2 + m.baseY) * 0.12;
      m.marker.rotation.y += dt * 1.6;
    }
    // 面板打开时实时刷新金钱（任务奖励到账也能看到）
    if (this.openShop) this.elMoney.textContent = `💰 ¥${this.quest.money}`;
  }
}
