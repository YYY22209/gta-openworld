// ============================================================
// controller.js — 玩家第一人称控制器
//
// WASD 移动 / Shift 奔跑 / Space 跳跃 / 重力落地
// 加速度模型（不是直接设速度），地面摩擦 + 空中弱控制，手感利落；
// 碰撞：AABB 推挤（不穿墙）+ 地形/屋顶高度吸附（不遁地）；
// 头部微晃 + 奔跑 FOV 拉伸，增强速度感（GTA 式反馈）。
// ============================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class PlayerController {
  /**
   * @param {CollisionWorld} collision 碰撞世界
   */
  constructor(collision) {
    this.collision = collision;
    const P = CONFIG.player;

    this.pos = new THREE.Vector3(24, 10, 24); // 脚底位置（出生在城市中）
    this.vel = new THREE.Vector3();
    this.onGround = false;
    this.radius = P.radius;

    this.keys = new Set();
    this.bobPhase = 0;     // 头部微晃相位
    this.bobAmount = 0;    // 晃动幅度（随速度）
    this.fovKick = 0;      // 奔跑 FOV 拉伸量（平滑过渡用）

    document.addEventListener('keydown', (e) => this.keys.add(e.code));
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  /** 设置出生点（放到地面上） */
  spawn(x, z) {
    this.pos.set(x, this.collision.groundHeight(x, z, 1000), z);
    this.vel.set(0, 0, 0);
  }

  /**
   * 每帧更新
   * @param {number} dt 帧间隔（秒）
   * @param {number} yaw 相机水平朝向（移动方向以它为准）
   */
  update(dt, yaw) {
    const P = CONFIG.player;

    // ---- 输入方向（以 yaw 为基准的相对移动） ----
    const fwd = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    // yaw 的前方是 (-sin, -cos)（与相机 -Z 对齐）
    let mx = (-sin) * fwd + cos * strafe;
    let mz = (-cos) * fwd + (-sin) * strafe;
    const mLen = Math.hypot(mx, mz);
    if (mLen > 0.001) { mx /= mLen; mz /= mLen; }

    const maxSpeed = running ? P.runSpeed : P.walkSpeed;

    // ---- 水平速度：加速度模型 ----
    if (mLen > 0.001) {
      const accel = this.onGround ? P.accel : P.airAccel;
      this.vel.x += mx * accel * dt;
      this.vel.z += mz * accel * dt;
      // 限制水平极速
      const hv = Math.hypot(this.vel.x, this.vel.z);
      if (hv > maxSpeed) {
        this.vel.x *= maxSpeed / hv;
        this.vel.z *= maxSpeed / hv;
      }
    } else if (this.onGround) {
      // 地面摩擦（松键快速停稳）
      const f = Math.max(0, 1 - P.friction * dt);
      this.vel.x *= f;
      this.vel.z *= f;
    }

    // ---- 跳跃与重力 ----
    if (this.keys.has('Space') && this.onGround) {
      this.vel.y = P.jumpSpeed;
      this.onGround = false;
    }
    this.vel.y -= P.gravity * dt;

    // ---- 积分位置 ----
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // ---- 碰撞：墙面推挤 ----
    this.collision.resolveCircle(this.pos, this.radius, this.pos.y);

    // ---- 碰撞：地面吸附（地形 + 屋顶） ----
    const g = this.collision.groundHeight(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= g + 0.001 && this.vel.y <= 0) {
      this.pos.y = g;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // ---- 地图边界钳制（边缘山脉内侧） ----
    const B = CONFIG.world.mapHalf - 20;
    this.pos.x = Math.max(-B, Math.min(B, this.pos.x));
    this.pos.z = Math.max(-B, Math.min(B, this.pos.z));

    // ---- 头部微晃（仅地面移动时） ----
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hSpeed > 0.5) {
      this.bobPhase += hSpeed * dt * 1.6;
      this.bobAmount = Math.min(1, this.bobAmount + dt * 6);
    } else {
      this.bobAmount = Math.max(0, this.bobAmount - dt * 6);
    }
    // 奔跑 FOV 拉伸目标值
    this.fovKick += ((running && hSpeed > 3 ? 1 : 0) - this.fovKick) * Math.min(1, dt * 8);

    this.currentSpeed = hSpeed;
  }

  /** 眼睛世界坐标（含微晃） */
  getEyePosition(out) {
    const bobY = Math.sin(this.bobPhase * 2) * 0.045 * this.bobAmount;
    const bobX = Math.sin(this.bobPhase) * 0.025 * this.bobAmount;
    out.set(this.pos.x + bobX, this.pos.y + CONFIG.player.eyeHeight + bobY, this.pos.z);
    return out;
  }
}
