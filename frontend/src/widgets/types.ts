/**
 * Widget system type definitions
 *
 * Inspired by waveterm's ViewModel pattern, adapted to ropcode's Zustand architecture
 */

// Widget type enum
export type WidgetType = 'terminal' | 'files' | 'preview' | 'web';

// Widget status
export type WidgetStatus = 'initializing' | 'ready' | 'error' | 'disposed';

/**
 * Widget base interface
 * All widgets must implement this interface
 */
export interface WidgetModel {
  /** Widget type identifier */
  widgetType: WidgetType;

  /** Widget unique ID */
  widgetId: string;

  /** Widget current status */
  status: WidgetStatus;

  /**
   * Initialize Widget
   * Called when Widget mounts
   */
  initialize(): Promise<void>;

  /**
   * Dispose Widget
   * Called when Widget unmounts, releases resources
   */
  dispose(): void;

  /**
   * Give focus
   * @returns Whether focus was successfully acquired
   */
  giveFocus(): boolean;

  /**
   * Keyboard event handler
   * @param event Keyboard event
   * @returns Whether the event was handled (prevents bubbling)
   */
  keyDownHandler?(event: KeyboardEvent): boolean;
}

/**
 * File info type
 * Corresponds to Go backend's FileInfo struct
 */
export interface FileInfo {
  /** File name */
  name: string;
  /** Full path */
  path: string;
  /** Parent directory */
  dir: string;
  /** File size (bytes) */
  size: number;
  /** Permission string (e.g., "drwxr-xr-x") */
  modestr: string;
  /** Modified time (ISO 8601) */
  modtime: string;
  /** Whether it's a directory */
  isdir: boolean;
  /** MIME type */
  mimetype: string;
  /** Whether read-only */
  readonly: boolean;
}

/**
 * File data type
 * Used for reading file content
 */
export interface FileData {
  /** File path */
  path: string;
  /** File content (string for text files) */
  content: string;
  /** MIME type */
  mimetype: string;
}

/**
 * File list options
 */
export interface FileListOptions {
  /** Whether to show hidden files */
  showHidden: boolean;
}

/**
 * Widget config interface
 * Passed when creating a Widget
 */
export interface WidgetConfig {
  /** Widget ID, auto-generated if not provided */
  id?: string;
  /** Init params, varies by Widget type */
  initialParams?: Record<string, unknown>;
}

/**
 * Terminal Widget specific config
 */
export interface TerminalWidgetConfig extends WidgetConfig {
  initialParams?: {
    /** Font size */
    fontSize?: number;
    /** Theme name */
    themeName?: string;
    /** Transparency (0-1) */
    transparency?: number;
  };
}

/**
 * Files Widget specific config
 */
export interface FilesWidgetConfig extends WidgetConfig {
  initialParams?: {
    /** Initial path */
    initialPath?: string;
    /** Whether to show hidden files */
    showHidden?: boolean;
  };
}

/**
 * Preview Widget specific config
 */
export interface PreviewWidgetConfig extends WidgetConfig {
  initialParams?: {
    /** File path to preview */
    filePath?: string;
    /** Whether to open in edit mode */
    editMode?: boolean;
  };
}

/**
 * Web Widget specific config
 */
export interface WebWidgetConfig extends WidgetConfig {
  initialParams?: {
    /** Initial URL */
    initialUrl?: string;
    /** Homepage URL */
    homepageUrl?: string;
  };
}

/**
 * Generate unique Widget ID
 */
export function generateWidgetId(type: WidgetType): string {
  return `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
