/**
 * Widget 系统统一导出
 */

// 导出所有类型
export type {
  WidgetType,
  WidgetStatus,
  WidgetModel,
  FileInfo,
  FileData,
  FileListOptions,
  WidgetConfig,
  TerminalWidgetConfig,
  FilesWidgetConfig,
  PreviewWidgetConfig,
  WebWidgetConfig,
} from './types';

// 导出工具函数
export { generateWidgetId } from './types';

// 导出基础模块
export {
  BaseWidgetModel,
  widgetRegistry,
  WidgetProvider,
  useWidget,
  useActiveWidget,
  useWidgetRegistry,
} from './base';

// 导出 Terminal Widget
export { TermWrap, useTerminalStore, getTheme, themeNames, themes } from './terminal';
export type { TermWrapOptions } from './terminal';

// 导出 Files Widget
export { FilesWidgetModel, useFilesStore } from './files';

// 导出 Preview Widget
export {
  PreviewWidgetModel,
  usePreviewStore,
  isTextFile,
  isStreamingType,
  detectPreviewType,
  iconForFile,
} from './preview';
export type { PreviewType } from './preview';

// 导出 Web Widget
export { WebWidgetModel, useWebStore } from './web';
