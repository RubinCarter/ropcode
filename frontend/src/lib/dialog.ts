/**
 * 对话框功能
 *
 * 在 Electron 模式下，使用 Electron 的 dialog API
 * 在 Web 模式下，使用原生 HTML5 对话框
 */

export interface OpenOptions {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  defaultPath?: string;
}

export interface OpenReturnValue {
  canceled: boolean;
  filePaths?: string[];
}

// 声明 electronAPI 类型
declare global {
  interface Window {
    electronAPI?: {
      openDirectory?: () => Promise<{ canceled: boolean; filePaths?: string[] }>;
      openFile?: (options?: { multiple?: boolean }) => Promise<{ canceled: boolean; filePaths?: string[] }>;
      [key: string]: any;
    };
  }
}

/**
 * 检查是否在 Electron 环境中
 */
function isElectron(): boolean {
  return typeof window !== 'undefined' && window.electronAPI?.openDirectory !== undefined;
}

/**
 * 打开文件或目录选择对话框
 */
export async function open(options: OpenOptions = {}): Promise<OpenReturnValue> {
  const { directory = false, multiple = false } = options;

  // 在 Electron 环境中使用 Electron 的 dialog API
  if (isElectron()) {
    if (directory) {
      return await window.electronAPI!.openDirectory!();
    } else {
      return await window.electronAPI!.openFile!({ multiple });
    }
  }

  // Web 模式：使用 HTML5 file input
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
 * 保存文件对话框
 */
export async function save(options: { title?: string; defaultPath?: string } = {}): Promise<OpenReturnValue> {
  // 在 Web 模式下简化处理，直接返回
  return { canceled: true };
}
