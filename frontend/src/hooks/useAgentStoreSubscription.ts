import { useEffect } from 'react';
import { useAgentStore } from '@/stores/agentStore';

/**
 * Hook to automatically subscribe to process events for agent store updates
 *
 * This hook should be used in components that display agent runs to ensure
 * they receive real-time updates when agent processes change state.
 *
 * @example
 * ```tsx
 * function AgentList() {
 *   useAgentStoreSubscription();
 *   const agentRuns = useAgentStore(state => state.agentRuns);
 *   // ... render agent runs
 * }
 * ```
 */
export function useAgentStoreSubscription() {
  const subscribeToProcessEvents = useAgentStore(
    (state) => state.subscribeToProcessEvents
  );

  useEffect(() => {
    const unsubscribe = subscribeToProcessEvents();
    return unsubscribe;
  }, [subscribeToProcessEvents]);
}
