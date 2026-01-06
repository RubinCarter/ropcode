/**
 * 文件路径工具函数
 */

/**
 * 将文件路径转换为可加载的 URL
 * 在 Electron 开发模式下使用自定义 local-file:// 协议
 * 在生产模式下使用 file:// 协议
 */
export function convertFileSrc(filePath: string): string {
  // 如果已经是有效的 URL，直接返回
  if (filePath && (
    filePath.startsWith('file://') ||
    filePath.startsWith('http://') ||
    filePath.startsWith('https://') ||
    filePath.startsWith('local-file://') ||
    filePath.startsWith('data:')
  )) {
    return filePath;
  }

  // 检测是否在开发模式（从 localhost 加载）
  const isDev = typeof window !== 'undefined' && window.location.protocol === 'http:';

  if (isDev) {
    // 开发模式：使用自定义 local-file 协议绕过安全限制
    return `local-file://${encodeURIComponent(filePath)}`;
  } else {
    // 生产模式：使用 file:// 协议
    return `file://${filePath}`;
  }
}
