export function hasNativeWindowControls(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
}

export function usesMetaKeyForAppShortcuts(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
}

export function fileManagerLabel(): string {
  return 'Finder';
}
