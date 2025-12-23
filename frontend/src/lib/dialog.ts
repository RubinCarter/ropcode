/**
 * 对话框功能
 *
 * 在 Electron 模式下，对话框由前端处理
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

/**
 * 打开文件或目录选择对话框
 */
export async function open(options: OpenOptions = {}): Promise<OpenReturnValue> {
  const { directory = false, multiple = false, title = '', defaultPath = '' } = options;

  // 使用 HTML5 file input
  return new Promise((resolve) => {
    // 创建隐藏的 input 元素
    const input = document.createElement('input');
    input.type = directory ? 'webkitdirectory' : 'file';
    if (multiple) {
      input.multiple = true;
    }

    // 触发文件选择
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      const files = Array.from(target.files || []);

      if (files.length > 0) {
        resolve({
          canceled: false,
          filePaths: files.map(f => f.path),
        });
      } else {
        resolve({ canceled: true });
      }

      // 清理
      input.remove();
    };

    // 取消时也要清理
    input.oncancel = () => {
      resolve({ canceled: true });
      input.remove();
    };

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
