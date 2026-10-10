// ============================================================
// collision.js — 轻量碰撞世界
//
// 功能：
//  1. 建筑 AABB 空间哈希（32m 网格），快速查询附近碰撞盒；
//  2. resolveCircle：圆柱体（玩家/车辆）与 AABB 的 XZ 平面推挤；
//  3. groundHeight：综合地形高度与建筑屋顶（可站上楼顶）。
//
// 性能：城市约 500+ 碰撞盒，空间哈希后每次查询只检查个位数盒子。
// ============================================================

import { getHeight } from '../world/terrain.js';

export class CollisionWorld {
  constructor(cellSize = 32) {
    this.cell = cellSize;
    /** @type {Map<string, Array>} 网格 -> 碰撞盒列表 */
    this.hash = new Map();
    this.boxes = [];
  }

  key(cx, cz) { return cx + ',' + cz; }

  /** 注册一个 AABB：{minX, maxX, minZ, maxZ, top}（底部视为 -∞） */
  addBox(b) {
    this.boxes.push(b);
    const c = this.cell;
    const x0 = Math.floor(b.minX / c), x1 = Math.floor(b.maxX / c);
    const z0 = Math.floor(b.minZ / c), z1 = Math.floor(b.maxZ / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        if (!this.hash.has(k)) this.hash.set(k, []);
        this.hash.get(k).push(b);
      }
    }
  }

  /** 查询某点附近可能接触的碰撞盒（去重） */
  query(x, z, r) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    const out = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.hash.get(this.key(cx, cz));
        if (list) for (const b of list) if (!out.includes(b)) out.push(b);
      }
    }
    return out;
  }

  /**
   * 圆柱体 XZ 推挤：把半径 r 的圆从所有相交 AABB 中推出
   * @param {THREE.Vector3} pos 圆柱中心（会被原地修改）
   * @param {number} r 半径
   * @param {number} feetY 圆柱底部高度（高于盒顶则不碰撞——站在屋顶上）
   */
  resolveCircle(pos, r, feetY) {
    const near = this.query(pos.x, pos.z, r + 1);
    let pushed = false;
    for (const b of near) {
      // 脚底高于盒顶 0.3m 以上：视为站在屋顶，不做侧向推挤
      if (feetY > b.top - 0.3) continue;

      // 圆与矩形最近点
      const nx = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const nz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      const dx = pos.x - nx, dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;

      if (d2 < r * r) {
        pushed = true;
        if (d2 > 1e-8) {
          // 圆在矩形外：沿法线推出
          const d = Math.sqrt(d2);
          pos.x = nx + (dx / d) * r;
          pos.z = nz + (dz / d) * r;
        } else {
          // 圆心陷入矩形：沿最浅穿透轴推出
          const pl = pos.x - b.minX, pr = b.maxX - pos.x;
          const pt = pos.z - b.minZ, pb = b.maxZ - pos.z;
          const m = Math.min(pl, pr, pt, pb);
          if (m === pl) pos.x = b.minX - r;
          else if (m === pr) pos.x = b.maxX + r;
          else if (m === pt) pos.z = b.minZ - r;
          else pos.z = b.maxZ + r;
        }
      }
    }
    return pushed;
  }

  /**
   * 综合地面高度：地形 + 可站立的建筑屋顶
   * @param {number} x, z 位置
   * @param {number} y 当前脚底高度（只有不高于头顶一点的屋顶才可站立）
   */
  groundHeight(x, z, y) {
    let g = getHeight(x, z);
    const near = this.query(x, z, 0.5);
    for (const b of near) {
      // 在建筑脚印内（略内缩防止贴墙悬空）
      if (x > b.minX + 0.15 && x < b.maxX - 0.15 &&
          z > b.minZ + 0.15 && z < b.maxZ - 0.15) {
        // 屋顶不高于脚底太多（下落时落上去）且比当前地面高
        if (b.top <= y + 0.55 && b.top > g) g = b.top;
      }
    }
    return g;
  }
}
