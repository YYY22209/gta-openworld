// ============================================================
// renderer.js — 渲染器初始化（WebGPU 优先，自动降级 WebGL2）
//
// 依据 Three.js 官方 WebGPU 迁移指南的要点实现：
//  1. 统一从 'three/webgpu' 入口导入（importmap 已映射 'three'）；
//  2. WebGPURenderer 初始化是异步的，必须 await init() 再渲染；
//  3. 主循环必须使用 setAnimationLoop（不能用 requestAnimationFrame）；
//  4. 浏览器不支持 WebGPU 时渲染器自动回退 WebGL2 后端，
//     业务代码零改动；这里再用 try/catch 兜住两个后端都失败的极端情况。
// ============================================================

import * as THREE from 'three';

/**
 * 创建并初始化渲染器
 * @param {HTMLCanvasElement} canvas 页面上的画布元素
 * @returns {Promise<{renderer: THREE.WebGPURenderer, backend: string}>}
 */
export async function createRenderer(canvas) {
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,        // 抗锯齿（WebGPU 下为 MSAA）
    forceWebGL: false,      // 不强制 WebGL，让渲染器自己选最优后端
  });

  // 异步初始化：WebGPU 设备申请失败时会自动切到 WebGL2 后端；
  // 两个后端都不可用（极老设备）时 init 会抛错，向上抛出由入口提示用户
  await renderer.init();

  // init 完成后才能可靠地判断实际后端
  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2（兼容模式）';

  // 尺寸与像素比（默认上限 1.5：平衡档初始负载，O 键画质面板可调到更高）
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // 写实色调基础：ACES 电影级色调映射（GTA 质感的关键一步，后续 postfx 继续强化）
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // 阴影（模块5 光照系统会配置具体的灯与阴影相机）
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // 窗口大小变化时自适应
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, backend };
}
