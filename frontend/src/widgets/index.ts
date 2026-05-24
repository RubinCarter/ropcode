/**
 * Widget system unified exports
 */

// Export all types
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

// Export utility functions
export { generateWidgetId } from './types';

// Export base modules
export {
  BaseWidgetModel,
  widgetRegistry,
  WidgetProvider,
  useWidget,
  useActiveWidget,
  useWidgetRegistry,
} from './base';

// Export Terminal Widget
export { TermWrap, useTerminalStore, getTheme, themeNames, themes } from './terminal';
export type { TermWrapOptions } from './terminal';

// Export Files Widget
export { FilesWidgetModel, useFilesStore } from './files';

// Export Preview Widget
export {
  PreviewWidgetModel,
  usePreviewStore,
  isTextFile,
  isStreamingType,
  detectPreviewType,
  iconForFile,
} from './preview';
export type { PreviewType } from './preview';

// Export Web Widget
export { WebWidgetModel, useWebStore } from './web';
