/// <reference types="vite/client" />

interface Window {
  // Injected by Go backend (in HTML) or Electron preload (via webFrame)
  __ROPCODE_WS_PORT__?: number;
  __ROPCODE_AUTH_KEY__?: string;

  electronAPI?: {
    wsPort?: number;
    authKey?: string;
    writeRendererLog?: (level: string, scope: string, args: unknown[]) => void;
    minimizeWindow: () => Promise<void>;
    maximizeWindow: () => Promise<void>;
    unmaximizeWindow: () => Promise<void>;
    toggleMaximizeWindow: () => Promise<void>;
    setFullscreen: (fullscreen: boolean) => Promise<void>;
    isFullscreen: () => Promise<boolean>;
    isMaximized: () => Promise<boolean>;
    isMinimized: () => Promise<boolean>;
    isNormal: () => Promise<boolean>;
    closeWindow: () => Promise<void>;
    hideWindow: () => Promise<void>;
    showWindow: () => Promise<void>;
    centerWindow: () => Promise<void>;
    setTitle: (title: string) => Promise<void>;
    setSize: (width: number, height: number) => Promise<void>;
    getSize: () => Promise<[number, number]>;
    setPosition: (x: number, y: number) => Promise<void>;
    getPosition: () => Promise<[number, number]>;
    setMinSize: (width: number, height: number) => Promise<void>;
    setMaxSize: (width: number, height: number) => Promise<void>;
    setAlwaysOnTop: (flag: boolean) => Promise<void>;
    quit: () => Promise<void>;
    // 文件对话框
    openDirectory: () => Promise<{ canceled: boolean; filePaths?: string[] }>;
    openFile: (options?: { multiple?: boolean }) => Promise<{ canceled: boolean; filePaths?: string[] }>;
    // Webview 相关
    getWebviewPreload: () => Promise<string>;
    setWebviewFocus: (webContentsId: number | null) => void;
    clearWebviewStorage: (webContentsId: number) => Promise<void>;
    onWebviewElementSelected: (callback: (elementInfo: {
      tagName: string;
      innerText: string;
      outerHTML: string;
      selector: string;
      url: string;
    }) => void) => void;
    sendToWebview: (webContentsId: number, channel: string, ...args: any[]) => void;
    onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => () => void;
  };
}

