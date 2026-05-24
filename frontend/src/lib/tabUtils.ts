import type { Tab } from '@/contexts/TabContext';

/**
 * Stateful tab types
 *
 * These tabs stay mounted (hidden via CSS) when inactive because they
 * hold important user state that must be instantly restored on switch.
 *
 * Includes:
 * - chat: Chat session (message history, input content, scroll position)
 * - agent-execution: Agent execution (run state, live output, progress)
 * - claude-file: Claude file editor (unsaved edits)
 * - diff: Diff Viewer (needs right sidebar, stay mounted to avoid reload)
 * - file: File Viewer (read-only, stay mounted to avoid reload)
 * - webview: Web (preserve iframe state, avoid page reload)
 */
export const STATEFUL_TAB_TYPES = new Set<Tab['type']>([
  'chat',
  'agent-execution',
  'claude-file',
  'diff',
  'file',
  'webview',
]);

/**
 * Stateless tab types
 *
 * These tabs can be unmounted (conditional rendering) when inactive
 * because they hold no important transient state and reload quickly.
 * They also do not need the right sidebar.
 *
 * Includes:
 * - agents: Agents list (static list, data loaded from API)
 * - usage: Usage Dashboard (data loaded from API, no user input)
 * - mcp: MCP Manager (config UI with save button)
 * - settings: Settings (config UI with save button)
 * - claude-md: Memory (config UI with save button, prompts save on provider switch)
 * - create-agent: Create Agent (auto-closes on completion)
 * - import-agent: Import Agent (auto-closes on completion)
 * - agent: Agent output viewer (read-only, can reload)
 *
 * Note: diff type is read-only but needs the right sidebar for terminal interaction, so it's not here
 */
export const STATELESS_TAB_TYPES = new Set<Tab['type']>([
  'agents',
  'usage',
  'mcp',
  'settings',
  'claude-md',
  'create-agent',
  'import-agent',
  'agent',
]);

/**
 * Whether a tab should stay mounted when inactive
 *
 * @param tabType - Tab type
 * @returns true = keep mounted (CSS hidden), false = can unmount
 *
 * @example
 * ```ts
 * // Chat Tab stays mounted
 * shouldKeepTabMounted('chat') // true
 *
 * // Settings Tab can unmount
 * shouldKeepTabMounted('settings') // false
 * ```
 */
export function shouldKeepTabMounted(tabType: Tab['type']): boolean {
  return STATEFUL_TAB_TYPES.has(tabType);
}

/**
 * Whether a tab is stateless
 *
 * @param tabType - Tab type
 * @returns true = stateless, false = stateful
 */
export function isStatelessTab(tabType: Tab['type']): boolean {
  return STATELESS_TAB_TYPES.has(tabType);
}

/**
 * Get a human-readable description for a tab type
 *
 * @param tabType - Tab type
 * @returns Description string
 */
export function getTabTypeDescription(tabType: Tab['type']): string {
  const descriptions: Record<Tab['type'], string> = {
    'chat': 'Chat Session',
    'agent': 'Agent Output',
    'agents': 'Agents List',
    'usage': 'Usage Dashboard',
    'mcp': 'MCP Manager',
    'settings': 'Settings',
    'claude-md': 'Markdown Editor',
    'claude-file': 'Claude File Editor',
    'agent-execution': 'Agent Execution',
    'create-agent': 'Create Agent',
    'import-agent': 'Import Agent',
    'diff': 'Diff Viewer',
    'file': 'File Viewer',
    'webview': 'Web',
  };

  return descriptions[tabType] || 'Unknown';
}

/**
 * Whether a tab type supports multiple instances
 *
 * @param tabType - Tab type
 * @returns true = multi-instance, false = singleton
 */
export function supportsMultipleInstances(tabType: Tab['type']): boolean {
  const multiInstanceTypes: Set<Tab['type']> = new Set([
    'chat',              // Each project can have multiple sessions
    'agent-execution',   // Can run multiple agents simultaneously
    'claude-md',         // Can open multiple files
    'claude-file',       // Can open multiple files
    // Note: diff and file share a single tab slot, singleton per project
  ]);

  return multiInstanceTypes.has(tabType);
}

/**
 * Whether a tab type is singleton
 *
 * @param tabType - Tab type
 * @returns true = singleton, false = multi-instance
 */
export function isSingletonTab(tabType: Tab['type']): boolean {
  return !supportsMultipleInstances(tabType);
}

/**
 * Get memory weight for a tab type (for performance analysis)
 *
 * @param tabType - Tab type
 * @returns Weight number, higher = more memory usage
 */
export function getTabMemoryWeight(tabType: Tab['type']): number {
  const weights: Record<Tab['type'], number> = {
    'chat': 5,              // Message history, AI model context
    'agent-execution': 4,   // Run state, log output
    'claude-md': 3,         // Text editor content
    'claude-file': 3,       // Text editor content
    'webview': 3,           // iframe content, page state
    'agents': 2,            // List data
    'usage': 2,             // Chart data
    'mcp': 2,               // Config data
    'settings': 1,          // Form data
    'diff': 2,              // Diff data
    'file': 2,              // File content
    'create-agent': 1,      // Form data
    'import-agent': 1,      // Form data
    'agent': 1,             // Log output
  };

  return weights[tabType] || 1;
}