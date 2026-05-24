/**
 * Shell operations
 *
 * In Web mode, uses window.open.
 */

export async function open(path: string): Promise<void> {
  window.open(path, '_blank');
}
