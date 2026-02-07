/**
 * useFullscreen Hook
 *
 * 提供 macOS 原生全屏功能的 React hook
 * 使用 Electron IPC 事件推送全屏状态变化（而非 resize 轮询）
 */

import { useState, useEffect, useCallback } from 'react';

interface UseFullscreenReturn {
  /** 当前是否处于全屏状态 */
  isFullscreen: boolean;
  /** 切换全屏状态 */
  toggleFullscreen: () => Promise<void>;
  /** 进入全屏 */
  enterFullscreen: () => Promise<void>;
  /** 退出全屏 */
  exitFullscreen: () => Promise<void>;
  /** 是否支持全屏（仅 macOS） */
  isSupported: boolean;
}

/** Sync the `is-fullscreen` class on <html> so CSS can respond */
function syncFullscreenClass(fullscreen: boolean) {
  if (fullscreen) {
    document.documentElement.classList.add('is-fullscreen');
  } else {
    document.documentElement.classList.remove('is-fullscreen');
  }
}

export function useFullscreen(): UseFullscreenReturn {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  // 检查是否支持全屏（仅 macOS）
  useEffect(() => {
    const isMac = navigator.platform.toLowerCase().includes('mac') ||
                  navigator.userAgent.toLowerCase().includes('mac');
    setIsSupported(isMac);
  }, []);

  // 监听全屏状态变化
  useEffect(() => {
    // 初始化状态
    const initState = async () => {
      if (window.electronAPI?.isFullscreen) {
        try {
          const fullscreen = await window.electronAPI.isFullscreen();
          const value = fullscreen ?? false;
          setIsFullscreen(value);
          syncFullscreenClass(value);
        } catch (error) {
          console.error('Failed to get fullscreen state:', error);
        }
      }
    };
    initState();

    // 优先使用 Electron 主进程推送的全屏事件（无 IPC 延迟）
    if (window.electronAPI?.onFullscreenChanged) {
      const unlisten = window.electronAPI.onFullscreenChanged((fullscreen) => {
        setIsFullscreen(fullscreen);
        syncFullscreenClass(fullscreen);
      });
      return unlisten;
    }

    // 回退：监听 resize 事件（非 Electron 环境）
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(async () => {
        if (window.electronAPI?.isFullscreen) {
          try {
            const fullscreen = await window.electronAPI.isFullscreen();
            const value = fullscreen ?? false;
            setIsFullscreen(value);
            syncFullscreenClass(value);
          } catch (error) {
            console.error('Failed to get fullscreen state:', error);
          }
        }
      }, 200);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimeout) clearTimeout(resizeTimeout);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!isSupported) {
      console.warn('Fullscreen is only supported on macOS');
      return;
    }

    if (!window.electronAPI?.isFullscreen || !window.electronAPI?.setFullscreen) {
      console.warn('Electron API not available');
      return;
    }

    try {
      const currentFullscreen = await window.electronAPI.isFullscreen();
      await window.electronAPI.setFullscreen(!currentFullscreen);
      // State will be updated by the onFullscreenChanged event
    } catch (error) {
      console.error('Failed to toggle fullscreen:', error);
    }
  }, [isSupported]);

  const enterFullscreen = useCallback(async () => {
    if (!isFullscreen) {
      await toggleFullscreen();
    }
  }, [isFullscreen, toggleFullscreen]);

  const exitFullscreen = useCallback(async () => {
    if (isFullscreen) {
      await toggleFullscreen();
    }
  }, [isFullscreen, toggleFullscreen]);

  return {
    isFullscreen,
    toggleFullscreen,
    enterFullscreen,
    exitFullscreen,
    isSupported,
  };
}
