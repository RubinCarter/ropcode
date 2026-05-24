/**
 * File path utility functions
 */

/**
 * Convert a file path to a loadable URL.
 * Uses /local-file/<path> HTTP path, handled by Go server.
 * Compatible with dev mode (Go server reverse-proxies to Vite, Vite plugin handles it)
 * and prod/iOS mode (Go server reads local file and returns it directly).
 */
export function convertFileSrc(filePath: string): string {
  // If already a valid URL, return directly
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

  // Use /local-file/ HTTP path, supported by both Go server and Vite
  return `/local-file/${encodeURIComponent(filePath)}`;
}
