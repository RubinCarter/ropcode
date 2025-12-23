/**
 * Shell 操作
 *
 * 在 Web 模式下使用 window.open
 */

export async function open(path: string): Promise<void> {
  window.open(path, '_blank');
}
