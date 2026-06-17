/**
 * preload：安全地把主进程能力暴露给渲染进程（contextIsolation）。
 * 渲染进程通过 window.codepet.* 调用。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codepet', {
  // 数据
  getStats: () => ipcRenderer.invoke('stats:today'),
  getPets: () => ipcRenderer.invoke('pets:list'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (partial) => ipcRenderer.invoke('config:set', partial),
  pickDir: () => ipcRenderer.invoke('dialog:pick-dir'),
  // 自定义宠物
  pickImage: () => ipcRenderer.invoke('dialog:pick-image'),
  createPet: (opts) => ipcRenderer.invoke('pets:create', opts),
  deletePet: (id) => ipcRenderer.invoke('pets:delete', id),
  imageSize: (p) => ipcRenderer.invoke('pets:image-size', p),
  onConfigChanged: (cb) => ipcRenderer.on('config:changed', (_e, c) => cb(c)),

  // Claude Code 实时联动
  hooksStatus: () => ipcRenderer.invoke('hooks:status'),
  hooksInstall: () => ipcRenderer.invoke('hooks:install'),
  hooksUninstall: () => ipcRenderer.invoke('hooks:uninstall'),
  onCcEvent: (cb) => ipcRenderer.on('cc:event', (_e, evt) => cb(evt)),

  // 开机自启
  getAutoLaunch: () => ipcRenderer.invoke('app:get-auto-launch'),
  setAutoLaunch: (on) => ipcRenderer.invoke('app:set-auto-launch', on),
  getGrowth: () => ipcRenderer.invoke('growth:get'),
  setGrowth: (g) => ipcRenderer.invoke('growth:set', g),

  // 窗口拖动
  dragBy: (dx, dy) => ipcRenderer.send('win:drag', { dx, dy }),

  // 来自托盘菜单的事件
  onShowStats: (cb) => ipcRenderer.on('ui:show-stats', cb),
  onFeed: (cb) => ipcRenderer.on('ui:feed', cb),
  onWelcome: (cb) => ipcRenderer.on('ui:welcome', cb),
  onClickThrough: (cb) => ipcRenderer.on('ui:clickthrough', (_e, on) => cb(on)),
});
