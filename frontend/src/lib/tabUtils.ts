import type { Tab } from '@/contexts/TabContext';

/**
 * 有状态的 Tab 类型集合
 *
 * 这些 Tab 在非活动时需要保持挂载状态（使用 CSS hidden 隐藏），
 * 因为它们包含重要的用户状态，切换回来时需要立即恢复。
 *
 * 包括：
 * - chat: 聊天会话（消息历史、输入框内容、滚动位置）
 * - agent-execution: Agent 执行（运行状态、实时输出、进度）
 * - claude-file: Claude 文件编辑器（未保存的编辑内容）
 * - diff: Diff Viewer（需要右侧栏支持，保持挂载以避免重新加载）
 * - file: File Viewer（只读文件查看器，保持挂载以避免重新加载）
 * - webview: Web（保持 iframe 状态，避免重新加载网页）
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
 * 无状态的 Tab 类型集合
 *
 * 这些 Tab 在非活动时可以直接卸载（条件渲染），
 * 因为它们不包含重要的临时状态，重新加载也很快。
 * 同时，这些 Tab 不需要显示右侧栏。
 *
 * 包括：
 * - agents: Agents 列表（静态列表，数据从 API 加载）
 * - usage: Usage Dashboard（数据从 API 加载，无用户输入）
 * - mcp: MCP Manager（配置界面，有保存按钮）
 * - settings: Settings（配置界面，有保存按钮）
 * - claude-md: Memory（配置界面，有保存按钮，切换 provider 会提示保存）
 * - create-agent: 创建 Agent（完成后自动关闭）
 * - import-agent: 导入 Agent（完成后自动关闭）
 * - agent: Agent 输出查看器（只读，可重新加载）
 *
 * 注意：diff 类型虽然是只读的，但需要显示右侧栏以支持终端交互，因此不在此列表中
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
 * 判断 Tab 是否需要在非活动时保持挂载状态
 *
 * @param tabType - Tab 类型
 * @returns true 表示需要保持挂载（使用 CSS hidden），false 表示可以卸载
 *
 * @example
 * ```ts
 * // Chat Tab 需要保持挂载
 * shouldKeepTabMounted('chat') // true
 *
 * // Settings Tab 可以卸载
 * shouldKeepTabMounted('settings') // false
 * ```
 */
export function shouldKeepTabMounted(tabType: Tab['type']): boolean {
  return STATEFUL_TAB_TYPES.has(tabType);
}

/**
 * 判断 Tab 是否为无状态类型
 *
 * @param tabType - Tab 类型
 * @returns true 表示无状态，false 表示有状态
 */
export function isStatelessTab(tabType: Tab['type']): boolean {
  return STATELESS_TAB_TYPES.has(tabType);
}

/**
 * 获取 Tab 类型的描述信息
 *
 * @param tabType - Tab 类型
 * @returns Tab 类型的描述
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
 * 判断 Tab 是否支持多实例
 *
 * @param tabType - Tab 类型
 * @returns true 表示支持多实例，false 表示单例
 */
export function supportsMultipleInstances(tabType: Tab['type']): boolean {
  const multiInstanceTypes: Set<Tab['type']> = new Set([
    'chat',              // 每个项目可以有多个会话
    'agent-execution',   // 可以同时运行多个 Agent
    'claude-md',         // 可以打开多个文件
    'claude-file',       // 可以打开多个文件
    // 注意：diff 和 file 共享同一个 tab slot，在每个项目中是单例模式
  ]);

  return multiInstanceTypes.has(tabType);
}

/**
 * 判断 Tab 是否为单例模式
 *
 * @param tabType - Tab 类型
 * @returns true 表示单例，false 表示支持多实例
 */
export function isSingletonTab(tabType: Tab['type']): boolean {
  return !supportsMultipleInstances(tabType);
}

/**
 * 获取 Tab 的内存权重（用于性能分析）
 *
 * @param tabType - Tab 类型
 * @returns 内存权重数字，越大表示内存占用越多
 */
export function getTabMemoryWeight(tabType: Tab['type']): number {
  const weights: Record<Tab['type'], number> = {
    'chat': 5,              // 消息历史、AI 模型上下文
    'agent-execution': 4,   // 运行状态、日志输出
    'claude-md': 3,         // 文本编辑器内容
    'claude-file': 3,       // 文本编辑器内容
    'webview': 3,           // iframe 内容、网页状态
    'agents': 2,            // 列表数据
    'usage': 2,             // 图表数据
    'mcp': 2,               // 配置数据
    'settings': 1,          // 表单数据
    'diff': 2,              // diff 数据
    'file': 2,              // 文件内容
    'create-agent': 1,      // 表单数据
    'import-agent': 1,      // 表单数据
    'agent': 1,             // 日志输出
  };

  return weights[tabType] || 1;
}