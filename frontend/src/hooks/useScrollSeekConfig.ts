import { useRef, useMemo } from 'react';
import type { VirtuosoHandle, ScrollSeekConfiguration } from 'react-virtuoso';

/**
 * Scroll seek config that won't get stuck in skeleton mode.
 * Higher enter threshold (2500) avoids triggering on normal trackpad momentum.
 * Timeout-based safety: if no velocity updates for 200ms while in seek mode,
 * nudges the scroll to force a velocity recalculation (which will read ~0 and exit).
 */
export function useScrollSeekConfig(
  virtuosoRef: React.RefObject<VirtuosoHandle | null>
): ScrollSeekConfiguration {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const inSeekRef = useRef(false);

  return useMemo<ScrollSeekConfiguration>(() => ({
    enter: (velocity) => {
      const enter = Math.abs(velocity) > 2500;
      if (enter) inSeekRef.current = true;
      return enter;
    },
    exit: (velocity) => {
      const exit = Math.abs(velocity) < 800;
      if (exit) {
        inSeekRef.current = false;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      }
      return exit;
    },
    change: () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (inSeekRef.current) {
        timeoutRef.current = setTimeout(() => {
          if (inSeekRef.current) {
            virtuosoRef.current?.scrollBy({ top: 1 });
            requestAnimationFrame(() => {
              virtuosoRef.current?.scrollBy({ top: -1 });
            });
          }
        }, 200);
      }
    },
  }), []);
}
