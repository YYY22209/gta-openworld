// ============================================================
// noise.js — 程序化噪声工具
// 提供：带种子的二维 Simplex 噪声、分形叠加（fbm）、平滑阶跃函数
// 是地形高度、颜色抖动、物件散布等一切"自然随机"的统一来源。
// 同一种子永远生成同一个世界，保证玩家每次进入看到的地形一致。
// ============================================================

// Simplex 噪声用到的斜切常量（二维）
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

// 8 个梯度方向
const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/**
 * 创建一个带种子的二维 Simplex 噪声函数
 * @param {number} seed 随机种子（整数）
 * @returns {function(number, number): number} 噪声函数，输出范围约 [-1, 1]
 */
export function createNoise2D(seed = 1337) {
  // 用种子做线性同余随机数，对 0-255 排列表洗牌（Fisher-Yates）
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;

  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  // Simplex 主函数
  return function noise2D(xin, yin) {
    let n0 = 0, n1 = 0, n2 = 0;

    // 斜切到单纯形网格
    const sk = (xin + yin) * F2;
    const i = Math.floor(xin + sk);
    const j = Math.floor(yin + sk);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    // 判断当前点位于单纯形的哪一半
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    // 三个角点的贡献
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const g = GRAD[perm[ii + perm[jj]] & 7];
      t0 *= t0;
      n0 = t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const g = GRAD[perm[ii + i1 + perm[jj + j1]] & 7];
      t1 *= t1;
      n1 = t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const g = GRAD[perm[ii + 1 + perm[jj + 1]] & 7];
      t2 *= t2;
      n2 = t2 * t2 * (g[0] * x2 + g[1] * y2);
    }

    // 缩放到约 [-1, 1]
    return 70 * (n0 + n1 + n2);
  };
}

/**
 * 分形叠加噪声（fbm）：多倍频叠加，产生大起伏 + 小细节的自然地形
 * @param {function} noise createNoise2D 生成的噪声函数
 * @param {number} x 采样坐标 X
 * @param {number} y 采样坐标 Y
 * @param {number} octaves 叠加层数（越多细节越丰富，计算越慢）
 * @param {number} lacunarity 频率倍增系数
 * @param {number} gain 振幅衰减系数
 */
export function fbm2(noise, x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm; // 归一化回 [-1, 1] 附近
}

/**
 * 平滑阶跃函数：x 从 a 到 b 之间从 0 平滑过渡到 1（埃尔米特插值）
 * 用于城市遮罩、材质过渡等一切需要"软边界"的地方
 */
export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
