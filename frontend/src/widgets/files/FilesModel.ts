import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import type { FileInfo } from '../types';

/**
 * Sort field type
 */
export type FileSortBy = 'name' | 'size' | 'modtime' | 'modestr';

/**
 * Sort direction type
 */
export type FileSortDirection = 'asc' | 'desc';

/**
 * Files Widget state interface
 */
interface FilesState {
  // state
  /** Current directory path */
  currentPath: string;
  /** Current directory file list */
  entries: FileInfo[];
  /** Focus index */
  focusIndex: number;
  /** Search filter text */
  searchText: string;
  /** Whether to show hidden files */
  showHidden: boolean;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Sort field */
  sortBy: FileSortBy;
  /** Sort direction */
  sortDirection: FileSortDirection;

  // Computed properties
  /** File list filtered by searchText */
  filteredEntries: () => FileInfo[];

  // Actions
  /** Set current directory path */
  setCurrentPath: (path: string) => void;
  /** Set file list */
  setEntries: (entries: FileInfo[]) => void;
  /** Set focus index */
  setFocusIndex: (index: number) => void;
  /** Move focus up */
  moveFocusUp: () => void;
  /** Move focus down */
  moveFocusDown: () => void;
  /** Set search text */
  setSearchText: (text: string) => void;
  /** Toggle hidden file visibility */
  toggleShowHidden: () => void;
  /** Set loading state */
  setLoading: (loading: boolean) => void;
  /** Set error message */
  setError: (error: string | null) => void;
  /** Set sort field */
  setSortBy: (sortBy: FileSortBy) => void;
  /** Toggle sort direction */
  toggleSortDirection: () => void;
  /** Reset to initial state */
  reset: () => void;
}

/**
 * Default initial state
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
 * Manages file browser state and interaction logic.
 * Including directory navigation, file list, search filter, sorting, etc.
 */
const filesStore: StateCreator<FilesState> = (set, get) => ({
  // Initial state
  ...DEFAULT_STATE,

  // Computed properties
  filteredEntries: () => {
    const { entries, searchText, showHidden } = get();
    let filtered = entries;

    // Filter hidden files
    if (!showHidden) {
      filtered = filtered.filter((entry) => !entry.name.startsWith('.'));
    }

    // Search filter
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
   * Set current directory path
   * @param path Directory path
   */
  setCurrentPath: (path: string) => {
    set({ currentPath: path, focusIndex: 0 });
  },

  /**
   * Set file list
   * @param entries File list
   */
  setEntries: (entries: FileInfo[]) => {
    set({ entries, focusIndex: 0 });
  },

  /**
   * Set focus index
   * @param index Focus index
   */
  setFocusIndex: (index: number) => {
    const { filteredEntries } = get();
    const filtered = filteredEntries();

    if (filtered.length === 0) {
      set({ focusIndex: 0 });
      return;
    }

    // Clamp index to valid range
    const clampedIndex = Math.max(0, Math.min(index, filtered.length - 1));
    set({ focusIndex: clampedIndex });
  },

  /**
   * Move focus up
   */
  moveFocusUp: () => {
    const { focusIndex } = get();
    const newIndex = Math.max(0, focusIndex - 1);
    get().setFocusIndex(newIndex);
  },

  /**
   * Move focus down
   */
  moveFocusDown: () => {
    const { focusIndex, filteredEntries } = get();
    const filtered = filteredEntries();
    const newIndex = Math.min(filtered.length - 1, focusIndex + 1);
    get().setFocusIndex(newIndex);
  },

  /**
   * Set search text
   * @param text Search text
   */
  setSearchText: (text: string) => {
    set({ searchText: text, focusIndex: 0 });
  },

  /**
   * Toggle hidden file visibility
   */
  toggleShowHidden: () => {
    set((state) => ({
      showHidden: !state.showHidden,
      focusIndex: 0,
    }));
  },

  /**
   * Set loading state
   * @param loading Whether currently loading
   */
  setLoading: (loading: boolean) => {
    set({ isLoading: loading });
  },

  /**
   * Set error message
   * @param error Error message, null to clear error
   */
  setError: (error: string | null) => {
    set({ error });
  },

  /**
   * Set sort field
   * @param sortBy Sort field
   */
  setSortBy: (sortBy: FileSortBy) => {
    set({ sortBy });
  },

  /**
   * Toggle sort direction
   */
  toggleSortDirection: () => {
    set((state) => ({
      sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc',
    }));
  },

  /**
   * Reset to initial state
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
