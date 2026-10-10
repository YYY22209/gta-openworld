# 街巷行者（GTA 风格开放世界 · Three.js + WebGPU）

> 阿浩数码工作室 出品

基于 Three.js WebGPURenderer 的网页第一人称开放世界：2048×2048 米连续地图（城市街区 / 高速公路 / 城郊丘陵 / 河流河滩 / 边缘山脉），可驾驶车辆、AI 车流、行人 NPC、20 个主线+支线任务、4 星警察通缉、商店经济、动态昼夜灯光、全套程序化音效。

**一套代码，两种发布：**
- 网页静态版 —— 纯静态前端（Three.js 走 CDN），直接上架 GitHub Pages；
- Electron 桌面版 —— 无边框独立窗口 EXE，游戏核心代码与网页版 100% 共用，无需维护两套源码。

> 游戏核心代码全部在 `index.html` + `css/` + `js/` 中；`electron/` 与 `package.json` 只为桌面版服务，网页版完全不依赖它们。

## 操作方式

| 按键 | 功能 |
|---|---|
| 鼠标点击画面 | 锁定鼠标视角 |
| W A S D | 移动（飞行模式同） |
| Shift | 奔跑 / 飞行加速 |
| Space | 跳跃 / 飞行上升 |
| E | 互动（对话 / 接电话 / 接任务 / 进商店）· 上车 / 下车 |
| 驾驶时 W/S A/D | 油门刹车 / 转向 |
| C | 飞行下降 · 驾驶中使用氮气 |
| Q | 驾驶中使用修理包 |
| M | 大地图 + 任务列表 |
| V | 飞行观察模式 |
| T | 时间快进 1 小时（昼夜自动循环） |
| O | 画质设置面板（流畅/均衡/高清/极致 + 暗角/草丛开关） |
| R / X | 任务失败后：重试 / 放弃 |
| F3 | 隐藏/显示 HUD |

## 核心系统

- **任务**：主线 8 章 + 支线 12 条（黄标 NPC 接取 / 手机来电触发），9 种步骤类型，超时·车辆损毁·跟丢等失败规则，金钱/解锁奖励，localStorage 持久化。
- **昼夜循环**：约 12 分钟一天，光照/天空/雾色平滑渐变；夜晚路灯全亮、建筑窗户逐户亮灯、车辆自动开大灯。
- **音效**：Web Audio 全程序化合成（零音频文件）——引擎转速、脚步、碰撞、风声/蟋蟀、电话铃、警笛。
- **通缉**：撞行人/撞警车/严重肇事升星 0~4★，警车追击 + 徒步警察逮捕，逃脱或 BUSTED（罚款回出生点）。
- **商店**：阿杰车行售 3 款车（含极速 155km/h 跑车）；便利店售修理包/氮气；金钱与任务共用，持久化保存。
- **性能**：全场景 InstancedMesh 分块视锥剔除（实例级包围球），O 键四档画质热切换。
- **测试清单**：见 [TESTING.md](./TESTING.md)。

---

# ① VS Code 本地网页预览

浏览器不允许 `file://` 协议加载 ES Module，需要任意静态服务器：

```bash
cd gta-openworld
npx serve .
# 或
python -m http.server 8080
```

打开终端提示的地址（默认 `http://localhost:8080`）。Chrome / Edge 最佳（支持 WebGPU），不支持的浏览器自动降级 WebGL2。

> 本项目零构建、零本地依赖，`npx serve` 无需先 `npm install`。

# ② GitHub Pages 网站上架（全自动部署，完整步骤）

本项目是纯静态页面 + CDN 引入 Three.js，无任何服务端代码，完美兼容 GitHub Pages 免费托管。
项目已内置 `.github/workflows/deploy.yml` 自动部署流水线：**推送代码后自动发布网站，无需手动到仓库后台开启任何 Pages 设置。**

## 第 1 步：注册 GitHub 账号

1. 打开 https://github.com ，点击右上角 **Sign up**；
2. 填写邮箱、密码、用户名（例如 `ahao2026`），完成邮箱验证码即可。

## 第 2 步：新建仓库

1. 登录后点右上角 **＋** → **New repository**；
2. Repository name 填 `gta-openworld`（可自定义，但建议用这个名字，下文链接以此为例）；
3. 选 **Public**（免费账号只有公开仓库才能免费用 Pages）；
4. **不要**勾选 "Add a README file" 等任何自动生成选项；
5. 点 **Create repository** 创建完成。

