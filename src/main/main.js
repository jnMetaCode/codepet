/**
 * Electron 主进程：透明无边框置顶桌宠窗 + 托盘 + IPC。
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

const stats = require('./stats');
const store = require('./store');
const hooks = require('./hooks');

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

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: workArea.x + workArea.width - PET_W - 24,
    y: workArea.y + workArea.height - PET_H - 24,
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
  // 空图标在 Mac 菜单栏看不见，用 setTitle 显示一个可见的 🐾 让用户能点开菜单
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('🐾');
  tray.setToolTip('码宠 CodePet');
  rebuildTray();
}

// ---------- IPC ----------

ipcMain.handle('stats:today', async () => {
  const cfg = store.getConfig();
  return stats.getTodayStats(cfg);
});
ipcMain.handle('pets:list', () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/pets.json'), 'utf8')).pets;
  } catch { return []; }
});
ipcMain.handle('config:get', () => store.getConfig());
ipcMain.handle('config:set', (_e, partial) => {
  const next = store.setConfig(partial);
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

ipcMain.handle('dialog:pick-dir', async () => {
  const r = await dialog.showOpenDialog(settingsWin || win, { properties: ['openDirectory'] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});
ipcMain.handle('growth:get', () => store.getGrowth());
ipcMain.handle('growth:set', (_e, g) => store.setGrowth(g));

// 拖动窗口（无边框窗自定义拖动）
ipcMain.on('win:drag', (_e, { dx, dy }) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + dx, y + dy);
});

// ---------- 生命周期 ----------

app.whenReady().then(() => {
  store.init(app.getPath('userData'), loadDefaultConfig());
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
