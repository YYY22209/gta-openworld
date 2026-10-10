// ============================================================
// navigation.js — 任务导航系统
//
//  1. 3D 目标光柱：GTA 式黄色光柱 + 地面光圈，标记任务目标；
//  2. HUD 方向箭头：屏幕下方持续指向目标方向；
//  3. 右上角目标文字：实时显示当前任务目标与倒计时。
// ============================================================

import * as THREE from 'three';
import { getHeight } from '../world/terrain.js';

export class Navigation {
  constructor(scene) {
    this.scene = scene;

    // ---- 目标光柱（半透明加色圆柱，远看醒目） ----
    const beamGeo = new THREE.CylinderGeometry(1.1, 1.1, 36, 16, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffc832,
      transparent: true,
      opacity: 0.30,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });
    this.beam = new THREE.Mesh(beamGeo, beamMat);
    this.beam.visible = false;
    this.beam.renderOrder = 50;
    scene.add(this.beam);

    // ---- 地面光圈 ----
    const ringGeo = new THREE.RingGeometry(1.4, 2.1, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffc832, transparent: true, opacity: 0.75,
      depthWrite: false, fog: false,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.visible = false;
    this.ring.renderOrder = 50;
    scene.add(this.ring);

    // ---- HUD 元素 ----
    this.elObjective = document.getElementById('quest-objective');
    this.elArrow = document.getElementById('quest-arrow');

    this.target = null; // {x, z, label, timeLeft, extra}
    this.pulse = 0;
  }

  /** 设置当前导航目标（null = 隐藏） */
  setTarget(t) {
    this.target = t;
    const show = !!t;
    this.beam.visible = show;
    this.ring.visible = show;
    this.elObjective.style.display = show ? 'block' : 'none';
    this.elArrow.style.display = show ? 'flex' : 'none';
    if (show) {
      const gy = t.y ?? getHeight(t.x, t.z); // 贴地形，山坡/河滩也不悬空
      this.beam.position.set(t.x, gy + 18, t.z);
      this.ring.position.set(t.x, gy + 0.15, t.z);
    }
  }

  /**
   * 每帧更新
   * @param {THREE.Vector3} playerPos
   * @param {number} yaw 相机朝向（步行时玩家视角，驾驶时用车头方向）
   * @param {object} info {label, timeLeft, extra} 目标文字信息
   */
  update(dt, playerPos, yaw, info) {
    this.pulse += dt;

    // 光柱呼吸效果
    if (this.beam.visible) {
      const s = 1 + Math.sin(this.pulse * 3) * 0.08;
      this.beam.scale.set(s, 1, s);
      this.beam.material.opacity = 0.24 + Math.sin(this.pulse * 3) * 0.08;
      this.ring.rotation.y += dt * 0.8;
      // 目标点位置可能被动态更新（如跟随目标车）
      if (this.target) {
        const gy = this.target.y ?? getHeight(this.target.x, this.target.z);
        this.beam.position.set(this.target.x, gy + 18, this.target.z);
        this.ring.position.set(this.target.x, gy + 0.15, this.target.z);
      }
    }

    if (!this.target || !info) return;

    // ---- 目标文字（右上角） ----
    let text = info.label;
    if (info.timeLeft != null) {
      const m = Math.floor(info.timeLeft / 60);
      const s = Math.max(0, Math.floor(info.timeLeft % 60));
      text += `<br><span class="quest-timer">⏱ ${m}:${String(s).padStart(2, '0')}</span>`;
    }
    if (info.extra) text += `<br><span class="quest-extra">${info.extra}</span>`;
    const dist = Math.hypot(this.target.x - playerPos.x, this.target.z - playerPos.z);
    text += `<br><span class="quest-dist">${dist.toFixed(0)} m</span>`;
    this.elObjective.innerHTML = text;

    // ---- 方向箭头（世界方位 → 相机相对方位） ----
    // 目标方位角与视线方位角（约定同 camera.js：前向 = (-sin yaw, -cos yaw)）
    const phiT = Math.atan2(this.target.x - playerPos.x, this.target.z - playerPos.z);
    const phiF = yaw + Math.PI;
    let rel = phiT - phiF;
    // 归一化到 [-PI, PI]
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    // CSS 旋转（向上为 0 度，顺时针为正）
    this.elArrow.style.transform = `translateX(-50%) rotate(${-rel}rad)`;
    // 近距离时箭头变淡
    this.elArrow.style.opacity = dist < 8 ? 0.25 : 0.9;
  }
}
