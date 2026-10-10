// ============================================================
// daynight.js — 昼夜循环系统
//
//  1. 游戏内时间连续流逝（默认 12 分钟 = 完整一天），T 键 +1 小时；
//  2. 四个关键帧（清晨5时/正午12时/黄昏18.5时/夜晚22时）之间
//     平滑插值太阳方位、颜色、雾、曝光、路灯强度，光照渐变自然；
//  3. 输出 night01（夜晚程度 0..1），驱动：路灯光、建筑亮窗、
//     车辆大灯、环境音昼夜切换；
//  4. HUD 时钟 HH:MM。
// ============================================================

import * as THREE from 'three';
import { TIME_PRESETS } from './sky.js';

// 关键帧：[时刻(小时), 预设]
const KEYS = [
  [0.0, 'night'],
  [5.0, 'morning'],
  [12.0, 'noon'],
  [18.5, 'dusk'],
  [22.0, 'night'],
  [24.0, 'night'], //  wrap 辅助
];

// 每个关键帧预设对应的“开始混合到下一帧”的过渡由插值自然完成
export class DayNightSystem {
  /**
   * @param {number} startHour 初始时刻（默认 10:00 上午）
   * @param {number} dayLengthSec 现实多少秒 = 游戏一天（默认 720s）
   */
  constructor(startHour = 10, dayLengthSec = 720) {
    this.hour = startHour;          // 0..24
    this.dayLength = dayLengthSec;
    this.night01 = 0;

    // 插值输出（结构同 LightingSystem.current，可直接喂给 updateTime）
    this.target = this._makeState();
    this._sample(this.hour, this.target, true);
  }

  _makeState() {
    return {
      name: '正午',
      az: 0, el: 0,
      sunColor: new THREE.Color(), sunInt: 1,
      hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiInt: 0.5,
      zenith: new THREE.Color(), horizon: new THREE.Color(),
      fog: new THREE.Color(), exposure: 1, lamp: 0,
    };
  }

  /** 找到 hour 所在的关键帧区间并插值出完整光照状态 */
  _sample(hour, out, snap = false) {
    let i = 0;
    while (i < KEYS.length - 2 && hour >= KEYS[i + 1][0]) i++;
    const [h0, k0] = KEYS[i];
    const [h1, k1] = KEYS[i + 1];
    const span = Math.max(0.0001, h1 - h0);
    // smoothstep 让过渡首尾更缓（日出日落渐变柔和）
    let t = (hour - h0) / span;
    t = t * t * (3 - 2 * t);

    const A = TIME_PRESETS[k0], B = TIME_PRESETS[k1];
    out.az = A.az + (B.az - A.az) * t;
    out.el = A.el + (B.el - A.el) * t;
    out.sunColor.lerpColors(A.sunColor, B.sunColor, t);
    out.sunInt = A.sunInt + (B.sunInt - A.sunInt) * t;
    out.hemiSky.lerpColors(A.hemiSky, B.hemiSky, t);
    out.hemiGround.lerpColors(A.hemiGround, B.hemiGround, t);
    out.hemiInt = A.hemiInt + (B.hemiInt - A.hemiInt) * t;
    out.zenith.lerpColors(A.zenith, B.zenith, t);
    out.horizon.lerpColors(A.horizon, B.horizon, t);
    out.fog.lerpColors(A.fog, B.fog, t);
    out.exposure = A.exposure + (B.exposure - A.exposure) * t;
    out.lamp = A.lamp + (B.lamp - A.lamp) * t;
    out.name = t < 0.5 ? A.name : B.name;

    // 夜晚程度：19 点后才入夜，5 点半后渐亮
    const n = hour >= 19.2 && hour <= 24 ? Math.min(1, (hour - 19.2) / 1.2)
            : hour >= 0 && hour < 5.5 ? 1
            : hour >= 5.5 && hour < 6.8 ? 1 - (hour - 5.5) / 1.3
            : 0;
    this.night01 = n;
    if (snap) return out;
    return out;
  }

  /** 每帧推进时间 */
  update(dt) {
    this.hour += (dt / this.dayLength) * 24;
    if (this.hour >= 24) this.hour -= 24;
    this._sample(this.hour, this.target);
    return this.target;
  }

  /** T 键：快进 1 小时 */
  skipHour() {
    this.hour = (this.hour + 1) % 24;
    this._sample(this.hour, this.target);
  }

  /** HUD 时钟文字 */
  get clockText() {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
