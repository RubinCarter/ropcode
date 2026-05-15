// electron/src/preload.ts
import { contextBridge, ipcRenderer, webFrame } from 'electron';

// Inject __ROPCODE_WS_PORT__ and __ROPCODE_AUTH_KEY__ into the page context.
// This uses the same global variables that the Go backend injects into HTML
// for browser access, so the frontend can use a single unified read path.
const wsPort = process.env.ROPCODE_WS_PORT || '0';
const authKey = process.env.ROPCODE_AUTH_KEY || '';
webFrame.executeJavaScript(
  `window.__ROPCODE_WS_PORT__=${wsPort};window.__ROPCODE_AUTH_KEY__="${authKey}";`
);

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // WebSocket 配置（由 Go 服务器提供）
  wsPort: process.env.ROPCODE_WS_PORT ? parseInt(process.env.ROPCODE_WS_PORT, 10) : undefined,
  authKey: process.env.ROPCODE_AUTH_KEY,
  writeRendererLog: (level: string, scope: string, args: unknown[]) => {
    ipcRenderer.send('renderer:log', { level, scope, args });
  },

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

  // 文件对话框
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openFile: (options?: { multiple?: boolean }) => ipcRenderer.invoke('dialog:openFile', options),

  // Webview 相关
  getWebviewPreload: () => ipcRenderer.invoke('webview:getPreloadPath'),
  setWebviewFocus: (webContentsId: number | null) => ipcRenderer.send('webview:setFocus', webContentsId),
  clearWebviewStorage: (webContentsId: number) => ipcRenderer.invoke('webview:clearStorage', webContentsId),
  onWebviewElementSelected: (callback: (elementInfo: any) => void) => {
    ipcRenderer.on('webview:elementSelected', (_, elementInfo) => callback(elementInfo));
  },
  sendToWebview: (webContentsId: number, channel: string, ...args: any[]) => {
    ipcRenderer.send('webview:sendToWebview', webContentsId, channel, ...args);
  },

  // Fullscreen state change listener (push-based, no polling needed)
  onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => {
    const handler = (_: any, isFullscreen: boolean) => callback(isFullscreen);
    ipcRenderer.on('window:fullscreen-changed', handler);
    return () => {
      ipcRenderer.removeListener('window:fullscreen-changed', handler);
    };
  },

});

