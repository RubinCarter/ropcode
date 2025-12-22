import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import type { FileInfo } from '../types';

/**
 * 排序字段类型
 */
export type FileSortBy = 'name' | 'size' | 'modtime' | 'modestr';

/**
 * 排序方向类型
 */
export type FileSortDirection = 'asc' | 'desc';

/**
 * Files Widget 状态接口
 */
interface FilesState {
  // 状态
  /** 当前目录路径 */
  currentPath: string;
  /** 当前目录文件列表 */
  entries: FileInfo[];
  /** 焦点索引 */
  focusIndex: number;
  /** 搜索过滤文本 */
  searchText: string;
  /** 是否显示隐藏文件 */
  showHidden: boolean;
  /** 加载状态 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 排序字段 */
  sortBy: FileSortBy;
  /** 排序方向 */
  sortDirection: FileSortDirection;

  // 计算属性
  /** 根据 searchText 过滤的文件列表 */
  filteredEntries: () => FileInfo[];

  // Actions
  /** 设置当前目录路径 */
  setCurrentPath: (path: string) => void;
  /** 设置文件列表 */
  setEntries: (entries: FileInfo[]) => void;
  /** 设置焦点索引 */
  setFocusIndex: (index: number) => void;
  /** 焦点上移 */
  moveFocusUp: () => void;
  /** 焦点下移 */
  moveFocusDown: () => void;
  /** 设置搜索文本 */
  setSearchText: (text: string) => void;
  /** 切换是否显示隐藏文件 */
  toggleShowHidden: () => void;
  /** 设置加载状态 */
  setLoading: (loading: boolean) => void;
  /** 设置错误信息 */
  setError: (error: string | null) => void;
  /** 设置排序字段 */
  setSortBy: (sortBy: FileSortBy) => void;
  /** 切换排序方向 */
  toggleSortDirection: () => void;
  /** 重置到初始状态 */
  reset: () => void;
}

/**
 * 默认初始状态
 */
const DEFAULT_STATE = {
  currentPath: '',
  entries: [],
  focusIndex: 0,
  searchText: '',
  showHidden: false,
  isLoading: false,
  error: null,
  sortBy: 'name' as FileSortBy,
  sortDirection: 'asc' as FileSortDirection,
};

/**
 * Files Widget Store
 *
 * 管理文件浏览器的状态和交互逻辑
 * 包括目录导航、文件列表、搜索过滤、排序等功能
 */
const filesStore: StateCreator<FilesState> = (set, get) => ({
  // Initial state
  ...DEFAULT_STATE,

  // Computed properties
  filteredEntries: () => {
    const { entries, searchText, showHidden } = get();
    let filtered = entries;

    // 过滤隐藏文件
    if (!showHidden) {
      filtered = filtered.filter((entry) => !entry.name.startsWith('.'));
    }

    // 搜索过滤
    if (searchText.trim()) {
      const search = searchText.toLowerCase();
      filtered = filtered.filter((entry) =>
        entry.name.toLowerCase().includes(search)
      );
    }

    return filtered;
  },

  // Actions

  /**
   * 设置当前目录路径
   * @param path 目录路径
   */
  setCurrentPath: (path: string) => {
    set({ currentPath: path, focusIndex: 0 });
  },

  /**
   * 设置文件列表
   * @param entries 文件列表
   */
  setEntries: (entries: FileInfo[]) => {
    set({ entries, focusIndex: 0 });
  },

  /**
   * 设置焦点索引
   * @param index 焦点索引
   */
  setFocusIndex: (index: number) => {
    const { filteredEntries } = get();
    const filtered = filteredEntries();

    if (filtered.length === 0) {
      set({ focusIndex: 0 });
      return;
    }

    // 限制索引范围
    const clampedIndex = Math.max(0, Math.min(index, filtered.length - 1));
    set({ focusIndex: clampedIndex });
  },

  /**
   * 焦点上移
   */
  moveFocusUp: () => {
    const { focusIndex } = get();
    const newIndex = Math.max(0, focusIndex - 1);
    get().setFocusIndex(newIndex);
  },

  /**
   * 焦点下移
   */
  moveFocusDown: () => {
    const { focusIndex, filteredEntries } = get();
    const filtered = filteredEntries();
    const newIndex = Math.min(filtered.length - 1, focusIndex + 1);
    get().setFocusIndex(newIndex);
  },

  /**
   * 设置搜索文本
   * @param text 搜索文本
   */
  setSearchText: (text: string) => {
    set({ searchText: text, focusIndex: 0 });
  },

  /**
   * 切换是否显示隐藏文件
   */
  toggleShowHidden: () => {
    set((state) => ({
      showHidden: !state.showHidden,
      focusIndex: 0,
    }));
  },

  /**
   * 设置加载状态
   * @param loading 是否正在加载
   */
  setLoading: (loading: boolean) => {
    set({ isLoading: loading });
  },

  /**
   * 设置错误信息
   * @param error 错误信息,null 表示清除错误
   */
  setError: (error: string | null) => {
    set({ error });
  },

  /**
   * 设置排序字段
   * @param sortBy 排序字段
   */
  setSortBy: (sortBy: FileSortBy) => {
    set({ sortBy });
  },

  /**
   * 切换排序方向
   */
  toggleSortDirection: () => {
    set((state) => ({
      sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc',
    }));
  },

  /**
   * 重置到初始状态
   */
  reset: () => {
    set(DEFAULT_STATE);
  },
});

/**
 * Files Widget Store Hook
 *
 * @example
 * ```tsx
 * function FilesWidget() {
 *   const currentPath = useFilesStore((state) => state.currentPath);
 *   const setCurrentPath = useFilesStore((state) => state.setCurrentPath);
 *   const filteredEntries = useFilesStore((state) => state.filteredEntries());
 *
 *   return (
 *     <div>
 *       <div>Current Path: {currentPath}</div>
 *       <ul>
 *         {filteredEntries.map((entry) => (
 *           <li key={entry.path}>{entry.name}</li>
 *         ))}
 *       </ul>
 *     </div>
 *   );
 * }
 * ```
 */
export const useFilesStore = create<FilesState>()(filesStore);
