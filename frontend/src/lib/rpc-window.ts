/**
 * RPC 窗口控制
 *
 * 通过 Electron IPC 调用主进程窗口控制。
 */

export function WindowMinimise(): void {
  window.electronAPI?.minimizeWindow?.();
}

export function WindowMaximise(): void {
  window.electronAPI?.maximizeWindow?.();
}

export function WindowUnmaximise(): void {
  window.electronAPI?.unmaximizeWindow?.();
}

export function WindowToggleMaximise(): void {
  window.electronAPI?.toggleMaximizeWindow?.();
}

export function WindowFullscreen(): void {
  window.electronAPI?.setFullscreen?.(true);
}

export function WindowUnfullscreen(): void {
  window.electronAPI?.setFullscreen?.(false);
}

export function WindowIsFullscreen(): Promise<boolean> {
  return window.electronAPI?.isFullscreen?.() ?? Promise.resolve(false);
}

export function WindowIsMaximised(): Promise<boolean> {
  return window.electronAPI?.isMaximized?.() ?? Promise.resolve(false);
}

export function WindowIsMinimised(): Promise<boolean> {
  return window.electronAPI?.isMinimized?.() ?? Promise.resolve(false);
}

export function WindowIsNormal(): Promise<boolean> {
  return window.electronAPI?.isNormal?.() ?? Promise.resolve(true);
}

export function WindowCenter(): void {
  window.electronAPI?.centerWindow?.();
}

export function WindowSetTitle(title: string): void {
  document.title = title;
  window.electronAPI?.setTitle?.(title);
}

export function WindowSetSize(width: number, height: number): void {
  window.electronAPI?.setSize?.(width, height);
}

export function WindowGetSize(): Promise<{ width: number; height: number }> {
  return window.electronAPI?.getSize?.() ?? Promise.resolve({ width: window.innerWidth, height: window.innerHeight });
}

export function WindowSetPosition(x: number, y: number): void {
  window.electronAPI?.setPosition?.(x, y);
}

export function WindowGetPosition(): Promise<{ x: number; y: number }> {
  return window.electronAPI?.getPosition?.() ?? Promise.resolve({ x: 0, y: 0 });
}

export function WindowSetMinSize(width: number, height: number): void {
  window.electronAPI?.setMinSize?.(width, height);
}

export function WindowSetMaxSize(width: number, height: number): void {
  window.electronAPI?.setMaxSize?.(width, height);
}

export function WindowHide(): void {
  window.electronAPI?.hideWindow?.();
}

export function WindowShow(): void {
  window.electronAPI?.showWindow?.();
}

export function WindowSetAlwaysOnTop(alwaysOnTop: boolean): void {
  window.electronAPI?.setAlwaysOnTop?.(alwaysOnTop);
}

export function WindowReload(): void {
  window.location.reload();
}

export function Quit(): void {
  window.electronAPI?.quit?.();
}

// 类型声明
declare global {
  interface Window {
    electronAPI?: {
      minimizeWindow?: () => void;
      maximizeWindow?: () => void;
      unmaximizeWindow?: () => void;
      toggleMaximizeWindow?: () => void;
      setFullscreen?: (fullscreen: boolean) => void;
      isFullscreen?: () => Promise<boolean>;
      isMaximized?: () => Promise<boolean>;
      isMinimized?: () => Promise<boolean>;
      isNormal?: () => Promise<boolean>;
      centerWindow?: () => void;
      setTitle?: (title: string) => void;
      setSize?: (width: number, height: number) => void;
      getSize?: () => Promise<{ width: number; height: number }>;
      setPosition?: (x: number, y: number) => void;
      getPosition?: () => Promise<{ x: number; y: number }>;
      setMinSize?: (width: number, height: number) => void;
      setMaxSize?: (width: number, height: number) => void;
      hideWindow?: () => void;
      showWindow?: () => void;
      setAlwaysOnTop?: (alwaysOnTop: boolean) => void;
      quit?: () => void;
    };
  }
}
