/**
 * URL open feature
 *
 * In Electron, uses window.electronAPI or shell.openExternal.
 */

export async function openUrl(url: string): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    // Electron mode - openUrl IPC not yet implemented, use default method
    window.open(url, '_blank');
  } else {
    // Web mode
    window.open(url, '_blank');
  }
}
