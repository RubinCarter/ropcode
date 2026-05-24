/**
 * useFullscreen Hook
 *
 * React hook for macOS native fullscreen features
 * Uses Electron IPC events to push fullscreen state changes (instead of resize polling)
 */

import { useState, useEffect, useCallback } from 'react';

interface UseFullscreenReturn {
  /** Whether currently in fullscreen state */
  isFullscreen: boolean;
  /** Toggle fullscreen state */
  toggleFullscreen: () => Promise<void>;
  /** Enter fullscreen */
  enterFullscreen: () => Promise<void>;
  /** Exit fullscreen */
  exitFullscreen: () => Promise<void>;
  /** Whether fullscreen is supported (macOS only) */
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

  // Check if fullscreen is supported (macOS only)
  useEffect(() => {
    const isMac = navigator.platform.toLowerCase().includes('mac') ||
                  navigator.userAgent.toLowerCase().includes('mac');
    setIsSupported(isMac);
  }, []);

  // Listen for fullscreen state changes
  useEffect(() => {
    // Initialize state
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

    // Prefer fullscreen events pushed from Electron main process (no IPC delay)
    if (window.electronAPI?.onFullscreenChanged) {
      const unlisten = window.electronAPI.onFullscreenChanged((fullscreen) => {
        setIsFullscreen(fullscreen);
        syncFullscreenClass(fullscreen);
      });
      return unlisten;
    }

    // Fallback: listen for resize events (non-Electron)
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
