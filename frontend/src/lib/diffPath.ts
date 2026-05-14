export interface DiffFilePaths {
  absolutePath: string;
  gitPath: string;
}

const normalizePathSeparators = (path: string) => path.replace(/\\/g, '/');

const joinPath = (basePath: string, relativePath: string) => {
  const base = basePath.replace(/\/+$/, '');
  const relative = relativePath.replace(/^\/+/, '');
  return `${base}/${relative}`;
};

const isAbsolutePath = (path: string) => path.startsWith('/');

export function getDiffFilePaths(filePath: string, workspacePath: string): DiffFilePaths {
  const normalizedFilePath = normalizePathSeparators(filePath);
  const normalizedWorkspacePath = normalizePathSeparators(workspacePath).replace(/\/+$/, '');
  const workspacePrefix = `${normalizedWorkspacePath}/`;

  if (normalizedFilePath === normalizedWorkspacePath) {
    return {
      absolutePath: filePath,
      gitPath: '',
    };
  }

  if (normalizedFilePath.startsWith(workspacePrefix)) {
    return {
      absolutePath: filePath,
      gitPath: normalizedFilePath.slice(workspacePrefix.length),
    };
  }

  return {
    absolutePath: isAbsolutePath(filePath) ? filePath : joinPath(workspacePath, filePath),
    gitPath: normalizedFilePath.replace(/^\/+/, ''),
  };
}

export function quoteGitPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
