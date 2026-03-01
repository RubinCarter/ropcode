/**
 * 文件路径工具函数
 */

/**
 * 将文件路径转换为可加载的 URL
 * 统一使用 /local-file/<path> HTTP 路径，由 Go server 处理
 * 兼容 dev 模式（Go server 反向代理到 Vite，Vite 插件处理）
 * 兼容 prod/iOS 模式（Go server 直接读取本地文件返回）
 */
export function convertFileSrc(filePath: string): string {
  // 如果已经是有效的 URL，直接返回
  if (filePath && (
    filePath.startsWith('file://') ||
    filePath.startsWith('http://') ||
    filePath.startsWith('https://') ||
    filePath.startsWith('/local-file/') ||
    filePath.startsWith('local-file://') ||
    filePath.startsWith('data:')
  )) {
    return filePath;
  }

  // 统一使用 /local-file/ HTTP 路径，Go server 和 Vite 都支持此路径
  return `/local-file/${encodeURIComponent(filePath)}`;
}
