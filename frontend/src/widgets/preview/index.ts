/**
 * Preview Widget 模块导出
 */

// 导出 Widget Model
export { PreviewWidgetModel } from './PreviewWidgetModel';

// 导出 Zustand store
export { usePreviewStore } from './PreviewModel';

// 导出 MIME 工具
export {
  isTextFile,
  isStreamingType,
  detectPreviewType,
  iconForFile,
  type PreviewType,
} from './mime-utils';
