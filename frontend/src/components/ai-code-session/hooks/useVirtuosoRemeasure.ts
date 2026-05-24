import { useEffect } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';

export function useVirtuosoRemeasure(
  virtuosoRef: React.RefObject<VirtuosoHandle | null>,
): void {
  useEffect(() => {
    const forceVirtuosoRemeasure = () => {
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollBy({ top: 0 });
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        forceVirtuosoRemeasure();
      }
    };

    let unlisten: (() => void) | undefined;
    if (window.electronAPI?.onFullscreenChanged) {
      unlisten = window.electronAPI.onFullscreenChanged(() => {
        setTimeout(forceVirtuosoRemeasure, 500);
      });
    } else {
      let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
      const handleResize = () => {
        if (resizeTimeout) {
          clearTimeout(resizeTimeout);
        }
        resizeTimeout = setTimeout(forceVirtuosoRemeasure, 300);
      };
      window.addEventListener('resize', handleResize);
      unlisten = () => {
        window.removeEventListener('resize', handleResize);
        if (resizeTimeout) {
          clearTimeout(resizeTimeout);
        }
      };
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unlisten?.();
    };
  }, [virtuosoRef]);
}
