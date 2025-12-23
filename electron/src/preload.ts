// electron/src/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // WebSocket 配置（由 Go 服务器提供）
  wsPort: process.env.ROPCODE_WS_PORT ? parseInt(process.env.ROPCODE_WS_PORT, 10) : undefined,
  authKey: process.env.ROPCODE_AUTH_KEY,

  // 窗口控制
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  unmaximizeWindow: () => ipcRenderer.invoke('window:unmaximize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
  setFullscreen: (fullscreen: boolean) => ipcRenderer.invoke('window:setFullscreen', fullscreen),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  isMinimized: () => ipcRenderer.invoke('window:isMinimized'),
  isNormal: async () => {
    const isMax = await ipcRenderer.invoke('window:isMaximized');
    const isMin = await ipcRenderer.invoke('window:isMinimized');
    const isFull = await ipcRenderer.invoke('window:isFullscreen');
    return !isMax && !isMin && !isFull;
  },
  closeWindow: () => ipcRenderer.invoke('window:close'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  showWindow: () => ipcRenderer.invoke('window:show'),
  centerWindow: () => ipcRenderer.invoke('window:center'),
  setTitle: (title: string) => ipcRenderer.invoke('window:setTitle', title),
  setSize: (width: number, height: number) => ipcRenderer.invoke('window:setSize', width, height),
  getSize: () => ipcRenderer.invoke('window:getSize'),
  setPosition: (x: number, y: number) => ipcRenderer.invoke('window:setPosition', x, y),
  getPosition: () => ipcRenderer.invoke('window:getPosition'),
  setMinSize: (width: number, height: number) => ipcRenderer.invoke('window:setMinSize', width, height),
  setMaxSize: (width: number, height: number) => ipcRenderer.invoke('window:setMaxSize', width, height),
  setAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),

  // 应用控制
  quit: () => ipcRenderer.invoke('app:quit'),
});

