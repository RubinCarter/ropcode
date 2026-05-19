import type { ScrollSeekConfiguration } from 'react-virtuoso';

const DISABLED: ScrollSeekConfiguration = {
  enter: () => false,
  exit: () => true,
};

export function useScrollSeekConfig(
  _virtuosoRef?: unknown,
  _enabled?: boolean
): ScrollSeekConfiguration {
  return DISABLED;
}
