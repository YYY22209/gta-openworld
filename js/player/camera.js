// ============================================================
// camera.js — 相机装配（第一人称 + 驾驶追尾双模式）
//
// 步行：PointerLock 鼠标视角（yaw/pitch），第一人称；
// 驾驶：GTA 式第三人称追尾相机，指数阻尼跟随，鼠标可环绕观察
//       （松开鼠标后缓慢回正到车尾）。
// ============================================================

import * as THREE from 'three';

export class CameraRig {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLCanvasElement} canvas
   */
  constructor(camera, canvas) {
    this.camera = camera;
    this.canvas = canvas;

    this.yaw = Math.PI * 0.75; // 初始朝向城市中心方向
    this.pitch = -0.05;
    this.mode = 'foot';        // 'foot' | 'drive'
    this.baseFov = 70;

    // 驾驶模式状态
    this.orbitYaw = 0;         // 鼠标环绕偏移（自动回正）
    this.chasePos = new THREE.Vector3();
    this.chaseInit = false;

    canvas.addEventListener('click', () => canvas.requestPointerLock());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      const dx = e.movementX * 0.0022;
      const dy = e.movementY * 0.0022;
      if (this.mode === 'foot') {
        this.yaw -= dx;
        this.pitch -= dy;
        this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
      } else {
        // 驾驶：环绕偏移（限制范围，缓慢回正）
        this.orbitYaw -= dx;
        this.orbitYaw = Math.max(-1.8, Math.min(1.8, this.orbitYaw));
      }
    });
  }

  /** 步行模式：直接绑定到玩家眼睛 */
  updateFoot(player, dt) {
    const eye = player.getEyePosition(_v1);
    this.camera.position.copy(eye);
    this.camera.quaternion.setFromEuler(_e1.set(this.pitch, this.yaw, 0, 'YXZ'));

    // 奔跑 FOV 拉伸（70 → 76）
    const targetFov = this.baseFov + player.fovKick * 6;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * 驾驶模式：追尾相机
   * @param {Vehicle} car 正在驾驶的车辆
   */
  updateDrive(car, dt) {
    // 环绕偏移缓慢回正
    this.orbitYaw *= Math.max(0, 1 - dt * 1.5);

    const angle = car.heading + Math.PI + this.orbitYaw; // 车尾方向
    const dist = 8.0, height = 3.2;
    _v1.set(
      car.pos.x + Math.sin(angle) * dist,
      car.pos.y + height,
      car.pos.z + Math.cos(angle) * dist
    );

    if (!this.chaseInit) {
      this.chasePos.copy(_v1);
      this.chaseInit = true;
    } else {
      // 帧率无关的指数阻尼（参考成熟驾驶游戏做法）
      const k = 1 - Math.exp(-6 * dt);
      this.chasePos.lerp(_v1, k);
    }

    this.camera.position.copy(this.chasePos);
    _v2.set(car.pos.x, car.pos.y + 1.4, car.pos.z);
    this.camera.lookAt(_v2);

    // 速度感：随车速拉 FOV（70 → 80）
    const targetFov = this.baseFov + Math.min(1, Math.abs(car.speed) / 30) * 10;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
    }
  }

  /** 切换模式时重置追尾状态 */
  setMode(mode) {
    this.mode = mode;
    if (mode === 'foot') this.chaseInit = false;
  }

  // ---------------- 飞行观察模式（V 键） ----------------
  /** 进入飞行：从当前相机位置开始 */
  enterFly() {
    this.flyPos = this.flyPos || new THREE.Vector3();
    this.flyPos.copy(this.camera.position);
    // 复用步行视角的 yaw/pitch
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.pitch = e.x;
  }

  /**
   * 飞行模式每帧更新
   * @param {Set} keys 按键集合（WASD 平移 / Space 升 / KeyC 降 / Shift 加速）
   */
  updateFly(keys, dt) {
    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 60 : 22;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const lift = (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') ? 1 : 0);

    // 平移（朝向的俯仰也参与前进方向，指哪飞哪）
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.flyPos.x += ((-sin * cp) * fwd + cos * strafe) * speed * dt;
    this.flyPos.z += ((-cos * cp) * fwd - sin * strafe) * speed * dt;
    this.flyPos.y += ((-sp) * fwd + lift) * speed * dt;
    this.flyPos.y = Math.max(2, Math.min(500, this.flyPos.y));

    this.camera.position.copy(this.flyPos);
    this.camera.quaternion.setFromEuler(_e1.set(this.pitch, this.yaw, 0, 'YXZ'));
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _e1 = new THREE.Euler(0, 0, 0, 'YXZ');
