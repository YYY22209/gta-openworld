// ============================================================
// main.js — 游戏启动入口与主循环（v3 完整版）
//
// 装配顺序：渲染器 → 地形(含河流/边缘山脉) → 路网 → 城市 →
// 道具 → 碰撞世界 → 天空/光照/昼夜 → 玩家 → 实体(车辆/NPC) →
// HUD → 任务 → 音效 → 通缉 → 商店
// ============================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createRenderer } from './core/renderer.js';
import { SkyDome } from './core/sky.js';
import { LightingSystem } from './core/lighting.js';
import { DayNightSystem } from './core/daynight.js';
import { TerrainManager } from './world/terrain.js';
import { RoadNetwork } from './world/roads.js';
import { CityGenerator } from './world/city.js';
import { PropsGenerator } from './world/props.js';
import { CollisionWorld } from './player/collision.js';
import { PlayerController } from './player/controller.js';
import { CameraRig } from './player/camera.js';
import { EntityManager } from './entities/manager.js';
import { HUD } from './ui/hud.js';
import { QuestManager } from './quest/questManager.js';
import { AudioManager } from './audio/audioManager.js';
import { PoliceSystem } from './police/policeSystem.js';
import { ShopSystem } from './shop/shopSystem.js';
import { GraphicsPanel } from './ui/graphics.js';
import { SafetyWatchdog } from './core/watchdog.js';

function setLoading(text, pct) {
  const el = document.getElementById('loading-status');
  if (el) el.textContent = text;
  const bar = document.getElementById('loading-bar-fill');
  if (bar && pct != null) bar.style.width = `${Math.round(pct * 100)}%`;
}

// ---------------- 启动流程 ----------------
// 1) 手机端拦截；2) 首页点"开始" → 解锁音频 → init()
(function bootstrap() {
  const isMobile = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);

  const home = document.getElementById('home');
  const mobileBlock = document.getElementById('mobile-block');

  if (isMobile) {
    home.classList.add('hidden');
    mobileBlock.classList.remove('hidden');
    return; // 不初始化任何 3D 资源
  }

  document.getElementById('start-btn').addEventListener('click', () => {
    home.classList.add('hidden');
    document.getElementById('loading').classList.remove('hidden');
    // 首页点击是首个用户手势：同时唤醒音频上下文
    document.dispatchEvent(new Event('pointerdown'));
    // 让首页淡出后再启动（避免卡顿感）
    setTimeout(() => init().catch((err) => {
      console.error('游戏初始化失败:', err);
      setLoading('初始化失败: ' + err.message + '，请刷新重试', 0);
    }), 60);
  }, { once: true });
})();

