/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    wsPort?: number;
    authKey?: string;
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
  };
}

