// ============================================================
// main.cjs — Electron 主进程（CommonJS，避免 ESM 打包兼容问题）
//
// 方案：内置一个本地静态 HTTP 服务（127.0.0.1 随机端口）加载游戏，
// 而不是 file:// 直开 —— 彻底规避三大坑：
//  1. ES Module 从 file:// 加载会被 Chromium 的 CORS 策略拦截；
//  2. localStorage / Pointer Lock 在 file:// 下行为不一致；
//  3. 游戏代码与网页版完全同源运行，零改动、零分支维护。
//
// 窗口：无边框（frame:false）纯游戏画面；
//  F11 = 全屏切换    F12 = 开发者工具    Alt+F4 = 退出
// ============================================================

const { app, BrowserWindow, Menu, session } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 静态资源根目录（开发 = 项目根；打包后 = app.asar 内的项目根）
const ROOT = app.getAppPath();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** 返回 127.0.0.1 上监听的静态文件服务器（端口由系统随机分配） */
function createStaticServer() {
  return http.createServer((req, res) => {
    try {
      // 解码 URL，防目录穿越，'/' 默认 index.html
      let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
      const filePath = path.join(ROOT, path.normalize(urlPath));
      if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }

      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not Found'); return; }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache', // 游戏更新后窗口重开即生效，避免旧缓存
        });
        res.end(data);
      });
    } catch (e) {
      res.writeHead(500); res.end();
    }
  });
}

let win = null;

function createWindow() {
  // 去掉默认菜单栏（浏览器 UI 感的最大来源）
  Menu.setApplicationMenu(null);

  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    frame: false,            // 无边框：只显示游戏画面
    title: '街巷行者',       // 任务栏 / Alt+Tab 显示的游戏名
    backgroundColor: '#000000',
    show: false,              // 等 ready-to-show，避免白屏闪烁
    autoHideMenuBar: true,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // 失焦时不降帧（驾驶游戏必需）
      devTools: true,
    },
  });

  // 本地静态服务 → 同源加载游戏（ES Module / importmap / localStorage 全部正常）
  const server = createStaticServer();
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    win.loadURL(`http://127.0.0.1:${port}/index.html`);
  });
  win.on('closed', () => {
    win = null;
    server.close();
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // F11 全屏切换 / F12 开发者工具（Electron 里必须走主进程菜单角色）
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
}

// 鼠标锁定（Pointer Lock）与全屏在 Electron 里走权限回调，显式放行
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'pointerLock' || permission === 'fullscreen');
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
