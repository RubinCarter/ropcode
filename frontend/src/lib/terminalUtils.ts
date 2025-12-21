/**
 * Terminal 工具函数
 */

/**
 * 生成唯一的 Terminal ID
 * 使用时间戳 + 随机字符串确保唯一性
 */
export function generateTerminalId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `${timestamp}-${random}`;
}

/**
 * 生成 Terminal 标题
 */
export function generateTerminalTitle(index: number): string {
  return `Terminal ${index}`;
}

/**
 * 解析 workspace 路径，获取存储键
 */
export function getWorkspaceStorageKey(workspacePath: string | undefined): string {
  return workspacePath || 'default';
}

/**
 * 本地存储键前缀
 */
const STORAGE_PREFIX = 'ropcode-terminal-state';

/**
 * 保存 workspace 的 terminal 状态到本地存储
 */
export function saveTerminalState(workspaceKey: string, state: any): void {
  try {
    const key = `${STORAGE_PREFIX}-${workspaceKey}`;
    // 只保存必要的数据
    const stateToSave = {
      sessions: state.sessions,
      activeSessionId: state.activeSessionId,
      commandHistory: state.commandHistory.slice(0, 50), // 只保存最近 50 条历史
    };
    localStorage.setItem(key, JSON.stringify(stateToSave));
  } catch (error) {
    console.error('[terminalUtils] Failed to save terminal state:', error);
  }
}

/**
 * 从本地存储加载 workspace 的 terminal 状态
 */
export function loadTerminalState(workspaceKey: string): any | null {
  try {
    const key = `${STORAGE_PREFIX}-${workspaceKey}`;
    const saved = localStorage.getItem(key);
    if (!saved) return null;

    const state = JSON.parse(saved);
    // 验证数据完整性
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
 * 清除 workspace 的 terminal 状态
 */
export function clearTerminalState(workspaceKey: string): void {
  try {
    const key = `${STORAGE_PREFIX}-${workspaceKey}`;
    localStorage.removeItem(key);
  } catch (error) {
    console.error('[terminalUtils] Failed to clear terminal state:', error);
  }
}
