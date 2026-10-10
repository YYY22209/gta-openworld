// ============================================================
// lighting.js — 光照系统（GTA 质感核心）
//
//  1. 太阳平行光：PCF 软阴影，阴影相机跟随玩家（8m 量化防抖动）；
//  2. 半球环境光：天空/地面双色反弹；
//  3. 时段过渡：updateTime() 把当前光照状态向目标时段预设
//     平滑插值（太阳方位/颜色/强度、半球光、雾色、曝光），
//     切换清晨/正午/黄昏/夜晚时不会出现跳变。
// ============================================================

import * as THREE from 'three';
import { sunDirFrom, TIME_PRESETS } from './sky.js';

export class LightingSystem {
  constructor(scene) {
    // ---- 太阳 ----
    this.sun = new THREE.DirectionalLight(0xffe6c2, 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const S = 110;
    this.sun.shadow.camera.left = -S;
    this.sun.shadow.camera.right = S;
    this.sun.shadow.camera.top = S;
    this.sun.shadow.camera.bottom = -S;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 600;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // ---- 半球环境光 ----
    this.hemi = new THREE.HemisphereLight(0xbdd2e4, 0x8a7a5e, 0.85);
    scene.add(this.hemi);

    // ---- 当前光照状态（初始 = 正午，之后向目标时段持续插值） ----
    const p = TIME_PRESETS.noon;
    this.current = {
      az: p.az, el: p.el,
      sunColor: p.sunColor.clone(), sunInt: p.sunInt,
      hemiSky: p.hemiSky.clone(), hemiGround: p.hemiGround.clone(), hemiInt: p.hemiInt,
      fog: p.fog.clone(), exposure: p.exposure, lamp: p.lamp,
      zenith: p.zenith.clone(), horizon: p.horizon.clone(),
    };
    this.sunDir = new THREE.Vector3();
    this._applySunDir();
  }

  _applySunDir() {
    sunDirFrom(this.current.az, this.current.el, this.sunDir);
  }

  /**
   * 每帧把当前状态向目标时段插值（帧率无关阻尼）
   * @param {object} target TIME_PRESETS 中的一项
   * @param {number} dt
   * @returns {object} 当前插值结果（供主循环应用雾色/曝光/天空/路灯）
   */
  updateTime(target, dt) {
    const c = this.current;
    const k = 1 - Math.exp(-2.2 * dt); // 约 1.5 秒完成大半过渡

    c.az += (target.az - c.az) * k;
    c.el += (target.el - c.el) * k;
    c.sunColor.lerp(target.sunColor, k);
    c.sunInt += (target.sunInt - c.sunInt) * k;
    c.hemiSky.lerp(target.hemiSky, k);
    c.hemiGround.lerp(target.hemiGround, k);
    c.hemiInt += (target.hemiInt - c.hemiInt) * k;
    c.fog.lerp(target.fog, k);
    c.exposure += (target.exposure - c.exposure) * k;
    c.lamp += (target.lamp - c.lamp) * k;
    c.zenith.lerp(target.zenith, k);
    c.horizon.lerp(target.horizon, k);

    // 应用到光源
    this._applySunDir();
    this.sun.color.copy(c.sunColor);
    this.sun.intensity = c.sunInt;
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = c.hemiInt;

    return c;
  }

  /** 阴影相机跟随目标（8m 量化防阴影边缘闪烁） */
  update(target) {
    const qx = Math.round(target.x / 8) * 8;
    const qz = Math.round(target.z / 8) * 8;
    this.sun.position.set(
      qx + this.sunDir.x * 280,
      this.sunDir.y * 280,
      qz + this.sunDir.z * 280
    );
    this.sun.target.position.set(qx, 0, qz);
    this.sun.target.updateMatrixWorld();
  }
}
