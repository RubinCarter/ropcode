/**
 * Windows path utilities for display and local path resolution.
 */

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

export function basename(path: string | undefined, fallback = ''): string {
  if (!path) return fallback;
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).pop() || path;
}

export function parentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/);
  parts.pop();
  const parent = parts.join('\\');
  if (parent) return parent;
  if (/^[a-zA-Z]:[\\/]?$/.test(trimmed)) return trimmed.slice(0, 2) + '\\';
  return '\\';
}

export function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/');
}

export function joinPath(basePath: string, relativePath: string): string {
  const base = basePath.replace(/[\\/]+$/, '');
  const relative = relativePath.replace(/^[\\/]+/, '');
  const separator = basePath.includes('\\') ? '\\' : '/';
  return `${base}${separator}${relative}`;
}

export function resolveWorkspacePath(path: string, workspacePath?: string): string {
  if (isAbsolutePath(path) || !workspacePath) {
    return path;
  }
  return joinPath(workspacePath, path);
}

export function homeRelativePath(path: string | undefined): string {
  if (!path) return 'Unknown Path';

  const normalizedPath = normalizePath(path);
  const homeIndicators = ['/Users/', '/home/', 'C:/Users/', 'C:/Documents and Settings/'];

  for (const indicator of homeIndicators) {
    if (normalizedPath.includes(indicator)) {
      const parts = normalizedPath.split('/');
      const marker = indicator.split('/').filter(Boolean).at(-1);
      const userIndex = parts.findIndex((_part, i) => i > 0 && parts[i - 1] === marker);
      if (userIndex > 0) {
        return `~/${parts.slice(userIndex + 1).join('/')}`;
      }
    }
  }

  return normalizedPath;
}

export function tailPath(path: string | undefined, count = 2): string {
  if (!path) return 'Unknown';
  const parts = normalizePath(path).split('/').filter(Boolean);
  return parts.slice(-count).join('/') || path;
}

export function pathSegments(path: string): string[] {
  return normalizePath(path).split('/').filter(Boolean);
}

export function shortenPath(filePath: string, workspacePath?: string): string {
  if (!filePath) {
    return filePath;
  }

  if (workspacePath) {
    const normalizedWorkspace = normalizePath(workspacePath).replace(/\/$/, '');
    const normalizedPath = normalizePath(filePath).replace(/\/$/, '');

    if (normalizedPath.startsWith(normalizedWorkspace + '/')) {
      return normalizedPath.slice(normalizedWorkspace.length + 1);
    }
  }

  const worktreeMatch = normalizePath(filePath).match(/\/\.ropcode\/[^/]+\/(.+)$/);
  if (worktreeMatch) {
    return worktreeMatch[1];
  }

  return filePath;
}
