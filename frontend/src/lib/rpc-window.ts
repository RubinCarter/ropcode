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

export async function WindowGetSize(): Promise<{ width: number; height: number }> {
  const getSize = window.electronAPI?.getSize;
  if (!getSize) {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  const result = await getSize();
  if (Array.isArray(result)) {
    const [width, height] = result;
    return { width, height };
  }
  return result;
}

export function WindowSetPosition(x: number, y: number): void {
  window.electronAPI?.setPosition?.(x, y);
}

export async function WindowGetPosition(): Promise<{ x: number; y: number }> {
  const getPosition = window.electronAPI?.getPosition;
  if (!getPosition) {
    return { x: 0, y: 0 };
  }

  const result = await getPosition();
  if (Array.isArray(result)) {
    const [x, y] = result;
    return { x, y };
  }
  return result;
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

// electronAPI 类型已在 vite-env.d.ts 中声明
