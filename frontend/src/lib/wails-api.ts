/**
 * Wails API 兼容层
 *
 * 提供 convertFileSrc 等兼容函数
 */

/**
 * 将文件路径转换为可加载的 URL
 * 在 Web 模式下直接返回路径
 */
export function convertFileSrc(filePath: string): string {
  // 在 Web 模式下，直接返回文件路径
  // 在 Electron 模式下，可能需要特殊处理
  return filePath;
}
