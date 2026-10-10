// ============================================================
// sky.js — 天空与时间系统
//
//  1. 渐变穹顶（顶点色，WebGPU / WebGL2 双后端兼容），跟随相机；
//  2. TIME_PRESETS：清晨 / 正午 / 黄昏 / 夜晚 四套光照氛围预设，
//     太阳方位颜色、天空色、雾色、曝光、路灯发光全部联动；
//  3. SkyDome.updateColors() 每帧可根据当前插值结果刷新穹顶颜色，
//     切换时段时天空平滑过渡（GTA 式时间感）。
// ============================================================

import * as THREE from 'three';

// ---------------- 时段预设 ----------------
// az = 太阳方位角（弧度），el = 仰角；lamp = 路灯头发光强度
export const TIME_PRESETS = {
  morning: {
    name: '清晨',
    az: Math.PI * 0.15, el: 0.22,
    sunColor: new THREE.Color(0xffd8b0), sunInt: 2.2,
    hemiSky: new THREE.Color(0xb8c8dc), hemiGround: new THREE.Color(0x8a7a5e), hemiInt: 0.6,
    zenith: new THREE.Color(0x4a6a98), horizon: new THREE.Color(0xe8c8a0),
    fog: new THREE.Color(0xd8c4ae), exposure: 1.05, lamp: 1.2,
  },
  noon: {
    name: '正午',
    az: Math.PI * 0.72, el: Math.PI * 0.28,
    sunColor: new THREE.Color(0xffe6c2), sunInt: 3.0,
    hemiSky: new THREE.Color(0xbdd2e4), hemiGround: new THREE.Color(0x8a7a5e), hemiInt: 0.85,
    zenith: new THREE.Color(0x3e6da6), horizon: new THREE.Color(0xd9e2ea),
    fog: new THREE.Color(0xc3d2de), exposure: 1.15, lamp: 0.15,
  },
  dusk: {
    name: '黄昏',
    az: Math.PI * 0.95, el: 0.10,
    sunColor: new THREE.Color(0xff9a50), sunInt: 1.6,
    hemiSky: new THREE.Color(0x9a8ab0), hemiGround: new THREE.Color(0x6a5a48), hemiInt: 0.5,
    zenith: new THREE.Color(0x2a3a68), horizon: new THREE.Color(0xe89058),
    fog: new THREE.Color(0xc8987a), exposure: 1.0, lamp: 1.8,
  },
  night: {
    name: '夜晚',
    az: Math.PI * 0.3, el: 0.35, // 月光方位
    sunColor: new THREE.Color(0x8aa4c8), sunInt: 0.35, // 月光（冷蓝弱光，仍有淡影）
    hemiSky: new THREE.Color(0x2a3850), hemiGround: new THREE.Color(0x1a1c22), hemiInt: 0.25,
    zenith: new THREE.Color(0x060a18), horizon: new THREE.Color(0x121a2a),
    fog: new THREE.Color(0x0c1420), exposure: 0.8, lamp: 2.5,
  },
};

/** 由方位角/仰角计算太阳方向单位向量 */
export function sunDirFrom(az, el, out) {
  out.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  return out.normalize();
}

// ============================================================
// SkyDome — 渐变穹顶
// ============================================================
export class SkyDome {
  constructor(scene) {
    const geo = new THREE.SphereGeometry(1800, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2 + 0.2);
    const pos = geo.attributes.position;
    const count = pos.count;

    // 预存每个顶点的归一化高度，换色时直接重算，不用重建几何
    this.yNorm = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.yNorm[i] = Math.max(0, Math.min(1, pos.getY(i) / 1800));
    }
    const colors = new Float32Array(count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.colorAttr = geo.attributes.color;

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // 初始化为正午天空
    this.updateColors(TIME_PRESETS.noon.zenith, TIME_PRESETS.noon.horizon);
  }

  /**
   * 刷新穹顶渐变色（切换时段时由主循环每帧调用，平滑过渡）
   * @param {THREE.Color} zenith 天顶色
   * @param {THREE.Color} horizon 地平线色
   */
  updateColors(zenith, horizon) {
    const arr = this.colorAttr.array;
    for (let i = 0; i < this.yNorm.length; i++) {
      const k = Math.pow(this.yNorm[i], 0.65); // 非线性：地平线色带更宽
      arr[i * 3] = horizon.r + (zenith.r - horizon.r) * k;
      arr[i * 3 + 1] = horizon.g + (zenith.g - horizon.g) * k;
      arr[i * 3 + 2] = horizon.b + (zenith.b - horizon.b) * k;
    }
    this.colorAttr.needsUpdate = true;
  }

  /** 每帧跟随相机 */
  update(camPos) {
    this.mesh.position.set(camPos.x, 0, camPos.z);
  }
}