## 第 3 步：在 VS Code 终端上传本地代码

打开 VS Code → 顶部菜单 **Terminal** → **New Terminal**，依次执行（把 `<你的用户名>` 换成你的）：

```bash
cd gta-openworld
git init
git add .
git commit -m "init: 街巷行者上线"
git branch -M main
git remote add origin https://github.com/<你的用户名>/gta-openworld.git
git push -u origin main
```

> `.gitignore` 已自动排除 `node_modules/` 和打包产物，仓库只含游戏源码与部署配置。
> 首次 push 会弹出 GitHub 登录窗口，按提示用浏览器授权一次即可。

## 第 4 步：等待自动部署，获取网站链接

1. push 成功后，打开仓库网页 → 顶部 **Actions** 标签，能看到一条 "部署网站到 GitHub Pages" 正在运行（黄点转圈）；
2. 约 1~2 分钟后变成绿色 ✓，点进这次运行，摘要里的 `github-pages` 右侧就是**网站链接**：
   `https://<你的用户名>.github.io/gta-openworld/`；
3. 把链接发给任何人，电脑浏览器（Chrome/Edge 最佳）打开即可直接游玩。

> 工作流通过 `enablement: true` 自动开启仓库 Pages 功能，全程不需要进 Settings 手动设置。
> 若想手动确认：仓库 Settings → Pages → Build and deployment 的 Source 显示 "GitHub Actions" 即正常。

## 第 5 步：后续更新游戏

改完代码后，只需再推一次，网站就自动更新：

```bash
git add .
git commit -m "update: 更新说明"
git push
```

推送后 Actions 自动重新部署（后推送覆盖先推送），约 1 分钟后刷新网站生效。网站只发布游戏静态文件（`index.html` / `css` / `js` / `assets`），Electron 桌面版相关内容不会出现在网站上。

常见问题：刚推送立即访问还是旧版 → 部署需要 1~2 分钟，或强刷（Ctrl+F5）；子路径（`/gta-openworld/`）不影响运行——游戏内全部使用相对路径 `./js/...`，Three.js 从 unpkg CDN 加载，无跨域问题。

# ③ Node.js 环境与 Electron 依赖安装

1. 到 https://nodejs.org 下载 **LTS 版**（≥ 20）安装，一路下一步；装完在 VS Code 终端验证：
   ```bash
   node -v    # 应输出 v20+ 
   npm -v
   ```
   （建议安装后重启 VS Code 让终端识别 PATH。）
2. 安装 Electron 相关依赖（项目根目录，即 `package.json` 所在目录）：
   ```bash
   cd gta-openworld
   npm install
   ```
   会安装 `electron`（桌面运行时）和 `electron-builder`（打包器），只装一次，`node_modules` 已被 gitignore。

# ④ Electron 本地启动（一键独立窗口）

```bash
npm start
# 等价于 electron .
```

会弹出一个**无边框纯游戏窗口**（无地址栏、无标签页、无菜单）：
- F11 全屏切换；F12 开发者工具；Alt+F4 退出；
- 点击画面即可锁定鼠标驾驶/射击视角，与浏览器行为一致。

> 技术要点：主进程（`electron/main.cjs`）内置了一个 127.0.0.1 静态服务再加载游戏，从而避开 `file://` 下 ES Module 被浏览器 CORS 拦截、Pointer Lock 失效等问题——**游戏代码与网页版完全同一份**。

# ⑤ 打包 Windows EXE

```bash
npm run build:win
# 等价于 electron-builder --win --x64
```

- 产物在 **`dist-electron/`** 目录：`JieXiangXingZhe-Setup-3.1.0.exe`（NSIS 安装包，安装后游戏名为"街巷行者"，可选安装目录）；
- 首次打包需要下载 Electron 运行时（约 100MB），耐心等待；成功后把 Setup.exe 发给任何人，双击即玩；
- 重新打包前若报文件占用，删除 `dist-electron` 目录重试。

# ⑥ 常见报错排查

