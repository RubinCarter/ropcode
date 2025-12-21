/**
 * useFullscreen Hook
 *
 * 提供 macOS 原生全屏功能的 React hook
 * 使用 CGO 直接调用 NSWindow.toggleFullScreen 方法，
 * 因为 Wails v2 的 WindowFullscreen() 在 Frameless 窗口上不工作
 *
 * @example
 * ```tsx
 * const { toggleFullscreen, isFullscreen } = useFullscreen();
 *
 * <Button onClick={toggleFullscreen}>
 *   {isFullscreen ? <Minimize2 /> : <Maximize2 />}
 * </Button>
 * ```
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

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

export function useFullscreen(): UseFullscreenReturn {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  // 检查是否支持全屏（仅 macOS）
  useEffect(() => {
    const checkSupport = () => {
      // 通过 navigator 检测平台
      const isMac = navigator.platform.toLowerCase().includes('mac') ||
                    navigator.userAgent.toLowerCase().includes('mac');
      setIsSupported(isMac);
    };

    checkSupport();
  }, []);

  // 监听全屏状态变化
  useEffect(() => {
    const updateFullscreenState = async () => {
      try {
        // Use our CGO-based fullscreen check
        const fullscreen = await api.isFullscreen();
        setIsFullscreen(fullscreen);
      } catch (error) {
        console.error('Failed to get fullscreen state:', error);
      }
    };

    // 初始化状态
    updateFullscreenState();

    // 监听窗口 resize 事件
    const handleResize = () => {
      updateFullscreenState();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  /**
   * 切换全屏状态
   * 使用 CGO 直接调用 macOS 原生全屏
   */
  const toggleFullscreen = useCallback(async () => {
    if (!isSupported) {
      console.warn('Fullscreen is only supported on macOS');
      return;
    }

    try {
      // Toggle fullscreen using our CGO implementation
      await api.toggleFullscreen();

      // 更新状态（延迟一点以等待动画完成）
      setTimeout(async () => {
        const fullscreen = await api.isFullscreen();
        setIsFullscreen(fullscreen);
      }, 300);
    } catch (error) {
      console.error('Failed to toggle fullscreen:', error);
    }
  }, [isSupported]);

  /**
   * 进入全屏
   */
  const enterFullscreen = useCallback(async () => {
    if (!isFullscreen) {
      await toggleFullscreen();
    }
  }, [isFullscreen, toggleFullscreen]);

  /**
   * 退出全屏
   */
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
