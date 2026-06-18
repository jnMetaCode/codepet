/**
 * Electron 主进程：透明无边框置顶桌宠窗 + 托盘 + IPC。
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, dialog, globalShortcut, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

const stats = require('./stats');
const store = require('./store');
const hooks = require('./hooks');
const pets = require('./pets');

// 自定义宠物图片用 petasset:// 协议从 userData 读取（打包后 app 内只读，自定义图必须放可写目录）。
// 必须在 app ready 之前声明 scheme 为特权（standard+secure 才能在页面里 <img>/background 加载）。
protocol.registerSchemesAsPrivileged([
  { scheme: 'petasset', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win = null;
let settingsWin = null;
let tray = null;
let clickThrough = false;

const PET_W = 320;
const PET_H = 400;

function loadDefaultConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/default.json'), 'utf8'));
  } catch {
    return {};
  }
}

// 上次窗口位置：存在且仍落在某块屏幕的可见范围内才用，否则回到右下角默认位
function resolveWindowPos() {
  const { workArea } = screen.getPrimaryDisplay();
  const def = { x: workArea.x + workArea.width - PET_W - 24, y: workArea.y + workArea.height - PET_H - 24 };
  const saved = store.getConfig().window || {};
  if (typeof saved.x === 'number' && typeof saved.y === 'number') {
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      // 至少留 60px 在屏内，避免外接屏拔掉后窗口跑到看不见的地方
      return saved.x >= a.x - PET_W + 60 && saved.x <= a.x + a.width - 60 &&
             saved.y >= a.y && saved.y <= a.y + a.height - 60;
    });
    if (visible) return { x: Math.round(saved.x), y: Math.round(saved.y) };
  }
  return def;
}

let _savePosTimer = null;
function scheduleSavePos() {
  clearTimeout(_savePosTimer);
  _savePosTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    store.setConfig({ window: { x, y } });
  }, 600);
}

function createWindow() {
  const pos = resolveWindowPos();
  win = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  // 把渲染进程的 console / 报错转发到主进程 stdout，方便调试
  win.webContents.on('console-message', (_e, level, message) => {
    console.log(`[renderer] ${message}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => console.log('[renderer-gone]', d.reason));

  // 右键桌宠 → 弹出菜单（换宠物/喂食/数据/退出）。最直观的入口。
  win.webContents.on('context-menu', () => popupPetMenu());

  win.on('moved', scheduleSavePos); // 系统拖动结束时记位置

  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 440,
    height: 560,
    title: '码宠 设置',
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, '../settings/settings.html'));
  settingsWin.webContents.on('console-message', (_e, l, m) => console.log(`[settings] ${m}`));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function setClickThrough(on) {
  clickThrough = on;
  if (win) win.setIgnoreMouseEvents(on, { forward: true });
  if (win && !win.isDestroyed()) win.webContents.send('ui:clickthrough', on);
  rebuildTray();
}

function menuTemplate() {
  return [
    { label: '码宠 CodePet', enabled: false },
    { type: 'separator' },
    { label: '🐾 换宠物 / 设置…', click: () => openSettings() },
    { label: '🍖 喂食', click: () => win && win.webContents.send('ui:feed') },
    { label: '📊 今日数据', click: () => win && win.webContents.send('ui:show-stats') },
    { type: 'separator' },
    { label: '点击穿透', type: 'checkbox', checked: clickThrough, click: (m) => setClickThrough(m.checked) },
    { label: '重新加载', click: () => win && win.reload() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ];
}

function popupPetMenu() {
  Menu.buildFromTemplate(menuTemplate()).popup({ window: win });
}

function rebuildTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

function createTray() {
  if (process.platform === 'darwin') {
    // Mac 菜单栏：空图标 + setTitle 显示一个可见的 🐾（emoji 在菜单栏渲染良好）
    tray = new Tray(nativeImage.createEmpty());
    tray.setTitle('🐾');
  } else {
    // Windows/Linux：系统托盘必须有真实图标，否则不可见、setTitle 也无效 → 用打包进来的图标
    const ico = nativeImage.createFromPath(path.join(__dirname, '../assets/tray.png'));
    tray = new Tray(ico.isEmpty() ? nativeImage.createEmpty() : ico);
  }
  tray.setToolTip('码宠 CodePet');
  rebuildTray();
}

// ---------- IPC ----------

ipcMain.handle('stats:today', async () => {
  const cfg = store.getConfig();
  return stats.getTodayStats(cfg);
});
ipcMain.handle('pets:list', () => pets.list());
ipcMain.handle('pets:create', (_e, opts) => {
  try { return { ok: true, pet: pets.create(opts) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('pets:delete', (_e, id) => pets.remove(id));
ipcMain.handle('pets:image-size', (_e, p) => {
  try { return nativeImage.createFromPath(p).getSize(); } catch { return { width: 0, height: 0 }; }
});
ipcMain.handle('config:get', () => store.getConfig());
ipcMain.handle('config:set', (_e, partial) => {
  const next = store.setConfig(partial);
  hooks.setConfigDir((next.claude || {}).configDir); // configDir 改了，hooks 路径跟着走
  if (win && !win.isDestroyed()) win.webContents.send('config:changed', next); // 让桌宠热更新
  return next;
});
// Claude Code 实时联动（hooks）
ipcMain.handle('hooks:status', () => hooks.status());
ipcMain.handle('hooks:install', () => hooks.install());
ipcMain.handle('hooks:uninstall', () => hooks.uninstall());

// 开机自启
function applyAutoLaunch(on) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: false });
  } catch (e) { console.log('setLoginItemSettings 失败', e.message); }
}
ipcMain.handle('app:get-auto-launch', () => {
  try { return app.getLoginItemSettings().openAtLogin; } catch { return false; }
});
ipcMain.handle('app:set-auto-launch', (_e, on) => {
  applyAutoLaunch(on);
  store.setConfig({ app: { autoLaunch: !!on } });
  return on;
});

// 桌宠窗是 screen-saver 级置顶，会浮在原生对话框之上、挡住"取消/打开"按钮的点击。
// 开对话框前临时把它降下来、并把对话框挂到设置窗（模态），关掉后再恢复置顶。
async function showOpenDialogSafe(opts) {
  const parent = settingsWin && !settingsWin.isDestroyed() ? settingsWin : win;
  const wasOnTop = win && !win.isDestroyed() && win.isAlwaysOnTop();
  if (wasOnTop) win.setAlwaysOnTop(false);
  if (parent && !parent.isDestroyed()) parent.focus();
  try {
    return await dialog.showOpenDialog(parent, opts);
  } finally {
    if (wasOnTop && win && !win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver');
  }
}

ipcMain.handle('dialog:pick-dir', async () => {
  const r = await showOpenDialogSafe({ properties: ['openDirectory'] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});
ipcMain.handle('dialog:pick-image', async () => {
  const r = await showOpenDialogSafe({
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});
ipcMain.handle('growth:get', () => store.getGrowth());
ipcMain.handle('growth:set', (_e, g) => store.setGrowth(g));

// 拖动窗口（无边框窗自定义拖动）
ipcMain.on('win:drag', (_e, { dx, dy }) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + dx, y + dy);
  scheduleSavePos(); // 自定义拖动也记位置（防抖）
});

// ---------- 生命周期 ----------

app.whenReady().then(() => {
  store.init(app.getPath('userData'), loadDefaultConfig());
  pets.init(app.getPath('userData'));
  hooks.setConfigDir((store.getConfig().claude || {}).configDir);

  // 提供自定义宠物图片：petasset://<id>/<file> → userData/pets/<id>/<file>
  protocol.handle('petasset', async (request) => {
    try {
      const u = new URL(request.url);
      const file = await fs.promises.readFile(pets.resolveAsset(u.hostname, u.pathname.replace(/^\//, '')));
      return new Response(file, { headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  const cfg0 = store.getConfig();
  if (cfg0.app && cfg0.app.autoLaunch === true) applyAutoLaunch(true);
  createWindow();
  createTray();

  // 全局快捷键：随时开/关点击穿透（穿透时也能用，避免被困住）
  globalShortcut.register('CommandOrControl+Shift+P', () => setClickThrough(!clickThrough));

  // 实时事件监听：把 Claude Code 事件推给桌宠
  hooks.startWatch((evt) => {
    if (win && !win.isDestroyed()) win.webContents.send('cc:event', evt);
  });

  // 首次启动引导：自动打开设置窗 + 让渲染进程播欢迎语
  if (!(cfg0.app && cfg0.app.onboarded)) {
    setTimeout(() => {
      openSettings();
      if (win && !win.isDestroyed()) win.webContents.send('ui:welcome');
    }, 1500);
    store.setConfig({ app: { onboarded: true } });
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  // 桌宠常驻：托盘还在就不退出（Mac 习惯）。这里简单处理：全关才退。
  if (process.platform !== 'darwin') app.quit();
});
