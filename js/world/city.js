// ============================================================
// city.js — 程序化城市生成器（v4：照片级真实感深化）
//
// v4 新增：
//  【建筑类型】新增 老旧居民楼(old) 与 废弃小楼(abandoned)，
//    城市不再只有"新楼"：老楼砖墙重污渍防盗窗，废楼木板封窗；
//  【立面做旧】墙根发黑接地 / 顶部水渍垂痕 / 涂料剥落露底 /
//    张贴广告残留 / 底层涂鸦 / 防盗窗栏杆 / 办公室玻璃天空反光；
//  【屋顶细节】天台围栏 / 广告牌支架(带广告画面) / 屋顶杂物；
//  【阳台杂物】部分阳台堆放箱子杂物（随机色）。
//  旧特性保留：多体量组合、纹理双变体、实例化合批、AABB 碰撞。
// ============================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { getHeight, getSlope } from './terrain.js';

const FLOOR_H = 3.2;

/** 确定性随机数（mulberry32） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// 立面纹理 v4
// ============================================================
function makeFacadeTexture(style, floors, seed) {
  const W = 128, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(seed);

  // 夜窗发光画布：纯黑底 + 仅亮窗位置绘制暖光（作 emissiveMap，
  // 夜晚由昼夜系统提升 emissiveIntensity，建筑窗户逐户亮起）
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = W; glowCanvas.height = H;
  const gctx = glowCanvas.getContext('2d');
  gctx.fillStyle = '#000000';
  gctx.fillRect(0, 0, W, H);
  const lit = (x, y, w, h, bright = 1) => {
    const v = 140 + rand() * 115 * bright;
    gctx.fillStyle = `rgb(${v | 0},${v * 0.72 | 0},${v * 0.38 | 0})`;
    gctx.fillRect(x, y, w, h);
  };

  const isOld = style === 'old';
  const isAbandoned = style === 'abandoned';

  // ---- 墙面底色 ----
  const wallColors = {
    office: ['#66727e', '#5a6672', '#707a84'],
    residential: ['#b3a28a', '#a89a86', '#bfae96', '#9c948a'],
    old: ['#8a7a64', '#7d7268', '#93805f', '#6e6258'],
    abandoned: ['#6a655c', '#5d5a52', '#615a4e'],
    shop: ['#a1907a', '#b0a088', '#948a7c'],
    house: ['#c0b298', '#b2aa9c', '#c8b8a0', '#b8988a'],
  };
  const palette = wallColors[style];
  ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
  ctx.fillRect(0, 0, W, H);

  // ---- 砖墙砌缝（老楼必砖，其余居民/商铺/矮房 50%） ----
  const isBrick = isOld || isAbandoned || (style !== 'office' && rand() < 0.5);
  if (isBrick) {
    for (let y = 0; y < H; y += 5) {
      ctx.fillStyle = `rgba(0,0,0,${0.05 + rand() * 0.07})`;
      ctx.fillRect(0, y, W, 1);
      if (rand() < 0.7) {
        const off = (y / 5) % 2 === 0 ? 8 : 0;
        for (let x = off; x < W; x += 16) ctx.fillRect(x, y, 1, 5);
      }
    }
  }

  // ---- 墙面颗粒噪点 ----
  for (let i = 0; i < 500; i++) {
    const v = rand() * 40 - 20;
    ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 250 : 10},${v > 0 ? 240 : 20},${Math.abs(v) / 170})`;
    ctx.fillRect(rand() * W, rand() * H, 3, 3);
  }

  // ---- 涂料剥落（老楼/废楼/矮房/商铺：不规则露底斑块） ----
  if (isOld || isAbandoned || style === 'house' || (style === 'shop' && rand() < 0.6)) {
    const n = isAbandoned ? 8 : 4;
    for (let i = 0; i < n; i++) {
      const px = rand() * W, py = rand() * H;
      const pw = 6 + rand() * 18, ph = 5 + rand() * 12;
      // 露出的底层（更深的水泥/砖色）
      ctx.fillStyle = `rgba(${60 + rand() * 20 | 0},${55 + rand() * 18 | 0},${48 + rand() * 15 | 0},0.55)`;
      ctx.beginPath();
      ctx.ellipse(px, py, pw / 2, ph / 2, rand() * 0.6, 0, Math.PI * 2);
      ctx.fill();
      // 剥落边缘（亮边）
      ctx.strokeStyle = 'rgba(220,215,205,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // ---- 排水立管 ----
  ctx.fillStyle = 'rgba(35,32,30,0.35)';
  ctx.fillRect(3, 0, 3, H);
  ctx.fillRect(W - 6, 0, 3, H);
  ctx.fillStyle = 'rgba(35,32,30,0.5)';
  for (let y = 0; y < H; y += 24) {
    ctx.fillRect(2, y, 5, 2);
    ctx.fillRect(W - 7, y, 5, 2);
  }

  // ---- 窗户布局 ----
  const cols = style === 'house' || isAbandoned ? 3 : 6;
  const winW = W / cols;
  const winH = H / floors;
  const midCol = Math.floor(cols / 2);

  for (let f = 0; f < floors; f++) {
    const y = H - (f + 1) * winH;

    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(0, y, W, 2);

    // ========== 底层特殊处理 ==========
    if (f === 0) {
      if (style === 'shop') {
        ctx.fillStyle = '#2c2825';
        ctx.fillRect(0, y + winH * 0.25, W, winH * 0.75);
        ctx.fillStyle = 'rgba(150,180,200,0.92)';
        for (let c = 0; c < cols; c++) ctx.fillRect(c * winW + 4, y + winH * 0.42, winW - 8, winH * 0.42);
        // 夜晚：60% 商铺橱窗亮灯
        if (rand() < 0.6) lit(0, y + winH * 0.42, W, winH * 0.42, 0.9);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        for (let c = 0; c < cols; c += 2) ctx.fillRect(c * winW + 6, y + winH * 0.42, 3, winH * 0.42);
        ctx.fillStyle = '#1a1614';
        ctx.fillRect(midCol * winW + 2, y + winH * 0.35, winW - 4, winH * 0.65);
        ctx.fillStyle = 'rgba(150,180,200,0.85)';
        ctx.fillRect(midCol * winW + 5, y + winH * 0.42, winW - 10, winH * 0.45);
        ctx.fillStyle = `hsl(${Math.floor(rand() * 360)},45%,40%)`;
        ctx.fillRect(0, y, W, winH * 0.22);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        for (let t = 0; t < 5; t++) ctx.fillRect(8 + t * 24, y + winH * 0.06, 14, winH * 0.1);
        // 门脸涂鸦（30%）
        if (rand() < 0.3) drawGraffiti(ctx, rand, 0, y + winH * 0.5, W, winH * 0.4);
        continue;
      }
      if (style === 'office') {
        const b = 100 + rand() * 40;
        ctx.fillStyle = `rgb(${b * 0.5 | 0},${b * 0.65 | 0},${b * 0.8 | 0})`;
        ctx.fillRect(0, y + 2, W, winH - 3);
        ctx.fillStyle = '#14181c';
        ctx.fillRect(midCol * winW - 4, y + winH * 0.2, winW + 8, winH * 0.8);
        ctx.fillStyle = 'rgba(160,190,210,0.9)';
        ctx.fillRect(midCol * winW, y + winH * 0.28, winW, winH * 0.6);
        lit(midCol * winW, y + winH * 0.28, winW, winH * 0.6, 0.8); // 大堂夜灯
        continue;
      }
    }

    // ========== 逐窗绘制 ==========
    for (let c = 0; c < cols; c++) {
      const x = c * winW;

      // 底层中间列：单元入口大门
      if (f === 0 && c === midCol && (style === 'residential' || style === 'house' || isOld)) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(x + 3, y + winH * 0.15, winW - 6, winH * 0.85);
        ctx.fillStyle = isOld ? '#2e2419' : '#3a2e22';
        ctx.fillRect(x + 6, y + winH * 0.22, winW - 12, winH * 0.78);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x + winW / 2 - 1, y + winH * 0.22, 2, winH * 0.78);
        ctx.fillStyle = 'rgba(140,160,175,0.7)';
        ctx.fillRect(x + 8, y + winH * 0.3, winW / 2 - 10, winH * 0.3);
        ctx.fillRect(x + winW / 2 + 2, y + winH * 0.3, winW / 2 - 10, winH * 0.3);
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(x + 2, y + winH - 3, winW - 4, 1.5);
        ctx.fillRect(x + 4, y + winH - 1.5, winW - 8, 1.5);
        continue;
      }

      if (style === 'office') {
        // 玻璃幕墙：状态 + 顶部天空反光渐变
        const roll = rand();
        if (roll < 0.60) {
          const b = 120 + rand() * 90;
          ctx.fillStyle = `rgb(${b * 0.55 | 0},${b * 0.72 | 0},${b * 0.88 | 0})`;
        } else if (roll < 0.72) {
          ctx.fillStyle = '#181c20';
        } else if (roll < 0.85) {
          ctx.fillStyle = '#e8d8a8';
          lit(x + 1, y + 2, winW - 2, winH - 3); // 办公室夜间亮灯
        } else {
          const b = 110 + rand() * 40;
          ctx.fillStyle = `rgb(${b * 0.55 | 0},${b * 0.7 | 0},${b * 0.85 | 0})`;
          ctx.fillRect(x + 1, y + 2, winW - 2, winH - 3);
          ctx.fillStyle = 'rgba(225,222,215,0.9)';
          ctx.fillRect(x + 1, y + 2, winW - 2, (winH - 3) * 0.45);
          ctx.fillStyle = 'rgba(40,46,52,0.8)';
          ctx.fillRect(x, y, 1.5, winH);
          continue;
        }
        ctx.fillRect(x + 1, y + 2, winW - 2, winH - 3);
        // 天空反光（窗上部亮渐变，玻璃反射天空的关键）
        const skyRef = ctx.createLinearGradient(0, y + 2, 0, y + winH * 0.55);
        skyRef.addColorStop(0, 'rgba(235,245,255,0.40)');
        skyRef.addColorStop(1, 'rgba(235,245,255,0)');
        ctx.fillStyle = skyRef;
        ctx.fillRect(x + 1, y + 2, winW - 2, winH * 0.55);
        ctx.fillStyle = 'rgba(40,46,52,0.8)';
        ctx.fillRect(x, y, 1.5, winH);
      } else {
        const inset = 6;
        const wx = x + inset, wy = y + inset * 1.6;
        const ww = winW - inset * 2, wh = winH - inset * 3.2;

        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(wx - 1.5, wy - 1.5, ww + 3, wh + 3);

        // 废楼：40% 木板封窗
        if (isAbandoned && rand() < 0.4) {
          ctx.fillStyle = '#141210';
          ctx.fillRect(wx, wy, ww, wh);
          for (let b = 0; b < 3; b++) {
            ctx.fillStyle = `rgb(${90 + rand() * 30 | 0},${70 + rand() * 22 | 0},${50 + rand() * 15 | 0})`;
            ctx.fillRect(wx - 1, wy + b * (wh / 3) + rand() * 2, ww + 2, wh / 4);
          }
          continue;
        }

        const roll = rand();
        if (roll < 0.45) {
          const b = 80 + rand() * 70;
          ctx.fillStyle = `rgb(${b * 0.6 | 0},${b * 0.78 | 0},${b * 0.95 | 0})`;
          ctx.fillRect(wx, wy, ww, wh);
        } else if (roll < 0.58) {
          ctx.fillStyle = '#f2e2b0';
          ctx.fillRect(wx, wy, ww, wh);
          lit(wx, wy, ww, wh); // 居民窗夜间亮灯
          if (rand() < 0.4) {
            ctx.fillStyle = 'rgba(90,70,50,0.6)';
            ctx.fillRect(wx + ww * 0.3, wy + wh * 0.45, ww * 0.25, wh * 0.55);
          }
        } else if (roll < 0.68) {
          // 敞开黑洞窗：带室内深度渐变（上深下略浅）
          const inner = ctx.createLinearGradient(0, wy, 0, wy + wh);
          inner.addColorStop(0, '#0a0908');
          inner.addColorStop(1, '#1c1a16');
          ctx.fillStyle = inner;
          ctx.fillRect(wx, wy, ww, wh);
        } else if (roll < 0.82) {
          const b = 90 + rand() * 40;
          ctx.fillStyle = `rgb(${b * 0.6 | 0},${b * 0.75 | 0},${b * 0.9 | 0})`;
          ctx.fillRect(wx, wy, ww, wh);
          ctx.fillStyle = 'rgba(228,225,218,0.92)';
          ctx.fillRect(wx, wy, ww, wh * (0.3 + rand() * 0.25));
        } else {
          const b = 85 + rand() * 40;
          ctx.fillStyle = `rgb(${b * 0.6 | 0},${b * 0.75 | 0},${b * 0.9 | 0})`;
          ctx.fillRect(wx, wy, ww, wh);
          ctx.fillStyle = `hsl(${Math.floor(rand() * 60 + 10)},30%,${55 + rand() * 20}%)`;
          ctx.fillRect(wx, wy, ww * 0.24, wh);
          ctx.fillRect(wx + ww * 0.76, wy, ww * 0.24, wh);
        }

        // 窗框 + 十字棂
        ctx.strokeStyle = 'rgba(35,32,30,0.7)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(wx, wy, ww, wh);
        ctx.beginPath();
        ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh);
        ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2);
        ctx.stroke();

        // 老楼防盗窗栏杆（两根竖杆 + 外凸框）
        if (isOld && f <= 2 && rand() < 0.7) {
          ctx.strokeStyle = 'rgba(50,48,45,0.85)';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(wx - 2, wy - 2, ww + 4, wh + 4);
          ctx.beginPath();
          ctx.moveTo(wx + ww / 3, wy - 2); ctx.lineTo(wx + ww / 3, wy + wh + 2);
          ctx.moveTo(wx + (ww / 3) * 2, wy - 2); ctx.lineTo(wx + (ww / 3) * 2, wy + wh + 2);
          ctx.stroke();
        }

        // 窗台
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(wx - 2, wy + wh + 1.5, ww + 4, 2);

        // 窗下污渍垂痕
        if (rand() < (isOld ? 0.6 : 0.35)) {
          ctx.fillStyle = `rgba(25,22,18,${isOld ? 0.2 : 0.12})`;
          ctx.fillRect(wx + ww * 0.2, wy + wh + 3, ww * 0.6, 5 + rand() * (isOld ? 14 : 9));
        }

        // 窗式空调
        if ((style === 'residential' || isOld) && rand() < (isOld ? 0.5 : 0.3)) {
          ctx.fillStyle = '#c8c4bc';
          ctx.fillRect(wx + ww * 0.55, wy + wh + 3, ww * 0.4, 4.5);
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(wx + ww * 0.55, wy + wh + 6.5, ww * 0.4, 1);
        }
      }
    }

    // 老楼/废楼：层间额外霉斑
    if ((isOld || isAbandoned) && rand() < 0.6) {
      ctx.fillStyle = 'rgba(40,45,35,0.15)';
      ctx.beginPath();
      ctx.ellipse(rand() * W, y + winH / 2, 8 + rand() * 14, 4 + rand() * 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- 张贴广告残留（底层墙面） ----
  if (style !== 'office' && rand() < 0.6) {
    const py = H - winH * 0.5;
    const pw = 12 + rand() * 10, ph = 16 + rand() * 8;
    const px = rand() * (W - pw);
    ctx.fillStyle = 'rgba(225,220,205,0.75)';
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = 'rgba(60,55,50,0.5)';
    for (let t = 0; t < 4; t++) ctx.fillRect(px + 2, py + 3 + t * 4, pw - 4, 1.5);
    // 撕掉一半的旧海报
    if (rand() < 0.5) {
      ctx.fillStyle = 'rgba(225,220,205,0.35)';
      ctx.fillRect(px + pw + 6, py + 4, pw * 0.5, ph * 0.7);
    }
  }

  // ---- 顶部水渍垂痕（从楼顶向下的雨痕） ----
  for (let i = 0; i < 3; i++) {
    const sx = rand() * W;
    const len = 20 + rand() * 50;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(30,28,25,0.18)');
    g.addColorStop(1, 'rgba(30,28,25,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx, 0, 2 + rand() * 3, len);
  }

  // ---- 墙根发黑（接地痕迹：底部深色渐变 + 泥点） ----
  const grime = ctx.createLinearGradient(0, H * 0.88, 0, H);
  grime.addColorStop(0, 'rgba(22,20,16,0)');
  grime.addColorStop(1, `rgba(22,20,16,${isOld || isAbandoned ? 0.45 : 0.3})`);
  ctx.fillStyle = grime;
  ctx.fillRect(0, H * 0.88, W, H * 0.12);
  for (let i = 0; i < 20; i++) {
    ctx.fillStyle = `rgba(35,30,24,${0.2 + rand() * 0.2})`;
    ctx.fillRect(rand() * W, H - rand() * 6, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return { map: tex, glow: glowTex };
}

/** 涂鸦：几条彩色贝塞尔曲线（底层墙面/卷帘门） */
function drawGraffiti(ctx, rand, x, y, w, h) {
  const colors = ['#c04038', '#3868b0', '#d0a028', '#40a060'];
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = colors[Math.floor(rand() * colors.length)];
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x + rand() * w, y + rand() * h);
    ctx.bezierCurveTo(
      x + rand() * w, y + rand() * h,
      x + rand() * w, y + rand() * h,
      x + rand() * w, y + rand() * h
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

const facadeCache = new Map();
function getFacadeTexture(style, floors, variant, seed) {
  const key = `${style}_${floors}_${variant}`;
  if (!facadeCache.has(key)) {
    facadeCache.set(key, makeFacadeTexture(style, floors, seed + (variant === 'b' ? 5000 : 0)));
  }
  return facadeCache.get(key);
}

/** 广告牌画面纹理（彩色广告条幅） */
function makeBillboardTexture() {
  const W = 128, H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(CONFIG.world.seed ^ 0xad);
  // 背景渐变
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `hsl(${Math.floor(rand() * 360)},55%,45%)`);
  g.addColorStop(1, `hsl(${Math.floor(rand() * 360)},60%,35%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 主标题条
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(10, 12, 80, 10);
  // 副标题
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(10, 28, 60, 5);
  ctx.fillRect(10, 37, 48, 5);
  // 产品图形（圆形）
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(105, 32, 18, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ============================================================
// CityGenerator
// ============================================================
export class CityGenerator {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'City';
    this.colliders = [];
    this.emptyBlocks = [];

    this.bodyBatches = new Map();
    this.parapets = [];
    this.acUnits = [];
    this.balconies = [];
    this.canopies = [];
    this.awnings = [];
    this.waterTanks = [];
    this.antennas = [];
    this.roofAccess = [];
    this.firePlatforms = [];
    this.fireLadders = [];
    this.drainPipes = [];
    this.roofRails = [];    // 天台围栏
    this.billboards = [];   // 广告牌（面板 + 支架）
    this.balconyJunk = [];  // 阳台杂物

    this.roofMat = new THREE.MeshStandardMaterial({ color: 0x454543, roughness: 0.95 });
  }

  build() {
    this.layoutBlocks();
    this.layoutSuburbs();
    this.flushBatches();
    this.scene.add(this.group);
    return this;
  }

  layoutBlocks() {
    const c = CONFIG.world.city;
    const PITCH = 64;
    const MARGIN = 12;
    const lines = Math.floor(c.radius / PITCH);

    for (let bx = -lines; bx < lines; bx++) {
      for (let bz = -lines; bz < lines; bz++) {
        const minX = bx * PITCH + MARGIN, maxX = (bx + 1) * PITCH - MARGIN;
        const minZ = bz * PITCH + MARGIN, maxZ = (bz + 1) * PITCH - MARGIN;
        const centerX = (minX + maxX) / 2, centerZ = (minZ + maxZ) / 2;
        const distCenter = Math.hypot(centerX, centerZ);

        const rand = mulberry32(CONFIG.world.seed ^ (bx * 73856093) ^ (bz * 19349663));

        if (rand() < 0.15) {
          this.emptyBlocks.push({ minX, maxX, minZ, maxZ, cx: centerX, cz: centerZ });
          continue;
        }

        for (let lx = 0; lx < 2; lx++) {
          for (let lz = 0; lz < 2; lz++) {
            this.placeBuilding(
              minX + (lx / 2) * (maxX - minX), minX + ((lx + 1) / 2) * (maxX - minX),
              minZ + (lz / 2) * (maxZ - minZ), minZ + ((lz + 1) / 2) * (maxZ - minZ),
              distCenter, rand
            );
          }
        }
      }
    }
  }

  placeBuilding(lotMinX, lotMaxX, lotMinZ, lotMaxZ, distCenter, rand) {
    const padX = 2 + rand() * 2, padZ = 2 + rand() * 2;
    const w = (lotMaxX - lotMinX) - padX * 2;
    const d = (lotMaxZ - lotMinZ) - padZ * 2;
    if (w < 8 || d < 8) return;

    const cx = (lotMinX + lotMaxX) / 2 + (rand() - 0.5) * 2;
    const cz = (lotMinZ + lotMaxZ) / 2 + (rand() - 0.5) * 2;

    let style, floors;
    const roll = rand();
    if (distCenter < 100) {
      // 市中心：写字楼 + 少量老居民楼
      style = roll < 0.6 ? 'office' : roll < 0.85 ? 'residential' : 'old';
      floors = style === 'office' ? 8 + Math.floor(rand() * 9) : 6 + Math.floor(rand() * 5);
    } else if (distCenter < 200) {
      // 过渡区：新居民 / 老居民 / 商铺 / 小办公 混合
      style = roll < 0.30 ? 'residential' : roll < 0.48 ? 'old' : roll < 0.72 ? 'shop' : 'office';
      floors = style === 'office' ? 6 + Math.floor(rand() * 5)
           : style === 'shop' ? 2 + Math.floor(rand() * 3)
           : 4 + Math.floor(rand() * 6);
    } else {
      // 城市边缘：矮房 / 商铺 / 废弃小楼
      style = roll < 0.42 ? 'house' : roll < 0.72 ? 'shop' : 'abandoned';
      floors = style === 'abandoned' ? 2 + Math.floor(rand() * 2)
           : style === 'house' ? 1 + Math.floor(rand() * 2)
           : 2 + Math.floor(rand() * 2);
    }

    this.addBuilding(style, cx, cz, w, d, floors, rand);
  }

  layoutSuburbs() {
    const c = CONFIG.world.city;
    const rand = mulberry32(CONFIG.world.seed ^ 0x5eed);
    const highwayX = Math.floor(c.radius / 64) * 64 + 150;
    let placed = 0, tries = 0;
    while (placed < 90 && tries < 540) {
      tries++;
      const ang = rand() * Math.PI * 2;
      const r = c.radius + 40 + rand() * 220;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (getSlope(x, z) > 0.35) continue;
      if (Math.abs(x - highwayX) < 16 && Math.abs(z) < 1000) continue;
      // 郊区 10% 废弃屋
      const style = rand() < 0.1 ? 'abandoned' : 'house';
      this.addBuilding(style, x, z, 7 + rand() * 5, 7 + rand() * 5, 1 + Math.floor(rand() * 2), rand);
      placed++;
    }
  }

  bucketOf(style, floors) {
    if (style === 'office') return Math.max(4, Math.ceil(floors / 4) * 4);
    if (style === 'house' || style === 'abandoned') return 2;
    return Math.max(2, Math.ceil(floors / 2) * 2);
  }

  addBuilding(style, cx, cz, w, d, floors, rand) {
    const bucketFloors = this.bucketOf(style, floors);
    const h = bucketFloors * FLOOR_H;
    const groundY = getHeight(cx, cz);
    const baseY = groundY - 0.4;
    const variant = rand() < 0.5 ? 'a' : 'b';
    const isOld = style === 'old';

    const tint = new THREE.Color().setHSL(rand(), style === 'office' ? 0.06 : 0.10, 0.85 + rand() * 0.15);

    // --- 主体 ---
    this.pushBox(style, bucketFloors, variant, cx, baseY + h / 2, cz, w, h, d, tint);
    let roofY = baseY + h;

    // --- 侧翼配楼 ---
    if (w >= 13 && d >= 13 && rand() < 0.3) {
      const wingFloors = this.bucketOf(style, Math.max(1, bucketFloors - 2 - Math.floor(rand() * 3)));
      const wh = wingFloors * FLOOR_H;
      const w2 = w * (0.35 + rand() * 0.15);
      const d2 = d * (0.45 + rand() * 0.2);
      const sx = rand() < 0.5 ? 1 : -1;
      const sz = rand() < 0.5 ? 1 : -1;
      const wx = cx + sx * (w / 2 - w2 / 2);
      const wz = cz + sz * (d / 2 - d2 / 2);
      this.pushBox(style, wingFloors, variant, wx, baseY + wh / 2, wz, w2, wh, d2, tint);
      this.parapets.push({ cx: wx, cy: baseY + wh + 0.25, cz: wz, w: w2 + 0.3, d: d2 + 0.3 });
    }

    // --- 顶部退台 ---
    if (bucketFloors >= 6 && rand() < 0.7) {
      const topFloors = rand() < 0.5 ? 2 : 4;
      const th = topFloors * FLOOR_H;
      const tw = w * (0.62 + rand() * 0.15);
      const td = d * (0.62 + rand() * 0.15);
      this.pushBox(style, topFloors, variant, cx, roofY + th / 2, cz, tw, th, td, tint);
      this.parapets.push({ cx, cy: roofY + th + 0.25, cz, w: tw + 0.3, d: td + 0.3 });
      roofY += th;
    }

    // --- 女儿墙 ---
    this.parapets.push({ cx, cy: roofY + 0.25, cz, w: w + 0.3, d: d + 0.3 });

    // --- 天台围栏（四条细栏杆，真实天台感） ---
    if (bucketFloors >= 4) {
      const rw = w / 2 - 0.25, rd = d / 2 - 0.25;
      this.roofRails.push(
        { cx, cy: roofY + 0.55, cz: cz - rd, sx: w - 0.4, sz: 0.07 },
        { cx, cy: roofY + 0.55, cz: cz + rd, sx: w - 0.4, sz: 0.07 },
        { cx: cx - rw, cy: roofY + 0.55, cz, sx: 0.07, sz: d - 0.4 },
        { cx: cx + rw, cy: roofY + 0.55, cz, sx: 0.07, sz: d - 0.4 },
      );
    }

    // --- 屋顶广告牌（中高楼 18%，朝街道） ---
    if (bucketFloors >= 4 && rand() < 0.18) {
      const faceZ = rand() < 0.6; // 朝 +Z 街道面（或侧面）
      const bw = Math.min(w * 0.7, 8);
      this.billboards.push({
        cx: faceZ ? cx : cx + w / 2 - 0.4,
        cy: roofY + 2.2,
        cz: faceZ ? cz + d / 2 - 0.4 : cz,
        ry: faceZ ? 0 : Math.PI / 2,
        w: bw,
      });
    }

    // --- 屋顶构件 ---
    if (rand() < 0.4) {
      this.roofAccess.push({
        cx: cx + (rand() - 0.5) * w * 0.3, cy: roofY + 1.2,
        cz: cz + (rand() - 0.5) * d * 0.3, s: 0.9 + rand() * 0.4,
      });
    }
    if (rand() < (isOld ? 0.45 : 0.25) && style !== 'house' && style !== 'abandoned') {
      this.waterTanks.push({
        cx: cx + (rand() - 0.5) * w * 0.4, cy: roofY + 1.1,
        cz: cz + (rand() - 0.5) * d * 0.4, s: 0.8 + rand() * 0.5,
      });
    }
    if (rand() < 0.3 && bucketFloors >= 6) {
      this.antennas.push({
        cx: cx + (rand() - 0.5) * w * 0.3, cy: roofY + 2.5,
        cz: cz + (rand() - 0.5) * d * 0.3, s: 0.8 + rand() * 0.6,
      });
    }
    if (rand() < 0.35) {
      const n = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < n; i++) {
        this.acUnits.push({
          cx: cx + (rand() - 0.5) * w * 0.4, cy: roofY + 0.45,
          cz: cz + (rand() - 0.5) * d * 0.4, s: 0.9 + rand() * 0.5,
        });
      }
    }

    // --- 立面构件 ---
    for (const side of [-1, 1]) {
      this.drainPipes.push({
        cx: cx + side * (w / 2 - 0.35), cy: baseY + h / 2,
        cz: cz + d / 2 + 0.08, h,
      });
    }
    if (style !== 'house' && style !== 'abandoned') {
      this.canopies.push({
        cx, cy: baseY + 3.05, cz: cz + d / 2 + 0.75,
        w: Math.min(3.6, w * 0.4),
      });
    }
    if (style === 'shop') {
      this.awnings.push({
        cx, cy: baseY + 2.9, cz: cz + d / 2 + 0.6,
        w: w * (0.55 + rand() * 0.2),
        color: new THREE.Color().setHSL(rand(), 0.55, 0.45),
      });
    }
    if ((style === 'residential' || isOld) && bucketFloors >= 6) {
      for (let f = 2; f < bucketFloors; f += 2) {
        this.firePlatforms.push({ cx, cy: baseY + f * FLOOR_H + 0.5, cz: cz - d / 2 - 0.5 });
      }
      this.fireLadders.push({ cx, cy: baseY + h / 2, cz: cz - d / 2 - 0.5, h });
    }
    // 阳台板 + 阳台杂物
    if (style === 'residential' || isOld) {
      for (let f = 1; f < bucketFloors; f++) {
        const by = baseY + f * FLOOR_H;
        const bz = cz + d / 2 + 0.35;
        this.balconies.push({ cx, cz: bz, cy: by, w: Math.min(2.4, w * 0.3) });
        // 25% 阳台堆杂物（纸箱/盆桶，随机色小盒）
        if (rand() < 0.25) {
          this.balconyJunk.push({
            cx: cx + (rand() - 0.5) * 1.2, cy: by + 0.25, cz: bz,
            s: 0.25 + rand() * 0.25,
            color: new THREE.Color().setHSL(rand(), 0.3, 0.4 + rand() * 0.3),
          });
        }
      }
    }

    // --- 碰撞盒 ---
    this.colliders.push({
      minX: cx - w / 2, maxX: cx + w / 2,
      minZ: cz - d / 2, maxZ: cz + d / 2,
      top: baseY + h,
    });
  }

  pushBox(style, bucketFloors, variant, cx, cy, cz, w, h, d, tint) {
    const key = `${style}_${bucketFloors}_${variant}`;
    if (!this.bodyBatches.has(key)) this.bodyBatches.set(key, []);
    this.bodyBatches.get(key).push({ cx, cy, cz, w, h, d, tint });
  }

  flushBatches() {
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scale = new THREE.Vector3();
    this.windowMats = []; // 夜窗发光材质（昼夜系统统一调 emissiveIntensity）

    // 把列表按 160m 网格拆分 → 多个 InstancedMesh，各自计算包围球，
    // 视锥外的整片区块会被 GPU 剔除（全城实例不再无条件绘制）
    const CELL = 160;
    const chunkOf = (b) => Math.floor(b.cx / CELL) + ',' + Math.floor(b.cz / CELL);
    const forEachChunk = (list, fn) => {
      const groups = new Map();
      for (const b of list) {
        const k = chunkOf(b);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(b);
      }
      for (const sub of groups.values()) fn(sub);
    };

    // 建筑主体（带立面纹理 + 屋顶材质 + 每楼色调）
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    for (const [key, list] of this.bodyBatches) {
      const [style, floorsStr, variant] = key.split('_');
      const floors = parseInt(floorsStr, 10);
      const facade = getFacadeTexture(style, floors, variant, CONFIG.world.seed);
      const facadeMat = new THREE.MeshStandardMaterial({
        map: facade.map,
        roughness: style === 'office' ? 0.35 : 0.85,
        metalness: style === 'office' ? 0.25 : 0.0,
        // 夜窗：白天强度 0，夜晚由昼夜系统提升
        emissiveMap: facade.glow,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0,
      });
      this.windowMats.push(facadeMat);
      const mats = [facadeMat, facadeMat, this.roofMat, this.roofMat, facadeMat, facadeMat];

      forEachChunk(list, (sub) => {
        const inst = new THREE.InstancedMesh(boxGeo, mats, sub.length);
        sub.forEach((b, i) => {
          pos.set(b.cx, b.cy, b.cz); scale.set(b.w, b.h, b.d);
          matrix.compose(pos, quat, scale);
          inst.setMatrixAt(i, matrix);
          inst.setColorAt(i, b.tint);
        });
        inst.castShadow = true;
        inst.receiveShadow = true;
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        inst.computeBoundingSphere(); // 关键：实例级包围球 → 视锥裁剪生效
        inst.matrixAutoUpdate = false;
        this.group.add(inst);
      });
    }

    // 通用单色盒构件批（同样按区块拆分）
    const H = (geoParams, color, rough, list, mapper, opts = {}) => {
      if (!list.length) return;
      const geo = new THREE.BoxGeometry(...geoParams);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: opts.metal || 0 });
      forEachChunk(list, (sub) => {
        const inst = new THREE.InstancedMesh(geo, mat, sub.length);
        sub.forEach((b, i) => {
          const t = mapper(b);
          pos.set(t.x, t.y, t.z); scale.set(t.sx, t.sy, t.sz);
          matrix.compose(pos, quat, scale);
          inst.setMatrixAt(i, matrix);
          if (t.color) inst.setColorAt(i, t.color);
        });
        inst.castShadow = true;
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.matrixAutoUpdate = false;
        this.group.add(inst);
      });
    };

    H([1, 0.5, 1], 0x6e6a64, 0.9, this.parapets,
      (b) => ({ x: b.cx, y: b.cy, z: b.cz, sx: b.w, sy: 1, sz: b.d }));
    H([2.4, 2.4, 2.2], 0x8a867e, 0.85, this.roofAccess,
      (b) => ({ x: b.cx, y: b.cy, z: b.cz, sx: b.s, sy: b.s, sz: b.s }));
    H([1.3, 0.9, 1.3], 0x9a968e, 0.7, this.acUnits,
      (b) => ({ x: b.cx, y: b.cy, z: b.cz, sx: b.s, sy: b.s, sz: b.s }), { metal: 0.3 });
    H([1, 0.15, 1.5], 0x3a3d42, 0.6, this.canopies,
      (b) => ({ x: b.cx, y: b.cy, z: b.cz, sx: b.w, sy: 1, sz: 1 }), { metal: 0.4 });
    H([1, 0.12, 1.2], 0xffffff, 0.85, this.awnings,
      (b) => ({ x: b.cx, y: b.cy, z: b.cz, sx: b.w, sy: 1, sz: 1, color: b.color }));
    H([1, 0.12, 0.7], 0x8a8378, 0.9, this.balconies,
      (b) => ({ x: b.cx, y: b.cy, z: b.cz, sx: b.w, sy: 1, sz: 1 }));
    H([2.4, 0.08, 0.9], 0x3a3a3c, 0.6, this.firePlatforms,
      (b) => ({ x: b.cx, y: b.cy, z: b.cz, sx: 1, sy: 1, sz: 1 }), { metal: 0.5 });
    H([0.5, 1, 0.08], 0x3a3a3c, 0.6, this.fireLadders,
      (b) => ({ x: b.cx, y: b.cy, z: b.cz, sx: 1, sy: b.h, sz: 1 }), { metal: 0.5 });
    H([0.12, 1, 0.12], 0x4a4640, 0.7, this.drainPipes,
      (b) => ({ x: b.cx, y: b.cy, z: b.cz, sx: 1, sy: b.h, sz: 1 }));
    // 天台围栏（细金属栏杆）
    H([1, 0.9, 1], 0x555a5e, 0.5, this.roofRails,
      (b) => ({ x: b.cx, y: b.cy, z: b.cz, sx: b.sx, sy: 1, sz: b.sz }), { metal: 0.6 });
    // 阳台杂物（随机色小盒）
    H([1, 1, 1], 0xffffff, 0.9, this.balconyJunk,
      (b) => ({ x: b.cx, y: b.cy, z: b.cz, sx: b.s, sy: b.s, sz: b.s, color: b.color }));

    // 屋顶水箱
    if (this.waterTanks.length) {
      const geo = new THREE.CylinderGeometry(1.0, 1.0, 2.0, 10);
      const mat = new THREE.MeshStandardMaterial({ color: 0x7a5a48, roughness: 0.8, metalness: 0.3 });
      forEachChunk(this.waterTanks, (sub) => {
        const inst = new THREE.InstancedMesh(geo, mat, sub.length);
        sub.forEach((b, i) => {
          pos.set(b.cx, b.cy, b.cz); scale.set(b.s, b.s, b.s);
          matrix.compose(pos, quat, scale);
          inst.setMatrixAt(i, matrix);
        });
        inst.castShadow = true;
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.matrixAutoUpdate = false;
        this.group.add(inst);
      });
    }
    // 屋顶天线
    if (this.antennas.length) {
      const geo = new THREE.CylinderGeometry(0.05, 0.07, 5, 5);
      const mat = new THREE.MeshStandardMaterial({ color: 0x5a5e62, roughness: 0.5, metalness: 0.7 });
      forEachChunk(this.antennas, (sub) => {
        const inst = new THREE.InstancedMesh(geo, mat, sub.length);
        sub.forEach((b, i) => {
          pos.set(b.cx, b.cy, b.cz); scale.set(b.s, b.s, b.s);
          matrix.compose(pos, quat, scale);
          inst.setMatrixAt(i, matrix);
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.matrixAutoUpdate = false;
        this.group.add(inst);
      });
    }

    // 屋顶广告牌（面板带广告画面 + 金属支架）
    if (this.billboards.length) {
      const e = new THREE.Euler();
      // 面板
      const panelGeo = new THREE.BoxGeometry(1, 2.4, 0.12);
      const panelMat = new THREE.MeshStandardMaterial({
        map: makeBillboardTexture(), roughness: 0.6,
      });
      const panels = new THREE.InstancedMesh(panelGeo, panelMat, this.billboards.length);
      // 支架（两根立柱，合并到一个批次 → 用两倍实例）
      const postGeo = new THREE.BoxGeometry(0.14, 2.4, 0.14);
      const postMat = new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.5, metalness: 0.6 });
      const posts = new THREE.InstancedMesh(postGeo, postMat, this.billboards.length * 2);

      this.billboards.forEach((b, i) => {
        e.set(0, b.ry, 0); quat.setFromEuler(e);
        pos.set(b.cx, b.cy, b.cz); scale.set(b.w, 1, 1);
        matrix.compose(pos, quat, scale);
        panels.setMatrixAt(i, matrix);
        // 支架立柱（面板两端下方）
        for (let sIdx = 0; sIdx < 2; sIdx++) {
          const off = (sIdx === 0 ? -1 : 1) * (b.w / 2 - 0.3);
          const ox = b.ry === 0 ? off : 0;
          const oz = b.ry === 0 ? 0 : off;
          pos.set(b.cx + ox, b.cy - 1.2, b.cz + oz); scale.set(1, 1, 1);
          matrix.compose(pos, quat, scale);
          posts.setMatrixAt(i * 2 + sIdx, matrix);
        }
      });
      panels.castShadow = true;
      panels.instanceMatrix.needsUpdate = true;
      posts.instanceMatrix.needsUpdate = true;
      panels.computeBoundingSphere();
      posts.computeBoundingSphere();
      panels.matrixAutoUpdate = false;
      posts.matrixAutoUpdate = false;
      this.group.add(panels, posts);
    }
  }
}
