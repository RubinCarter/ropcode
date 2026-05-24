/**
 * Dialog features
 *
 * In Electron mode, uses Electron's dialog API.
 * In Web mode, uses native HTML5 dialog.
 */

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenOptions {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: FileFilter[];
}

export interface OpenReturnValue {
  canceled: boolean;
  filePaths?: string[];
}

export interface SaveReturnValue {
  canceled: boolean;
  filePath?: string;
}

// electronAPI type declared in vite-env.d.ts

/**
 * Check if running in Electron environment
 */
function isElectron(): boolean {
  return typeof window !== 'undefined' && window.electronAPI?.openDirectory !== undefined;
}

/**
 * Open file or directory selection dialog
 */
export async function open(options: OpenOptions = {}): Promise<OpenReturnValue> {
  const { directory = false, multiple = false } = options;

  // In Electron environment, use Electron's dialog API
  if (isElectron()) {
    if (directory) {
      return await window.electronAPI!.openDirectory!();
    } else {
      return await window.electronAPI!.openFile!({ multiple });
    }
  }

  // Web mode: use HTML5 file input
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = directory ? 'webkitdirectory' : 'file';
    if (multiple) {
      input.multiple = true;
    }
    input.style.display = 'none';

    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      const files = Array.from(target.files || []);

      if (files.length > 0) {
        resolve({
          canceled: false,
          filePaths: files.map(f => (f as any).path || f.name),
        });
      } else {
        resolve({ canceled: true });
      }

      input.remove();
    };

    input.oncancel = () => {
      resolve({ canceled: true });
      input.remove();
    };

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Save file dialog
 */
export async function save(options: { title?: string; defaultPath?: string; filters?: FileFilter[] } = {}): Promise<SaveReturnValue> {
  // Simplified handling in Web mode, return canceled
  return { canceled: true };
}
