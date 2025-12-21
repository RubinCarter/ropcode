/**
 * Wails Window Adapter
 *
 * 提供 Tauri 兼容的窗口控制层，将 Tauri 风格的窗口 API 映射到 Wails 窗口控制。
 */

import {
  WindowMinimise,
  WindowUnminimise,
  WindowMaximise,
  WindowUnmaximise,
  WindowToggleMaximise,
  WindowIsMaximised,
  WindowIsMinimised,
  WindowIsNormal,
  WindowFullscreen,
  WindowUnfullscreen,
  WindowIsFullscreen,
  WindowCenter,
  WindowSetTitle,
  WindowSetSize,
  WindowGetSize,
  WindowSetPosition,
  WindowGetPosition,
  WindowSetMinSize,
  WindowSetMaxSize,
  WindowHide,
  WindowShow,
  WindowSetAlwaysOnTop,
  WindowReload,
  Quit
} from '../../wailsjs/runtime/runtime';

/**
 * 窗口尺寸类型
 */
export interface WindowSize {
  width: number;
  height: number;
}

/**
 * 窗口位置类型
 */
export interface WindowPosition {
  x: number;
  y: number;
}

/**
 * Tauri 兼容的窗口接口
 */
export interface Window {
  // 窗口状态控制
  minimize(): Promise<void>;
  unminimize(): Promise<void>;
  maximize(): Promise<void>;
  unmaximize(): Promise<void>;
  toggleMaximize(): Promise<void>;

  // 窗口状态查询
  isMaximized(): Promise<boolean>;
  isMinimized(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;

  // 全屏控制
  setFullscreen(fullscreen: boolean): Promise<void>;

  // 窗口关闭
  close(): Promise<void>;

  // 窗口显示/隐藏
  hide(): Promise<void>;
  show(): Promise<void>;

  // 窗口位置和尺寸
  center(): Promise<void>;
  setTitle(title: string): Promise<void>;
  setSize(size: WindowSize): Promise<void>;
  innerSize(): Promise<WindowSize>;
  setPosition(position: WindowPosition): Promise<void>;
  innerPosition(): Promise<WindowPosition>;
  setMinSize(size: WindowSize | null): Promise<void>;
  setMaxSize(size: WindowSize | null): Promise<void>;

  // 其他控制
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
}

/**
 * 获取当前窗口实例
 *
 * 返回一个窗口对象，提供 Tauri 兼容的窗口控制方法。
 *
 * @returns Window 窗口控制对象
 *
 * @example
 * ```typescript
 * const window = getCurrentWindow();
 * await window.minimize();
 * await window.toggleMaximize();
 * ```
 */
export function getCurrentWindow(): Window {
  return {
    // 窗口状态控制
    minimize: async () => {
      WindowMinimise();
    },

    unminimize: async () => {
      WindowUnminimise();
    },

    maximize: async () => {
      WindowMaximise();
    },

    unmaximize: async () => {
      WindowUnmaximise();
    },

    toggleMaximize: async () => {
      WindowToggleMaximise();
    },

    // 窗口状态查询
    isMaximized: async () => {
      return WindowIsMaximised();
    },

    isMinimized: async () => {
      return WindowIsMinimised();
    },

    isFullscreen: async () => {
      return WindowIsFullscreen();
    },

    // 全屏控制
    setFullscreen: async (fullscreen: boolean) => {
      if (fullscreen) {
        WindowFullscreen();
      } else {
        WindowUnfullscreen();
      }
    },

    // 窗口关闭
    close: async () => {
      Quit();
    },

    // 窗口显示/隐藏
    hide: async () => {
      WindowHide();
    },

    show: async () => {
      WindowShow();
    },

    // 窗口位置和尺寸
    center: async () => {
      WindowCenter();
    },

    setTitle: async (title: string) => {
      WindowSetTitle(title);
    },

    setSize: async (size: WindowSize) => {
      WindowSetSize(size.width, size.height);
    },

    innerSize: async () => {
      const size = await WindowGetSize();
      return {
        width: size.w,
        height: size.h
      };
    },

    setPosition: async (position: WindowPosition) => {
      WindowSetPosition(position.x, position.y);
    },

    innerPosition: async () => {
      const pos = await WindowGetPosition();
      return {
        x: pos.x,
        y: pos.y
      };
    },

    setMinSize: async (size: WindowSize | null) => {
      if (size) {
        WindowSetMinSize(size.width, size.height);
      }
    },

    setMaxSize: async (size: WindowSize | null) => {
      if (size) {
        WindowSetMaxSize(size.width, size.height);
      }
    },

    // 其他控制
    setAlwaysOnTop: async (alwaysOnTop: boolean) => {
      WindowSetAlwaysOnTop(alwaysOnTop);
    }
  };
}

/**
 * 获取当前 WebView 窗口（别名，用于兼容 Tauri）
 *
 * 在 Wails 中与 getCurrentWindow 相同。
 */
export function getCurrentWebviewWindow(): Window {
  return getCurrentWindow();
}

/**
 * 重新加载窗口
 */
export function reloadWindow(): void {
  WindowReload();
}

/**
 * 导出 Wails 原生窗口函数供直接使用
 */
export {
  WindowMinimise,
  WindowUnminimise,
  WindowMaximise,
  WindowUnmaximise,
  WindowToggleMaximise,
  WindowIsMaximised,
  WindowIsMinimised,
  WindowIsNormal,
  WindowFullscreen,
  WindowUnfullscreen,
  WindowIsFullscreen,
  WindowCenter,
  WindowSetTitle,
  WindowSetSize,
  WindowGetSize,
  WindowSetPosition,
  WindowGetPosition,
  WindowSetMinSize,
  WindowSetMaxSize,
  WindowHide,
  WindowShow,
  WindowSetAlwaysOnTop,
  WindowReload,
  Quit
} from '../../wailsjs/runtime/runtime';
