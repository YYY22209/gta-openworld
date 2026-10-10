// ============================================================
// graphics.js — O 键画质设置面板
//
// 预设一键切换（运行时热生效，无需重启）：
//  1 高性能 —— 像素比 1.0、关阴影、关草丛、加浓雾、近裁剪（低配机/集显）
//  2 平衡   —— 像素比 1.5、2048 阴影（默认，启动档位）
//  3 高质量 —— 像素比 2.0、2048 阴影
//  4 极致   —— 像素比 2.0、4096 阴影、超远视距
// 附加开关：5 暗角  6 草丛
// 注：内存/性能看门狗自动降级时也会切到 1 高性能。
// ============================================================

export class GraphicsPanel {
  /**
   * @param {object} refs { renderer, camera, scene, lighting, props }
   */
  constructor(refs) {
    this.renderer = refs.renderer;
    this.camera = refs.camera;
    this.scene = refs.scene;
    this.lighting = refs.lighting;
    this.props = refs.props;

    this.baseFog = this.scene.fog.density;
    this.baseFar = this.camera.far;
    this.vignetteOn = true;
    this.grassOn = true;
    this.preset = 2;

    this.el = document.getElementById('gfx-panel');
    this.elPreset = document.getElementById('gfx-preset-name');
    this._render();

    document.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyO') return;
      this.toggle();
    });

    // 面板打开时数字键切换档位
    document.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      const n = parseInt(e.code.replace('Digit', ''), 10);
      if (n >= 1 && n <= 4) this.applyPreset(n);
      if (n === 5) this.toggleVignette();
      if (n === 6) this.toggleGrass();
    });
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  toggle() {
    this.el.classList.toggle('hidden');
    if (this.isOpen) document.exitPointerLock();
  }

  applyPreset(n) {
    const dpr = window.devicePixelRatio || 1;
    const P = {
      1: { name: '高性能', pixel: 1.0, shadow: false, shadowSize: 1024, far: this.baseFar * 0.55, fogMul: 1.35, grass: false },
      2: { name: '平衡', pixel: Math.min(dpr, 1.5), shadow: true, shadowSize: 2048, far: this.baseFar, fogMul: 1.0, grass: true },
      3: { name: '高质量', pixel: Math.min(dpr, 2), shadow: true, shadowSize: 2048, far: this.baseFar, fogMul: 1.0, grass: true },
      4: { name: '极致', pixel: Math.min(dpr, 2), shadow: true, shadowSize: 4096, far: this.baseFar * 1.25, fogMul: 0.9, grass: true },
    }[n];
    if (!P) return;
    this.preset = n;

    // 渲染分辨率
    this.renderer.setPixelRatio(P.pixel);

    // 阴影开关 + 阴影贴图分辨率（换尺寸必须释放旧贴图才会重建）
    const sun = this.lighting.sun;
    sun.castShadow = P.shadow;
    if (sun.shadow.mapSize.x !== P.shadowSize) {
      sun.shadow.mapSize.set(P.shadowSize, P.shadowSize);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }

    // 视距 + 雾
    this.camera.far = P.far;
    this.camera.updateProjectionMatrix();
    this.scene.fog.density = this.baseFog * P.fogMul;

    // 草丛（高性能档强制关闭，其余档位恢复）
    if (P.grass === false) {
      this.grassOn = false;
      if (this.props.grassGroup) this.props.grassGroup.visible = false;
    } else if (!this.grassOn) {
      this.grassOn = true;
      if (this.props.grassGroup) this.props.grassGroup.visible = true;
    }

    this._render();
  }

  toggleVignette() {
    this.vignetteOn = !this.vignetteOn;
    const v = document.getElementById('vignette');
    if (v) v.style.display = this.vignetteOn ? 'block' : 'none';
    this._render();
  }

  toggleGrass() {
    this.grassOn = !this.grassOn;
    if (this.props.grassGroup) this.props.grassGroup.visible = this.grassOn;
    this._render();
  }

  _render() {
    const names = { 1: '流畅', 2: '均衡', 3: '高清', 4: '极致' };
    this.el.innerHTML = `
      <div class="gfx-title">画质设置</div>
      <div class="gfx-row${this.preset === 1 ? ' gfx-active' : ''}">1 · 高性能 <span>低配机 / 集成显卡</span></div>
      <div class="gfx-row${this.preset === 2 ? ' gfx-active' : ''}">2 · 平衡 <span>默认</span></div>
      <div class="gfx-row${this.preset === 3 ? ' gfx-active' : ''}">3 · 高质量 <span>2K 渲染</span></div>
      <div class="gfx-row${this.preset === 4 ? ' gfx-active' : ''}">4 · 极致 <span>4096 阴影 · 超远视距</span></div>
      <div class="gfx-sep"></div>
      <div class="gfx-row">5 · 镜头暗角 <span>${this.vignetteOn ? '开' : '关'}</span></div>
      <div class="gfx-row">6 · 草丛细节 <span>${this.grassOn ? '开' : '关'}</span></div>
      <div class="gfx-tip">按数字键切换 · O 关闭面板</div>`;
  }
}
