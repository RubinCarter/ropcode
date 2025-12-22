/**
 * Terminal Widget 模块导出
 */

// 导出 TermWrap 类
export { TermWrap, type TermWrapOptions } from './TermWrap';

// 导出 Zustand store
export { useTerminalStore } from './TerminalModel';

// 导出主题
export { getTheme, themeNames, themes } from './themes';
