/**
 * Terminal utility functions
 */

/**
 * Generate unique Terminal ID
 * Uses timestamp + random string to ensure uniqueness
 */
export function generateTerminalId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `${timestamp}-${random}`;
}

/**
 * Generate Terminal title
 */
export function generateTerminalTitle(index: number): string {
  return `Terminal ${index}`;
}

/**
 * Parse workspace path, get storage key
 */
export function getWorkspaceStorageKey(workspacePath: string | undefined): string {
  return workspacePath || 'default';
}

/**
 * Local storage key prefix
 */
const STORAGE_PREFIX = 'ropcode-terminal-state';

/**
 * Save workspace terminal state to local storage
 */
export function saveTerminalState(workspaceKey: string, state: any): void {
  try {
    const key = `${STORAGE_PREFIX}-${workspaceKey}`;
    // Only save necessary data
    const stateToSave = {
      sessions: state.sessions,
      activeSessionId: state.activeSessionId,
      commandHistory: state.commandHistory.slice(0, 50), // Only keep last 50 history entries
    };
    localStorage.setItem(key, JSON.stringify(stateToSave));
  } catch (error) {
    console.error('[terminalUtils] Failed to save terminal state:', error);
  }
}

/**
 * Load workspace terminal state from local storage
 */
export function loadTerminalState(workspaceKey: string): any | null {
  try {
    const key = `${STORAGE_PREFIX}-${workspaceKey}`;
    const saved = localStorage.getItem(key);
    if (!saved) return null;

    const state = JSON.parse(saved);
    // Validate data integrity
    if (!state.sessions || !Array.isArray(state.sessions)) {
      return null;
    }

    return state;
  } catch (error) {
    console.error('[terminalUtils] Failed to load terminal state:', error);
    return null;
  }
}

/**
 * Clear workspace terminal state
 */
export function clearTerminalState(workspaceKey: string): void {
  try {
    const key = `${STORAGE_PREFIX}-${workspaceKey}`;
    localStorage.removeItem(key);
  } catch (error) {
    console.error('[terminalUtils] Failed to clear terminal state:', error);
  }
}
