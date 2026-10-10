// ============================================================
// manager.js — 实体统一管理器（扩展点）
//
// 所有"会动的实体"（车辆、行人，以及未来新增类型）都在这里
// 注册与更新。新增实体类型的步骤：
//   1. 写一个 Manager（提供 spawnXxx() 和 update(dt, ctx)）；
//   2. 在 EntityManager 构造函数里实例化；
//   3. 在 update() 里调用。
// 主循环只跟 EntityManager 打交道，不需要改动。
// ============================================================

import { VehicleManager } from './vehicle.js';
import { NPCManager } from './npc.js';
import { CONFIG } from '../config.js';

export class EntityManager {
  /**
   * @param {THREE.Scene} scene
   * @param {CollisionWorld} collision
   */
  constructor(scene, collision) {
    this.vehicles = new VehicleManager(scene, collision);
    this.npcs = new NPCManager(scene);
  }

  /**
   * 生成全部初始实体
   * @param {Array} emptyBlocks 城市空街区（停车场）
   */
  spawnAll(emptyBlocks) {
    this.vehicles.spawnTraffic(CONFIG.vehicle.trafficCount);
    this.vehicles.spawnParked(emptyBlocks);
    this.npcs.spawnAll(CONFIG.npc.count);
  }

  /**
   * 每帧更新
   * @param {number} dt
   * @param {THREE.Vector3} playerPos
   */
  update(dt, playerPos) {
    this.vehicles.update(dt, playerPos);
    this.npcs.update(dt, playerPos, this.vehicles.cars);
  }
}
