// ============================================================
// audioManager.js — 程序化音效系统（Web Audio API，零音频文件）
//
// 原理（参考 Web Audio 标准做法）：
//  振荡器(Oscillator) 产生音调，噪声缓冲(Noise Buffer) 产生
//  风声/碰撞/脚步，BiquadFilter 塑形，GainNode 做包络与混音。
//  浏览器自动播放策略：AudioContext 首次用户手势后才 resume。
//
// 音效清单：
//  引擎轰鸣（转速随车速）/ 风与环境底噪（昼夜不同）/ 夜晚蟋蟀 /
//  脚步 / 车辆碰撞 / 对话哔声 / 电话铃 / 任务成功失败旋律 /
//  购买金币声 / 警笛（通缉时循环）
// ============================================================

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ready = false;

    // 持续音源句柄
    this.engine = null;
    this.ambient = null;
    this.crickets = null;
    this.siren = null;

    // 首次任意交互时解锁音频上下文
    const unlock = () => {
      this._init();
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
  }

  _init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') this.ctx.resume();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    // 共享噪声缓冲（2 秒白噪声，循环使用）
    const len = 2 * this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this._buildEngine();
    this._buildAmbient();
    this._buildCrickets();
    this._buildSiren();
    this.ready = true;
  }

  // ---------------- 持续音源：引擎 ----------------
  _buildEngine() {
    const ctx = this.ctx;
    // 主轰鸣（锯齿波）+ 低频打底（方波）→ 低通滤波 → 增益
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const sub = ctx.createOscillator(); sub.type = 'square';
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 1.2;
    const gain = ctx.createGain(); gain.gain.value = 0;
    osc.connect(filter); sub.connect(filter);
    filter.connect(gain); gain.connect(this.master);
    osc.start(); sub.start();
    this.engine = { osc, sub, filter, gain };
  }

  /**
   * 每帧更新引擎声
   * @param {number} speed01 车速 0..1
   * @param {boolean} driving 是否在驾驶
   */
  setEngine(speed01, driving) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const rpm = 55 + speed01 * 175;
    this.engine.osc.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engine.sub.frequency.setTargetAtTime(rpm * 0.5, t, 0.08);
    this.engine.filter.frequency.setTargetAtTime(300 + speed01 * 1500, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(driving ? 0.05 + speed01 * 0.075 : 0, t, 0.15);
  }

  // ---------------- 持续音源：环境风声 ----------------
  _buildAmbient() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass'; filter.frequency.value = 380; filter.Q.value = 0.6;
    const gain = ctx.createGain(); gain.gain.value = 0.028;
    src.connect(filter); filter.connect(gain); gain.connect(this.master);
    src.start();
    this.ambient = { gain };
  }

  // ---------------- 持续音源：夜晚蟋蟀 ----------------
  _buildCrickets() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 4300;
    // 用方波 LFO 调制增益 → 断断续续的虫鸣
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 13;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5;
    const gain = ctx.createGain(); gain.gain.value = 0;
    lfo.connect(lfoGain); lfoGain.connect(gain.gain);
    osc.connect(gain); gain.connect(this.master);
    osc.start(); lfo.start();
    this.crickets = { gain };
  }

  /** 昼夜环境切换：night01 = 0（白天）→ 1（深夜） */
  setNight(night01) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.ambient.gain.gain.setTargetAtTime(0.028 - night01 * 0.016, t, 0.5);
    this.crickets.gain.gain.setTargetAtTime(night01 * 0.012, t, 0.5);
  }

  // ---------------- 持续音源：警笛 ----------------
  _buildSiren() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'triangle';
    // 双音交替：LFO 控制频率在 660/880 间切换
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 0.9;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 110;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    osc.frequency.value = 770;
    const gain = ctx.createGain(); gain.gain.value = 0;
    osc.connect(gain); gain.connect(this.master);
    osc.start(); lfo.start();
    this.siren = { gain };
  }

  /** 警笛开关（通缉时） */
  setSiren(on) {
    if (!this.ready) return;
    this.siren.gain.gain.setTargetAtTime(on ? 0.035 : 0, this.ctx.currentTime, 0.3);
  }

  // ---------------- 一次性音效 ----------------
  /** 噪声爆发（脚步/碰撞的基底） */
  _noiseBurst(dur, filterFreq, vol, type = 'lowpass') {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter); filter.connect(gain); gain.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  /** 单音（UI 提示音的基底） */
  _tone(freq, dur, vol, type = 'square', when = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain); gain.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  footstep() { this._noiseBurst(0.07, 700, 0.07); }

  /** 车辆碰撞：低频轰 + 金属噪声 */
  crash(strength01) {
    this._noiseBurst(0.25, 900, 0.12 + strength01 * 0.2);
    this._tone(58, 0.3, 0.15, 'sine');
  }

  uiDialog() { this._tone(860, 0.06, 0.05); }

  uiPhone() {
    this._tone(950, 0.12, 0.07, 'sine');
    this._tone(1250, 0.15, 0.07, 'sine', 0.14);
  }

  uiSuccess() {
    this._tone(620, 0.12, 0.08, 'triangle');
    this._tone(830, 0.12, 0.08, 'triangle', 0.12);
    this._tone(1040, 0.22, 0.09, 'triangle', 0.24);
  }

  uiFail() {
    this._tone(420, 0.18, 0.09, 'sawtooth');
    this._tone(280, 0.3, 0.09, 'sawtooth', 0.18);
  }

  uiBanner() { this._tone(700, 0.08, 0.05, 'sine'); }

  /** 购买：清脆金币声 */
  purchase() {
    this._tone(1350, 0.07, 0.08, 'square');
    this._tone(1800, 0.14, 0.08, 'square', 0.07);
  }

  /** 通缉升星：紧张提示 */
  wantedUp() {
    this._tone(520, 0.1, 0.09, 'sawtooth');
    this._tone(520, 0.14, 0.09, 'sawtooth', 0.13);
  }

  /** 被捕：沉重低音 */
  busted() {
    this._tone(180, 0.4, 0.12, 'sawtooth');
    this._tone(120, 0.6, 0.12, 'sawtooth', 0.3);
  }

  /** 氮气加速：上升呼啸 */
  nitro() { this._noiseBurst(0.6, 2400, 0.12, 'highpass'); }

  /** 修理：扳手敲击两声 */
  repair() {
    this._tone(980, 0.06, 0.08);
    this._tone(980, 0.06, 0.08, 'square', 0.15);
  }
}
