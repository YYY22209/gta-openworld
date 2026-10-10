// ============================================================
// hud.js — HUD 界面管理
//
// 左上角信息面板：坐标 / FPS / 渲染后端 / 模式（步行/驾驶）/ 车速
// 屏幕中央：准星 + 情境提示（如"按 E 上车"）
// F3 隐藏/显示整个 HUD。
// ============================================================

export class HUD {
  constructor() {
    this.elPos = document.getElementById('hud-pos');
    this.elFps = document.getElementById('hud-fps');
    this.elBackend = document.getElementById('hud-backend');
    this.elMode = document.getElementById('hud-mode');
    this.elMoney = document.getElementById('hud-money');
    this.elClock = document.getElementById('hud-clock');
    this.elItems = document.getElementById('hud-items');
    this.elHint = document.getElementById('hint');
    this.elRoot = document.getElementById('hud');
    this.elCross = document.getElementById('crosshair');
    this.visible = true;

    document.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.visible = !this.visible;
        this.elRoot.style.display = this.visible ? 'block' : 'none';
      }
    });
  }

  setBackend(text) {
    this.elBackend.textContent = '渲染后端: ' + text;
  }

  /**
   * 每 0.25s 刷新一次
   * @param {object} s { x, y, z, fps, mode, speedKmh, hint }
   */
  update(s) {
    if (!this.visible) return;
    this.elPos.textContent = `坐标: X ${s.x.toFixed(1)}  Y ${s.y.toFixed(1)}  Z ${s.z.toFixed(1)}`;
    this.elFps.textContent = 'FPS: ' + s.fps;
    this.elMode.textContent = s.mode === 'drive'
      ? `模式: 驾驶  车速: ${Math.abs(s.speedKmh).toFixed(0)} km/h  时段: ${s.timeName}`
      : s.mode === 'fly'
        ? `模式: 飞行观察  时段: ${s.timeName}`
        : `模式: 步行  时段: ${s.timeName}`;
    if (s.money != null && s.money !== this._lastMoney) {
      this._lastMoney = s.money;
      this.elMoney.textContent = '💰 ¥' + s.money;
    }
    if (s.clock && s.clock !== this._lastClock) {
      this._lastClock = s.clock;
      this.elClock.textContent = '🕐 ' + s.clock;
    }
    if (s.items && s.items !== this._lastItems) {
      this._lastItems = s.items;
      this.elItems.textContent = s.items;
    }

    // 情境提示（有变化才操作 DOM）
    const hint = s.hint || '';
    if (hint !== this._lastHint) {
      this._lastHint = hint;
      this.elHint.textContent = hint;
      this.elHint.style.display = hint ? 'block' : 'none';
    }
    // 驾驶/飞行时隐藏准星
    const showCross = s.mode === 'foot';
    if (showCross !== this._lastCross) {
      this._lastCross = showCross;
      this.elCross.style.display = showCross ? 'block' : 'none';
    }
  }
}
