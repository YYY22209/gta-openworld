// ============================================================
// watchdog.js — 稳定性防护中心（防卡死 / 防崩溃 / 自动降级）
//
//  1. 全局异常捕获：window.onerror + unhandledrejection，
//     代码报错不冻结页面，右上角弹提示继续运行；
//     主循环内错误反复爆发时自动停机并给出恢复指引；
//  2. 内存监控：Chrome 下读取 performance.memory，
//     JS 堆占用超阈值 → 自动切换高性能画质（回调）；
//  3. 加载看门狗：初始化超时（CDN 卡死等）→ 提示刷新；
//  4. WebGL 上下文丢失：阻止默认行为并提示刷新。
// ============================================================

export class SafetyWatchdog {
  /**
   * @param {object} opts
   *   { onDegrade: Function,       内存吃紧时回调（自动切高性能画质）
   *     onLoadTimeout: Function,    初始化超时回调
   *     maxLoopErrors = 60 }       主循环连续容忍错误数
   */
  constructor(opts = {}) {
    this.onDegrade = opts.onDegrade || (() => {});
    this.onLoadTimeout = opts.onLoadTimeout || (() => {});
    this.maxLoopErrors = opts.maxLoopErrors ?? 60;

    this.loopErrors = 0;
    this.stopped = false;
    this._degradedAt = 0;

    this._toastEl = document.getElementById('error-toast');

    // ---- 全局异常捕获：不中断游戏 ----
    window.addEventListener('error', (e) => {
      this.toast('程序遇到小问题，已自动恢复');
      this._log(e.message, e.filename, e.lineno);
    });
    window.addEventListener('unhandledrejection', (e) => {
      this.toast('后台任务出现异常，已忽略');
      this._log(String(e.reason));
    });

    // ---- WebGL 上下文丢失（显卡驱动重置等） ----
    window.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.toast('显卡上下文丢失，请刷新页面恢复');
    });

    // ---- 内存监控（仅 Chrome/Edge 提供 performance.memory） ----
    if (performance.memory) {
      this._memTimer = setInterval(() => this._checkMemory(), 5000);
    }
  }

  /** 主循环调用：帧内异常由 main 的 try/catch 转到这里 */
  reportLoopError(err) {
    this.loopErrors++;
    this._log(err && err.message);
    if (this.loopErrors === 5) {
      this.toast('游戏运行异常，正在尝试自动降级恢复…');
      this.onDegrade(true); // 立即切高性能模式
    }
    if (this.loopErrors >= this.maxLoopErrors && !this.stopped) {
      this.stopped = true;
      this.toast('游戏出现持续错误，建议刷新页面（F5）重新进入', 0);
      this._log('loop stopped after', String(this.loopErrors), 'errors');
    }
    return this.stopped;
  }

  /** 主循环正常执行时调用：错误计数缓慢衰减（偶发抖动不停机） */
  reportLoopOK() {
    if (this.loopErrors > 0) this.loopErrors--;
  }

  _checkMemory() {
    const m = performance.memory;
    if (!m) return;
    // 堆占用超过限制的 72% → 自动降级（60 秒冷却，避免反复切换）
    if (m.usedJSHeapSize > m.jsHeapSizeLimit * 0.72) {
      const now = performance.now();
      if (now - this._degradedAt > 60000) {
        this._degradedAt = now;
        this.toast('内存吃紧，已自动切换高性能画质');
        this.onDegrade(true);
      }
    }
  }

  /** 加载看门狗：init() 完成（done）之前超时则提示 */
  armLoadingWatchdog(seconds = 45) {
    this._loadDone = false;
    setTimeout(() => {
      if (!this._loadDone) this.onLoadTimeout();
    }, seconds * 1000);
  }

  loadingDone() { this._loadDone = true; }

  /** 右上角错误提示（seconds=0 表示常驻） */
  toast(text, seconds = 4) {
    const el = this._toastEl;
    if (!el) return;
    el.textContent = '⚠ ' + text;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    if (seconds > 0) {
      this._toastTimer = setTimeout(() => el.classList.add('hidden'), seconds * 1000);
    }
  }

  _log(...args) {
    console.warn('[watchdog]', ...args);
  }
}

/** 递归释放一个物体子树的 GPU 资源（几何体 + 材质 + 贴图）
 *  —— 仅用于"动态生成、动态销毁"的实体（车辆/行人/任务物品/警灯），
 *  静态世界（城市/道具/地形）共享资源、常驻内存，禁止使用本函数。 */
export function disposeObjectTree(root) {
  if (!root) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      // 释放材质持有的全部贴图
      for (const key of Object.keys(m)) {
        const v = m[key];
        if (v && v.isTexture) v.dispose();
      }
      m.dispose();
    }
  });
  if (root.parent) root.parent.remove(root);
}