| 现象 | 原因 / 解决 |
|---|---|
| 网页打开白屏，控制台 `CORS` / `module` 报错 | 用了 `file://` 直开。必须走静态服务器（见①），Electron 版已内置服务规避此问题 |
| 网页打开黑屏，`Failed to resolve module specifier` | 断网或 unpkg CDN 被墙。联网后重试，或把 importmap 里的 `unpkg.com` 换成 `cdn.jsdelivr.net` |
| GitHub Pages 404 | 部署未完成（等 1~2 分钟）或 Pages Source 没设成 `main / (root)` |
| `npm start` 提示 `electron 不是内部或外部命令` | 没装依赖，先 `npm install`；若换了终端要重启 VS Code |
| `npm start` 报 `Cannot find module 'electron'` | 在错误的目录执行了，必须 cd 到 `package.json` 所在目录 |
| Electron 窗口黑屏不显示游戏 | F12 打开 DevTools 看报错；通常是系统显卡驱动过旧不支持 WebGL2，更新驱动 |
| Electron 里鼠标锁定无效 | 已在主进程放行 `pointerLock` 权限；仍无效则点击一下画面（锁定需用户手势） |
| 打包报 `EPERM`/文件占用 | 关掉正在运行的旧窗口与 Setup，删 `dist-electron` 重试；杀毒软件误报时添加信任 |
| 打包后 localStorage 存档丢失 | 正常现象：EXE 存档按应用名隔离，与浏览器互不相通 |
| 游戏内帧率低 | 按 O 切 1 档"高性能"（关阴影 + 降分辨率 + 关草丛 + 加浓雾） |
| 音效不响 | 浏览器要求用户先交互：点击画面或按任意键后生效 |

# ⑦ 网页卡顿 / 卡死排查（稳定性说明）

本项目已内置四层防卡死机制，遇到卡顿先按下面顺序自查：

**1. 先切画质**
- 按 **O** 打开画质面板，选 **1 高性能**（关阴影、1.0 像素比、关草丛、浓雾近视距）；
- 默认启动为 **2 平衡**档；显卡较好的玩家可选 3 高质量 / 4 极致。

**2. 自动保护机制（无需操作，游戏会自己处理）**
- **内存监控**：JS 堆超过限制 72% 时自动切到高性能画质（Chrome/Edge）；
- **主循环保护**：帧内偶发错误弹提示但游戏继续跑；连续大量错误会自动停渲染并提示刷新；
- **加载看门狗**：初始化超过 45 秒提示检查网络（CDN）；
- **显卡上下文丢失**：提示刷新页面恢复。

**3. 为什么不容易越玩越卡（内存泄漏治理）**
- 警车/警官、任务临时 NPC/物品/目标车等"动态实体"回收时会**完整释放显存**（geometry/material/贴图）；
- 行人上限 48、AI 车流上限 24；距离玩家 240m 外的行人、450m 外的车辆**自动冻结 AI 并隐藏**；
- 商店购车上限 6 辆，超出自动回收最早的车。

**4. 仍卡顿时的排查表**

| 现象 | 原因 / 解决 |
|---|---|
| 加载进度条走得很慢 | 首次访问要从 unpkg 下载 Three.js（约 1MB，之后有缓存）；确认网络能访问 CDN |
| 一进游戏就卡 | 显卡不支持 WebGPU 回退了 WebGL2：按 O 切 1 高性能档 |
| 玩几十分钟变卡 | 关闭其他占内存的标签页；Chrome 任务管理器（Shift+Esc）看该页内存是否异常 |
| 画面突然冻结但有提示 | 按提示 F5 刷新，进度与金钱存档在 localStorage 不会丢 |
| 画面彻底白屏无提示 | F12 控制台截图报错，参考⑥的报错表 |
| 笔记本功耗/发热大 | 切 1 高性能档，并插电使用（独显直连） |

## 目录结构

```
gta-openworld/
├── index.html          # 游戏入口（网页版与 Electron 版共用）
├── assets/             # 静态资源（首页工作室头像）
├── css/style.css
├── js/                 # 游戏核心（两版本共用）
│   ├── main.js         # 装配与主循环
│   ├── core/           # 渲染器/天空/光照/昼夜
│   ├── world/          # 地形/路网/城市/道具/材质
│   ├── player/         # 控制器/碰撞/相机（含飞行模式）
│   ├── entities/       # 车辆/行人
│   ├── quest/          # 20 个任务 + 导航 + 大地图
│   ├── audio/          # 程序化音效
│   ├── police/         # 通缉系统
│   ├── shop/           # 商店经济
│   └── ui/             # HUD / 画质面板
├── electron/main.cjs   # Electron 主进程（仅桌面版使用）
├── package.json        # Electron 脚本与打包配置
└── TESTING.md          # 测试清单
```