async function init() {
  // 画质/任务引用（供看门狗回调安全访问）
  let gfx = null, quest = null;

  // 稳定性看门狗：初始化超时保护（CDN 卡死等场景）
  const watchdog = new SafetyWatchdog({
    onDegrade: (auto) => {
      if (gfx) gfx.applyPreset(1);
      if (quest) quest.ui.showBanner('性能保护：已自动切换高性能画质');
    },
    onLoadTimeout: () => {
      setLoading('资源加载超时：请检查网络（需要访问 unpkg.com CDN）后按 F5 刷新重试', 0.02);
    },
  });
  watchdog.armLoadingWatchdog(45);

  // ---------------- 1. 渲染器 ----------------
  setLoading('正在初始化渲染器（WebGPU / WebGL2）...', 0.05);
  const canvas = document.getElementById('game-canvas');
  let renderer, backend;
  try {
    ({ renderer, backend } = await createRenderer(canvas));
  } catch (err) {
    setLoading('你的浏览器/显卡不支持 WebGPU 和 WebGL2，无法启动 3D 渲染。', 0);
    console.error('渲染器初始化失败:', err);
    return;
  }
  watchdog.loadingDone();
  renderer.toneMappingExposure = CONFIG.render.exposure;

  // ---------------- 2. 场景 / 相机 / 雾 ----------------
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(CONFIG.render.fogColor, CONFIG.render.fogDensity);

  const camera = new THREE.PerspectiveCamera(
    70, window.innerWidth / window.innerHeight, 0.1, CONFIG.render.far
  );
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // ---------------- 3. 地形（2048m 固定地图，分批生成带进度） ----------------
  const terrain = new TerrainManager(scene);
  await terrain.buildAll((p) => setLoading(`正在生成地形... ${(p * 100).toFixed(0)}%`, 0.08 + p * 0.47));

  // ---------------- 4. 路网 / 城市 / 道具 ----------------
  setLoading('正在铺设路网...', 0.58);
  await tick();
  new RoadNetwork(scene).build();

  setLoading('正在建造城市...', 0.66);
  await tick();
  const city = new CityGenerator(scene).build();

  setLoading('正在摆放街道道具...', 0.76);
  await tick();
  const props = new PropsGenerator(scene).build({ emptyBlocks: city.emptyBlocks });

  // ---------------- 5. 碰撞世界 ----------------
  const collision = new CollisionWorld(32);
  for (const box of city.colliders) collision.addBox(box);

  // ---------------- 6. 天空 / 光照 / 昼夜 ----------------
  const sky = new SkyDome(scene);
  const lighting = new LightingSystem(scene);
  const daynight = new DayNightSystem(10, 720); // 10:00 开始，12 分钟一天

  // ---------------- 7. 玩家 ----------------
  const player = new PlayerController(collision);
  player.spawn(24, 7.5); // 出生在人行道边（身旁马路上有一辆红色轿车可试驾）
  const rig = new CameraRig(camera, canvas);

  // ---------------- 8. 实体（车辆 + NPC） ----------------
  setLoading('正在生成车辆与行人...', 0.86);
  await tick();
  const entities = new EntityManager(scene, collision);
  entities.spawnAll(city.emptyBlocks);

  // ---------------- 9. HUD / 任务 / 音效 / 通缉 / 商店 ----------------
  const hud = new HUD();
  hud.setBackend(backend);

  const audio = new AudioManager();

  quest = new QuestManager({
    scene, player,
    vehicles: entities.vehicles,
    npcs: entities.npcs,
    audio,
  });

  const police = new PoliceSystem({
    scene, player,
    vehicles: entities.vehicles,
    npcs: entities.npcs,
    quest, audio, collision,
  });

  const shop = new ShopSystem({
    scene, player,
    vehicles: entities.vehicles,
    quest, audio,
  });

  // 画质设置面板（O 键，运行时热切换；默认"平衡"档，降低初始负载）
  gfx = new GraphicsPanel({ renderer, camera, scene, lighting, props });
  gfx.applyPreset(2);

  // ---------------- 10. 时段 / 上下午 / 飞行 / 道具按键 ----------------
  let mode = 'foot'; // 'foot' | 'drive' | 'fly'
  let modeBeforeFly = 'foot';

  document.addEventListener('keydown', (e) => {
    // T：时间快进 1 小时
    if (e.code === 'KeyT') { daynight.skipHour(); return; }

    // M：大地图 / 任务列表
    if (e.code === 'KeyM') { quest.map.toggle(); return; }

    // V：飞行观察模式
    if (e.code === 'KeyV') {
      if (mode === 'fly') {
        // 退出飞行：回到之前的状态（步行时落回镜头正下方地面）
        mode = modeBeforeFly;
        if (mode === 'drive' && !entities.vehicles.activeCar) mode = 'foot';
        rig.setMode(mode === 'drive' ? 'drive' : 'foot');
        if (mode === 'foot') player.spawn(rig.flyPos.x, rig.flyPos.z);
        quest.ui.showBanner('返回地面');
      } else {
        modeBeforeFly = mode;
        mode = 'fly';
        rig.setMode('foot'); // 复用步行视角的鼠标观察
        rig.enterFly();
        quest.ui.showBanner('飞行观察模式：WASD 移动 Space 升 C 降 Shift 加速，V 返回');
      }
      return;
    }

    // R / X：任务失败弹窗的快捷选择
    if (e.code === 'KeyR' || e.code === 'KeyX') {
      if (quest.ui.handleKey(e.code)) return;
    }

    // Q：修理包 / C：氮气（驾驶中）
    if (e.code === 'KeyQ' && mode === 'drive') {
      shop.useRepair(entities.vehicles.activeCar);
      return;
    }
    if (e.code === 'KeyC' && mode === 'drive') {
      shop.useNitro(entities.vehicles.activeCar);
      return;
    }

    if (e.code !== 'KeyE') return;
    if (quest.map.isOpen) return; // 地图打开时屏蔽互动

    // E 键优先级：任务系统 → 商店 → 上下车
    if (quest.interact(mode)) return;
    if (mode === 'foot' && shop.interact()) return;

    if (mode === 'foot') {
      const car = entities.vehicles.nearestCar(player.pos, 3.4);
      if (car) {
        entities.vehicles.enter(car);
        // 碰撞挂钩：音效 + 通缉犯罪判定
        car.onCrash = (impact, other) => {
          audio.crash(Math.min(1, impact / 20));
          police.onPlayerCrash(impact, other);
        };
        mode = 'drive';
        rig.setMode('drive');
      }
    } else if (mode === 'drive') {
      const spot = entities.vehicles.exit();
      mode = 'foot';
      rig.setMode('foot');
      if (spot) player.spawn(spot.x, spot.z);
    }
  });

  // ---------------- 11. 主循环 ----------------
  document.getElementById('loading').classList.add('hidden');

  let lastTime = performance.now();
  let fpsAccum = 0, fpsTimer = 0, fps = 0;
  let prevBobPhase = 0;

  renderer.setAnimationLoop((time) => {
    // 主循环异常保护：单帧错误不冻结页面，连续错误自动降级/停机
    try {
      loopBody(time);
    } catch (err) {
      watchdog.reportLoopError(err);
      return; // 出错帧直接结束，不让错误计数被正常帧衰减抵消
    }
    watchdog.reportLoopOK();
  });

  function loopBody(time) {
    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;

    const activeCar = entities.vehicles.activeCar;
    const busted = police.isBusted;
    if (busted) entities.vehicles.keys.clear(); // 被捕演出中禁止车辆输入

    // 玩家更新（步行物理 / 驾驶绑定 / 飞行时跳过）
    if (mode === 'foot' && !busted) {
      player.update(dt, rig.yaw);
      // 脚步声：头部晃动每半周期一步
      if (player.onGround && player.currentSpeed > 0.5) {
        if (Math.floor(player.bobPhase / Math.PI) !== Math.floor(prevBobPhase / Math.PI)) {
          audio.footstep();
        }
      }
      prevBobPhase = player.bobPhase;
    } else if (mode === 'drive' && activeCar) {
      player.pos.set(activeCar.pos.x, activeCar.pos.y, activeCar.pos.z);
    }

    // 视觉焦点（飞行模式 = 相机位置，用于实体远距裁剪/光照跟随）
    const focus = mode === 'fly' ? camera.position
      : mode === 'drive' && activeCar ? activeCar.pos : player.pos;

    // 实体更新（车辆 AI/驾驶物理 + NPC，内部带远距裁剪）
    entities.update(dt, focus);

    // 相机
    if (mode === 'foot') rig.updateFoot(player, dt);
    else if (mode === 'drive' && activeCar) rig.updateDrive(activeCar, dt);
    else if (mode === 'fly') rig.updateFly(player.keys, dt);

    // 被捕后车辆被系统收回 → 状态同步回步行
    if (mode === 'drive' && !activeCar) {
      mode = 'foot';
      rig.setMode('foot');
    }

    // 任务系统（导航用驾驶时的车头朝向，步行/飞行用视角朝向）
    const navYaw = mode === 'drive' && activeCar ? activeCar.heading : rig.yaw;
    quest.update(dt, mode === 'fly' ? 'foot' : mode, activeCar, navYaw);
    quest.nav.update(dt, player.pos, navYaw, quest.navInfo);

    // 通缉系统（飞行=观察模式，不参与追捕判定）
    police.update(dt, mode, activeCar, daynight.night01);

    // 商店标记动画
    shop.update(dt);

    // 昼夜推进 + 光照/天空/雾/曝光过渡
    const target = daynight.update(dt);
    const ls = lighting.updateTime(target, dt);
    lighting.update(focus);
    sky.updateColors(ls.zenith, ls.horizon);
    sky.update(camera.position);
    scene.fog.color.copy(ls.fog);
    renderer.toneMappingExposure = ls.exposure;

    // 夜间联动：路灯 / 建筑亮窗 / 车辆大灯 / 环境音
    const night01 = daynight.night01;
    if (props.lampHeadMat) props.lampHeadMat.emissiveIntensity = ls.lamp;
    if (city.windowMats) {
      const glow = night01 * 0.9;
      for (const m of city.windowMats) m.emissiveIntensity = glow;
    }
    entities.vehicles.setHeadlights(night01);
    audio.setNight(night01);
    audio.setEngine(activeCar ? Math.abs(activeCar.speed) / 40 : 0,
      mode === 'drive' && !!activeCar && !busted);

    renderer.render(scene, camera);

    // HUD 刷新
    fpsAccum++;
    fpsTimer += dt;
    if (fpsTimer >= 0.25) {
      fps = Math.round(fpsAccum / fpsTimer);
      fpsAccum = 0;
      fpsTimer = 0;
      const nearCar = mode === 'foot' ? entities.vehicles.nearestCar(player.pos, 3.4) : null;
      // 提示优先级：任务互动 → 商店 → 上车
      const questHint = quest.nearbyInteractable(player.pos, mode === 'fly' ? 'foot' : mode);
      const nearShop = mode === 'foot' ? shop.nearbyShop() : null;
      hud.update({
        x: focus.x, y: focus.y, z: focus.z,
        fps,
        mode: mode === 'fly' ? 'fly' : mode,
        timeName: target.name,
        speedKmh: activeCar ? activeCar.speed * 3.6 : 0,
        money: quest.money,
        clock: daynight.clockText,
        items: `🔧×${shop.items.repair} ⚡×${shop.items.nitro}`,
        hint: questHint
          || (nearShop ? `按 E 进入${nearShop.name}` : '')
          || (mode === 'foot'
            ? (nearCar ? '按 E 上车驾驶' : '')
            : mode === 'drive'
              ? 'W/S 油门刹车  A/D 转向  按 E 下车'
              : ''),
      });
    }
  } // loopBody 结束
}

/** 让出主线程一帧（加载期间保持页面响应） */
function tick() {
  return new Promise((r) => setTimeout(r, 0));
}
