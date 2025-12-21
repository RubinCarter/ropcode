/**
 * Dialog compatibility shim for Wails
 *
 * Uses Wails runtime to open native OS dialogs.
 */

import * as App from '../../wailsjs/go/main/App';

export interface OpenDialogOptions {
  /** Whether to allow selecting directories */
  directory?: boolean;
  /** Whether to allow multiple selection */
  multiple?: boolean;
  /** Dialog title */
  title?: string;
  /** Default path to start in */
  defaultPath?: string;
  /** File filters */
  filters?: Array<{
    name: string;
    extensions: string[];
  }>;
}

export interface SaveDialogOptions {
  /** Dialog title */
  title?: string;
  /** Default path/filename */
  defaultPath?: string;
  /** File filters */
  filters?: Array<{
    name: string;
    extensions: string[];
  }>;
}

/**
 * Open file/directory picker dialog
 *
 * Uses Wails native dialog for proper OS integration.
 */
export async function open(options?: OpenDialogOptions): Promise<string | string[] | null> {
  try {
    const title = options?.title || (options?.directory ? 'Select Directory' : 'Select File');
    const defaultPath = options?.defaultPath || '';

    if (options?.directory) {
      // Use native directory dialog
      const result = await App.OpenDirectoryDialog(title, defaultPath);
      if (!result || result === '') {
        return null;
      }
      return result;
    } else {
      // Use native file dialog
      const filters = options?.filters?.map(f => ({
        name: f.name,
        extensions: f.extensions
      })) || [];

      const result = await App.OpenFileDialog(title, defaultPath, filters);
      if (!result || result === '') {
        return null;
      }

      if (options?.multiple) {
        // OpenFileDialog returns single file, for multiple we'd need OpenMultipleFilesDialog
        return [result];
      }
      return result;
    }
  } catch (err) {
    console.error('Dialog open error:', err);
    return null;
  }
}

/**
 * Save file dialog
 *
 * Note: This is a stub implementation.
 * For production, implement backend Go function.
 */
export async function save(options?: SaveDialogOptions): Promise<string | null> {
  // TODO: Call backend Go function via Wails for native dialog
  // For now, return a stub path

  console.warn('save() is not fully implemented - using stub');

  // Return a placeholder path
  const filename = options?.defaultPath || 'untitled.txt';
  return filename;
}
