// electron/src/main.ts
import { app, BrowserWindow, ipcMain, dialog, webContents, protocol, net, Menu, MenuItem, clipboard, shell } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import { startGoServer, stopGoServer, GoServerInfo } from './go-server';
import { buildAppMenuTemplate } from './app-menu';
import { createInstallEnvironment, installCliToPath, resolvePackagedCliBinaryPath } from './cli-installer';
import { resolveDevCliBinaryPath } from './main-paths';
import { createFileLogger, patchConsoleToFile } from './file-logger';

let mainWindow: BrowserWindow | null = null;
let goServerInfo: GoServerInfo | null = null;
const electronLogger = createFileLogger('ropcode-electron');
const rendererLogger = createFileLogger('ropcode-renderer');
patchConsoleToFile(electronLogger);

const isDev = !app.isPackaged;

// 获取图标路径
const getIconPath = () => {
  const iconDir = isDev
    ? path.join(__dirname, '..', '..', 'assets')
    : path.join(process.resourcesPath, 'assets');

  if (process.platform === 'darwin') {
    return path.join(iconDir, 'icon.icns');
  } else if (process.platform === 'win32') {
    return path.join(iconDir, 'icon.ico');
  } else {
    return path.join(iconDir, 'icon.png');
  }
};

function getCliBinaryPath(): string {
  if (isDev) {
    return resolveDevCliBinaryPath(__dirname, process.platform, process.arch);
  }

  return resolvePackagedCliBinaryPath(process.resourcesPath, process.platform);
}

async function installCliFromMenu(): Promise<void> {
  if (!mainWindow) {
    return;
  }

  try {
    const result = await installCliToPath(createInstallEnvironment(getCliBinaryPath()));
    const detail = result.pathUpdated
      ? `CLI installed at ${result.linkPath}. PATH update saved${result.shellProfilePath ? ` in ${result.shellProfilePath}` : ''}.`
      : `CLI installed at ${result.linkPath}.`;

    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      message: 'Ropcode CLI installed to PATH',
      detail,
      buttons: ['OK'],
    });
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      message: 'Failed to install Ropcode CLI to PATH',
      detail: error instanceof Error ? error.message : String(error),
      buttons: ['OK'],
    });
  }
}

function installAppMenu(): void {
  const menu = Menu.buildFromTemplate(buildAppMenuTemplate(process.platform, installCliFromMenu));
  Menu.setApplicationMenu(menu);
}

async function createWindow() {
  process.env.ROPCODE_WS_PORT = String(goServerInfo!.port);
  process.env.ROPCODE_AUTH_KEY = goServerInfo!.authKey;

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 1100,
    minHeight: 700,
    icon: getIconPath(),
    frame: false,
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

  const loadUrl = `http://localhost:${goServerInfo!.port}`;

  console.log('[Electron] Loading URL:', loadUrl);
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levelName = level >= 3 ? 'error' : level === 2 ? 'warn' : 'log';
    rendererLogger.write(levelName, 'renderer-console', [message, { sourceId, line }]);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    rendererLogger.write('error', 'render-process-gone', [details]);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    rendererLogger.write('error', 'did-fail-load', [{ errorCode, errorDescription, validatedURL }]);
  });
  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      const runtimeConfig = await mainWindow?.webContents.executeJavaScript(`({
        href: window.location.href,
        injectedAuthKey: window.__ROPCODE_AUTH_KEY__,
        injectedWsPort: window.__ROPCODE_WS_PORT__,
        electronAuthKey: window.electronAPI?.authKey,
        electronWsPort: window.electronAPI?.wsPort,
      })`);
      console.log('[Electron] Runtime WS config:', runtimeConfig);
    } catch (error) {
      console.error('[Electron] Failed to inspect runtime WS config:', error);
    }
  });
  await mainWindow.loadURL(loadUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();

    if (params.linkURL) {
      menu.append(new MenuItem({
        label: 'Copy Link',
        click: () => clipboard.writeText(params.linkURL),
      }));
      menu.append(new MenuItem({
        label: 'Open Link in Browser',
        click: () => shell.openExternal(params.linkURL),
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'undo' }));
      menu.append(new MenuItem({ role: 'redo' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ role: 'cut' }));
      menu.append(new MenuItem({ role: 'copy' }));
      menu.append(new MenuItem({ role: 'paste' }));
      menu.append(new MenuItem({ role: 'selectAll' }));
    } else if (params.selectionText) {
      menu.append(new MenuItem({ role: 'copy' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ role: 'selectAll' }));
    } else {
      menu.append(new MenuItem({ role: 'selectAll' }));
    }

    if (menu.items.length > 0) {
      menu.popup();
    }
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen-changed', false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.on('renderer:log', (_event, payload: { level?: string; scope?: string; args?: unknown[] }) => {
    const level = payload.level === 'error' || payload.level === 'warn' || payload.level === 'info' || payload.level === 'debug'
      ? payload.level
      : 'log';
    rendererLogger.write(level, payload.scope || 'renderer', Array.isArray(payload.args) ? payload.args : []);
  });

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

  ipcMain.handle('app:quit', () => app.quit());

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

  ipcMain.handle('webview:getPreloadPath', () => {
    return `file://${path.join(__dirname, 'preload-webview.js')}`;
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
  });

  ipcMain.on('webview:sendToWebview', (_, webContentsId: number, channel: string, ...args: unknown[]) => {
    try {
      const wc = webContents.fromId(webContentsId);
      if (wc) {
        wc.send(channel, ...args);
      }
    } catch (e) {
      console.error('[Electron] Failed to send to webview:', e);
    }
  });

  ipcMain.on('webview:elementSelected', (_event, elementInfo) => {
    mainWindow?.webContents.send('webview:elementSelected', elementInfo);
  });
}

app.whenReady().then(async () => {
  protocol.handle('local-file', (request) => {
    const filePath = decodeURIComponent(request.url.replace('local-file://', ''));
    return net.fetch(pathToFileURL(filePath).toString());
  });

  try {
    console.log('[Electron] Starting Go server...');
    goServerInfo = await startGoServer();
    console.log('[Electron] Go server started:', goServerInfo);

    installAppMenu();
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
  app.quit();
});

app.on('before-quit', () => {
  console.log('[Electron] Stopping Go server...');
  stopGoServer();
  rendererLogger.close();
  electronLogger.close();
});
