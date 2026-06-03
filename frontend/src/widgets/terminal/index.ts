/**
 * Terminal Widget module exports
 */

// Export PTY terminal runtime
export { PtyTermWrap as TermWrap, type PtyTermWrapOptions as TermWrapOptions } from './PtyTermWrap';
export { PtyTermWrap, type PtyTermWrapOptions } from './PtyTermWrap';

// Export Zustand store
export { useTerminalStore } from './TerminalModel';

// Export themes
export { getTheme, themeNames, themes } from './themes';
