import { useRef, useMemo } from 'react';
import type { VirtuosoHandle, ScrollSeekConfiguration } from 'react-virtuoso';

const DISABLED: ScrollSeekConfiguration = {
  enter: () => false,
  exit: () => true,
};

export function useScrollSeekConfig(
  virtuosoRef: React.RefObject<VirtuosoHandle | null>,
  enabled: boolean = true
): ScrollSeekConfiguration {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const inSeekRef = useRef(false);

  return useMemo<ScrollSeekConfiguration>(() => {
    if (!enabled) {
      inSeekRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      return DISABLED;
    }

    const nudgeScroll = () => {
      if (!inSeekRef.current) return;
      virtuosoRef.current?.scrollBy({ top: 1 });
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollBy({ top: -1 });
      });
      timeoutRef.current = setTimeout(nudgeScroll, 150);
    };

    return {
      enter: (velocity) => {
        const enter = Math.abs(velocity) > 2500;
        if (enter && !inSeekRef.current) {
          inSeekRef.current = true;
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(nudgeScroll, 200);
        }
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
    };
  }, [enabled]);
}
