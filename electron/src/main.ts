// electron/src/main.ts
import { app, BrowserWindow, ipcMain, dialog, webContents } from 'electron';
import path from 'path';
import { startGoServer, stopGoServer, GoServerInfo } from './go-server';

let mainWindow: BrowserWindow | null = null;
let goServerInfo: GoServerInfo | null = null;
let focusedWebviewId: number | null = null;

const isDev = !app.isPackaged;

// 获取图标路径
const getIconPath = () => {
  const iconDir = isDev
    ? path.join(__dirname, '..', '..', 'assets')
    : path.join(process.resourcesPath, 'assets');

  // 根据平台使用正确的图标格式
  if (process.platform === 'darwin') {
    return path.join(iconDir, 'icon.icns');
  } else if (process.platform === 'win32') {
    return path.join(iconDir, 'icon.ico');
  } else {
    return path.join(iconDir, 'icon.png');
  }
};

async function createWindow() {
  // 设置环境变量供 preload 脚本使用
  process.env.ROPCODE_WS_PORT = String(goServerInfo!.port);
  process.env.ROPCODE_AUTH_KEY = goServerInfo!.authKey;

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 1100,
    minHeight: 700,
    icon: getIconPath(), // 设置应用图标
    frame: false, // 无边框窗口
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 10, y: 10 },
  });

  // 构建加载 URL
  let loadUrl: string;
  if (isDev) {
    // 开发模式：连接 Vite 开发服务器
    loadUrl = 'http://localhost:5173';
  } else {
    // 生产模式：加载打包的前端
    // 前端被复制到 electron/dist/frontend/
    const frontendPath = path.join(__dirname, 'frontend', 'index.html');
    console.log('[Electron] __dirname:', __dirname);
    console.log('[Electron] Resolved frontend path:', frontendPath);
    loadUrl = `file://${frontendPath}`;
  }

  console.log('[Electron] Loading URL:', loadUrl);
  await mainWindow.loadURL(loadUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 注册 IPC 处理器
function registerIpcHandlers() {
  // 窗口控制
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => mainWindow?.maximize());
  ipcMain.handle('window:unmaximize', () => mainWindow?.unmaximize());
  ipcMain.handle('window:toggleMaximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle('window:setFullscreen', (_, fullscreen: boolean) => mainWindow?.setFullScreen(fullscreen));
  ipcMain.handle('window:isFullscreen', () => mainWindow?.isFullScreen());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());
  ipcMain.handle('window:isMinimized', () => mainWindow?.isMinimized());
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:hide', () => mainWindow?.hide());
  ipcMain.handle('window:show', () => mainWindow?.show());
  ipcMain.handle('window:center', () => mainWindow?.center());
  ipcMain.handle('window:setTitle', (_, title: string) => mainWindow?.setTitle(title));
  ipcMain.handle('window:setSize', (_, width: number, height: number) => mainWindow?.setSize(width, height));
  ipcMain.handle('window:getSize', () => mainWindow?.getSize());
  ipcMain.handle('window:setPosition', (_, x: number, y: number) => mainWindow?.setPosition(x, y));
  ipcMain.handle('window:getPosition', () => mainWindow?.getPosition());
  ipcMain.handle('window:setAlwaysOnTop', (_, flag: boolean) => mainWindow?.setAlwaysOnTop(flag));

  // 应用控制
  ipcMain.handle('app:quit', () => app.quit());

  // 文件对话框
  ipcMain.handle('dialog:openDirectory', async () => {
    if (!mainWindow) return { canceled: true };
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    return {
      canceled: result.canceled,
      filePaths: result.filePaths,
    };
  });

  ipcMain.handle('dialog:openFile', async (_, options: { multiple?: boolean } = {}) => {
    if (!mainWindow) return { canceled: true };
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    });
    return {
      canceled: result.canceled,
      filePaths: result.filePaths,
    };
  });

  // Webview 相关
  ipcMain.handle('webview:getPreloadPath', () => {
    return `file://${path.join(__dirname, 'preload-webview.js')}`;
  });

  ipcMain.on('webview:setFocus', (_, webContentsId: number | null) => {
    focusedWebviewId = webContentsId;
  });

  ipcMain.handle('webview:clearStorage', async (_, webContentsId: number) => {
    try {
      const wc = webContents.fromId(webContentsId);
      if (wc) {
        await wc.session.clearStorageData();
      }
    } catch (e) {
      console.error('[Electron] Failed to clear webview storage:', e);
    }
  });

  ipcMain.on('webview:imageContextMenu', (_: Electron.IpcMainEvent, _data: { src: string }) => {
    // Image context menu placeholder - implement save/copy if needed
  });

  ipcMain.on('webview:sendToWebview', (_, webContentsId: number, channel: string, ...args: any[]) => {
    try {
      const wc = webContents.fromId(webContentsId);
      if (wc) {
        wc.send(channel, ...args);
      }
    } catch (e) {
      console.error('[Electron] Failed to send to webview:', e);
    }
  });

  ipcMain.on('webview:elementSelected', (event, elementInfo) => {
    mainWindow?.webContents.send('webview:elementSelected', elementInfo);
  });

}

app.whenReady().then(async () => {
  try {
    console.log('[Electron] Starting Go server...');
    goServerInfo = await startGoServer();
    console.log('[Electron] Go server started:', goServerInfo);

    registerIpcHandlers();
    await createWindow();
  } catch (error) {
    console.error('[Electron] Failed to start:', error);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  console.log('[Electron] Stopping Go server...');
  stopGoServer();
});
