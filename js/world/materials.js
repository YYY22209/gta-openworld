// ============================================================
// materials.js — 程序化纹理与共享材质
// 所有纹理都用 Canvas 现场绘制，不加载任何外部图片：
// 优点：零资源下载、加载快、GitHub Pages 部署时不会有 404。
// ============================================================

import * as THREE from 'three';

/**
 * 生成一张"地表细节"灰度纹理（细微噪点颗粒）。
 * 它会与地形顶点色相乘：顶点色决定大块颜色（草/泥/水泥），
 * 这张纹理负责近距离看时的颗粒细节，避免纯色地面的"塑料感"。
 * 整体亮度在 200-255 之间（接近白色），只叠加细节不改变主色调。
 */
function makeDetailTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let i = 0; i < size * size; i++) {
    // 基础亮度 226，叠加 ±28 的随机颗粒
    const v = 226 + (Math.random() - 0.5) * 56;
    data[i * 4 + 0] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // 轻微模糊，让颗粒不至于太"数码噪点"
  ctx.filter = 'blur(1px)';
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = 'none';

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; // 平铺重复
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4; // 斜角度观看时减少模糊
  return tex;
}

// 共享单例：所有地形区块共用同一份材质和纹理，节省显存
let sharedTerrainMaterial = null;

/**
 * 获取地形共享材质（MeshStandardMaterial，经典材质在
 * WebGPURenderer 下会自动转换，WebGPU / WebGL2 双后端通用）
 */
export function createTerrainMaterial() {
  if (sharedTerrainMaterial) return sharedTerrainMaterial;

  sharedTerrainMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,          // 使用逐顶点颜色（草/泥/岩/水泥混合）
    map: makeDetailTexture(),    // 细节颗粒纹理（与顶点色相乘）
    roughness: 0.95,             // 地表基本不反光
    metalness: 0.0,
  });
  return sharedTerrainMaterial;
}
