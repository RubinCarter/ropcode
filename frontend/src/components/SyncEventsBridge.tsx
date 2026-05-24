import { useEffect, useRef } from 'react';
import { useSyncEvents } from '@/hooks/useSyncEvents';

export function SyncEventsBridge() {
  const events = useSyncEvents();
  const handledCountRef = useRef(0);

  useEffect(() => {
    if (events.length <= handledCountRef.current) {
      return;
    }

    const pending = events.slice(handledCountRef.current);
    handledCountRef.current = events.length;

    for (const event of pending) {
      if (event.type === 'project:changed') {
        window.dispatchEvent(new CustomEvent('project:changed', { detail: event }));
      }

      const spacePath = event.workspacePath || event.projectPath || event.projectId;
      if ((event.type === 'project:changed' || event.type === 'session:changed') && spacePath) {
        window.dispatchEvent(new CustomEvent('ropcode-space-sessions-refresh', {
          detail: { spacePath, force: true },
        }));
      }
    }
  }, [events]);

  return null;
}
