/**
 * Preview Widget Zustand Store
 *
 * Manages file preview state including file content, edit mode, loading state, etc.
 */

import { create } from 'zustand';
import type { FileInfo } from '../types';

/**
 * Preview type enum
 * Determines which previewer to use based on file type
 */
export type PreviewType =
  | 'code'       // Code file
  | 'markdown'   // Markdown document
  | 'image'      // Image
  | 'video'      // Video
  | 'audio'      // Audio
  | 'pdf'        // PDF document
  | 'csv'        // CSV table
  | 'directory'  // Directory
  | 'unknown';   // Unknown type

/**
 * Preview Store state interface
 */
interface PreviewState {
  /** Current file path being previewed */
  filePath: string;

  /** File info */
  fileInfo: FileInfo | null;

  /** File content */
  content: string | null;

  /** Whether in edit mode */
  editMode: boolean;

  /** Whether content has been modified */
  isDirty: boolean;

  /** Loading state */
  isLoading: boolean;

  /** Error message */
  error: string | null;

  /** Preview type */
  previewType: PreviewType;
}

/**
 * Preview Store Actions interface
 */
interface PreviewActions {
  /**
   * Set file path
   * @param path File path
   */
  setFilePath: (path: string) => void;

  /**
   * Set file info
   * @param info File info object
   */
  setFileInfo: (info: FileInfo | null) => void;

  /**
   * Set file content
   * @param content File content string
   */
  setContent: (content: string | null) => void;

  /**
   * Toggle edit mode
   */
  toggleEditMode: () => void;

  /**
   * Set edit mode
   * @param mode Whether to enable edit mode
   */
  setEditMode: (mode: boolean) => void;

  /**
   * Set content modified state
   * @param dirty Whether content has been modified
   */
  setDirty: (dirty: boolean) => void;

  /**
   * Set loading state
   * @param loading Whether currently loading
   */
  setLoading: (loading: boolean) => void;

  /**
   * Set error message
   * @param error Error message string
   */
  setError: (error: string | null) => void;

  /**
   * Set preview type
   * @param type Preview type
   */
  setPreviewType: (type: PreviewType) => void;

  /**
   * Reset to initial state
   */
  reset: () => void;
}

/**
 * Preview Store complete type
 */
type PreviewStore = PreviewState & PreviewActions;

/**
 * Initial state
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
  // Initial state
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
