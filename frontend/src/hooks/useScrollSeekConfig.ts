import { useRef, useMemo } from 'react';
import type { VirtuosoHandle, ScrollSeekConfiguration } from 'react-virtuoso';

const DISABLED: ScrollSeekConfiguration = {
  enter: () => false,
  exit: () => true,
};

// Block enter() this long after `enabled` flips true. Virtuoso's programmatic
// anchor jumps (initialTopMostItemIndex on mount, follow-output settling when
// streaming ends) produce velocities far past anything a user gesture can hit;
// the settle window keeps those from being mistaken for fast scrolling.
const ENABLE_SETTLE_MS = 600;

export function useScrollSeekConfig(
  virtuosoRef: React.RefObject<VirtuosoHandle | null>,
  enabled: boolean = true
): ScrollSeekConfiguration {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const inSeekRef = useRef(false);
  const enabledAtRef = useRef<number>(0);

  return useMemo<ScrollSeekConfiguration>(() => {
    if (!enabled) {
      inSeekRef.current = false;
      enabledAtRef.current = 0;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      return DISABLED;
    }

    enabledAtRef.current = Date.now();

    const nudgeScroll = () => {
      if (!inSeekRef.current) return;
      virtuosoRef.current?.scrollBy({ top: 1 });
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollBy({ top: -1 });
      });
      timeoutRef.current = setTimeout(nudgeScroll, 150);
    };

    return {
      // Velocity thresholds tuned for macOS trackpad inertia: a normal flick
      // reaches ~3000 px/s but a deliberate "throw" goes well past 6000.
      // Raising the enter threshold + lowering the exit threshold means we
      // only swap to placeholders during true high-velocity scrolls and
      // recover sooner once the user lets go, so quick browse flicks don't
      // flash skeleton rows.
      enter: (velocity) => {
        if (Date.now() - enabledAtRef.current < ENABLE_SETTLE_MS) return false;
        const enter = Math.abs(velocity) > 6000;
        if (enter && !inSeekRef.current) {
          inSeekRef.current = true;
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(nudgeScroll, 200);
        }
        return enter;
      },
      exit: (velocity) => {
        const exit = Math.abs(velocity) < 200;
        if (exit) {
          inSeekRef.current = false;
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
        }
        return exit;
      },
    };
  }, [enabled]);
}
