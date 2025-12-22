/**
 * Preview Widget Zustand Store
 *
 * 管理文件预览的状态，包括文件内容、编辑模式、加载状态等
 */

import { create } from 'zustand';
import type { FileInfo } from '../types';

/**
 * 预览类型枚举
 * 根据文件类型决定使用哪种预览器
 */
export type PreviewType =
  | 'code'       // 代码文件
  | 'markdown'   // Markdown 文档
  | 'image'      // 图片
  | 'video'      // 视频
  | 'audio'      // 音频
  | 'pdf'        // PDF 文档
  | 'csv'        // CSV 表格
  | 'directory'  // 目录
  | 'unknown';   // 未知类型

/**
 * Preview Store 状态接口
 */
interface PreviewState {
  /** 当前预览的文件路径 */
  filePath: string;

  /** 文件信息 */
  fileInfo: FileInfo | null;

  /** 文件内容 */
  content: string | null;

  /** 是否为编辑模式 */
  editMode: boolean;

  /** 内容是否被修改 */
  isDirty: boolean;

  /** 加载状态 */
  isLoading: boolean;

  /** 错误信息 */
  error: string | null;

  /** 预览类型 */
  previewType: PreviewType;
}

/**
 * Preview Store Actions 接口
 */
interface PreviewActions {
  /**
   * 设置文件路径
   * @param path 文件路径
   */
  setFilePath: (path: string) => void;

  /**
   * 设置文件信息
   * @param info 文件信息对象
   */
  setFileInfo: (info: FileInfo | null) => void;

  /**
   * 设置文件内容
   * @param content 文件内容字符串
   */
  setContent: (content: string | null) => void;

  /**
   * 切换编辑模式
   */
  toggleEditMode: () => void;

  /**
   * 设置编辑模式
   * @param mode 是否开启编辑模式
   */
  setEditMode: (mode: boolean) => void;

  /**
   * 设置内容修改状态
   * @param dirty 是否已修改
   */
  setDirty: (dirty: boolean) => void;

  /**
   * 设置加载状态
   * @param loading 是否正在加载
   */
  setLoading: (loading: boolean) => void;

  /**
   * 设置错误信息
   * @param error 错误信息字符串
   */
  setError: (error: string | null) => void;

  /**
   * 设置预览类型
   * @param type 预览类型
   */
  setPreviewType: (type: PreviewType) => void;

  /**
   * 重置到初始状态
   */
  reset: () => void;
}

/**
 * Preview Store 完整类型
 */
type PreviewStore = PreviewState & PreviewActions;

/**
 * 初始状态
 */
const initialState: PreviewState = {
  filePath: '',
  fileInfo: null,
  content: null,
  editMode: false,
  isDirty: false,
  isLoading: false,
  error: null,
  previewType: 'unknown',
};

/**
 * Preview Widget Zustand Store
 *
 * @example
 * ```typescript
 * function PreviewComponent() {
 *   const { filePath, content, setFilePath, setContent } = usePreviewStore();
 *
 *   useEffect(() => {
 *     setFilePath('/path/to/file.ts');
 *   }, []);
 *
 *   return <div>{content}</div>;
 * }
 * ```
 */
export const usePreviewStore = create<PreviewStore>((set) => ({
  // 初始状态
  ...initialState,

  // Actions
  setFilePath: (path) => set({ filePath: path }),

  setFileInfo: (info) => set({ fileInfo: info }),

  setContent: (content) => set({ content }),

  toggleEditMode: () => set((state) => ({ editMode: !state.editMode })),

  setEditMode: (mode) => set({ editMode: mode }),

  setDirty: (dirty) => set({ isDirty: dirty }),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  setPreviewType: (type) => set({ previewType: type }),

  reset: () => set(initialState),
}));
