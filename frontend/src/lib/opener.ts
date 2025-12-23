/**
 * URL 打开功能
 *
 * 在 Electron 中使用 window.electronAPI 或 shell.openExternal
 */

export async function openUrl(url: string): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    // Electron 模式 - 目前���有实现 openUrl IPC，可以用默认方式
    window.open(url, '_blank');
  } else {
    // Web 模式
    window.open(url, '_blank');
  }
}
