/**
 * 文件路径工具函数
 */

/**
 * 将文件路径转换为可加载的 URL
 * 在 Electron 模式下使用 file:// 协议
 */
export function convertFileSrc(filePath: string): string {
  // 在 Electron 中，本地文件路径需要转换为 file:// URL
  if (filePath && !filePath.startsWith('file://') && !filePath.startsWith('http')) {
    return `file://${filePath}`;
  }
  return filePath;
}
