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
    return {
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
    };
  }, [enabled]);
}
