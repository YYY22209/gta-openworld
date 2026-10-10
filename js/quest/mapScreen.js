// ============================================================
// mapScreen.js — 大地图 + 任务列表界面（M 键）
//
//  左侧 Canvas 俯视图：城市路网 / 河流 / 高速 / 玩家位置朝向 /
//    任务标记（主线黄点、支线白点、当前目标橙点）；
//  右侧任务列表：主线与支线的状态、简介、奖励。
//  底图用 Canvas 绘制静态几何（性能最优），动态标记每帧叠加。
// ============================================================

import { CONFIG } from '../config.js';
import { riverCenterX } from '../world/terrain.js';

const WORLD = CONFIG.world.mapHalf; // 1024，世界半宽

export class MapScreen {
  constructor() {
    this.root = document.getElementById('map-screen');
    this.canvas = document.getElementById('map-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.listEl = document.getElementById('map-quest-list');
    this.isOpen = false;
    this.pulse = 0;

    // 世界坐标 → 地图坐标 的缩放
    this.scale = this.canvas.width / (WORLD * 2);
  }

  toggle(show) {
    this.isOpen = show ?? !this.isOpen;
    this.root.classList.toggle('hidden', !this.isOpen);
    if (this.isOpen) document.exitPointerLock();
  }

  /** 世界坐标 → 画布坐标 */
  _w2c(x, z) {
    return [(x + WORLD) * this.scale, (z + WORLD) * this.scale];
  }

  /**
   * 绘制（打开时每帧调用）
   * @param {object} s {playerPos, yaw, givers, objective}
   *   givers: [{x, z, type, available}]
   *   objective: {x, z} | null
   */
  render(s, dt) {
    if (!this.isOpen) return;
    this.pulse += dt;
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;

    // ---- 底图：陆地 ----
    ctx.fillStyle = '#243020';
    ctx.fillRect(0, 0, W, H);

    // 城市区域（灰 blocks 示意）
    const c = CONFIG.world.city;
    ctx.fillStyle = '#3a3f3a';
    const [ccx, ccz] = this._w2c(0, 0);
    const cr = c.radius * this.scale;
    ctx.beginPath();
    ctx.arc(ccx, ccz, cr, 0, Math.PI * 2);
    ctx.fill();

    // 城市路网
    ctx.strokeStyle = '#555b55';
    ctx.lineWidth = 2;
    const lines = Math.floor(c.radius / 64);
    for (let k = -lines; k <= lines; k++) {
      const p = k * 64;
      const [x1, z1] = this._w2c(p, -lines * 64);
      const [x2, z2] = this._w2c(p, lines * 64);
      ctx.beginPath(); ctx.moveTo(x1, z1); ctx.lineTo(x2, z2); ctx.stroke();
      const [x3, z3] = this._w2c(-lines * 64, p);
      const [x4, z4] = this._w2c(lines * 64, p);
      ctx.beginPath(); ctx.moveTo(x3, z3); ctx.lineTo(x4, z4); ctx.stroke();
    }

    // 高速公路
    {
      const hx = Math.floor(c.radius / 64) * 64 + 150;
      const [x1, z1] = this._w2c(hx, -WORLD + 24);
      const [x2, z2] = this._w2c(hx, WORLD - 24);
      ctx.strokeStyle = '#6a6f78';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x1, z1); ctx.lineTo(x2, z2); ctx.stroke();
    }

    // 河流（沿河道中心线绘制）
    ctx.strokeStyle = '#2e5a7e';
    ctx.lineWidth = 26 * this.scale * 2;
    ctx.beginPath();
    for (let z = -WORLD; z <= WORLD; z += 32) {
      const [px, pz] = this._w2c(riverCenterX(z), z);
      if (z === -WORLD) ctx.moveTo(px, pz);
      else ctx.lineTo(px, pz);
    }
    ctx.stroke();

    // 地图边界（边缘山脉）
    ctx.strokeStyle = '#1a2416';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);

    // ---- 任务标记 ----
    for (const g of s.givers) {
      const [gx, gz] = this._w2c(g.x, g.z);
      ctx.beginPath();
      ctx.arc(gx, gz, 5, 0, Math.PI * 2);
      ctx.fillStyle = g.type === 'main' ? '#ffc832' : '#e8e8e8';
      ctx.fill();
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 当前目标（橙色呼吸圈）
    if (s.objective) {
      const [ox, oz] = this._w2c(s.objective.x, s.objective.z);
      const r = 7 + Math.sin(this.pulse * 4) * 2.5;
      ctx.beginPath();
      ctx.arc(ox, oz, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff8820';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // ---- 玩家位置与朝向 ----
    {
      const [px, pz] = this._w2c(s.playerPos.x, s.playerPos.z);
      const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
      ctx.fillStyle = '#40c8ff';
      ctx.strokeStyle = '#083040';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + fx * 10, pz + fz * 10);
      ctx.lineTo(px - fz * 5 - fx * 4, pz + fx * 5 - fz * 4);
      ctx.lineTo(px + fz * 5 - fx * 4, pz - fx * 5 - fz * 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  /** 刷新右侧任务列表 */
  renderList(quests) {
    if (!this.isOpen) return;
    const stateName = { available: '可接取', active: '进行中', done: '已完成', locked: '未解锁' };
    let html = '';
    for (const q of quests) {
      const dot = q.type === 'main' ? '🟡' : '⚪';
      html += `<div class="map-quest map-quest-${q.state}">
        <div class="map-quest-title">${dot} ${q.name} <span>${stateName[q.state]}</span></div>
        <div class="map-quest-brief">${q.brief}</div>
        <div class="map-quest-reward">奖励：${q.rewardDesc}</div>
      </div>`;
    }
    this.listEl.innerHTML = html;
  }
}
