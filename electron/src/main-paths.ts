import path from 'node:path';

export function resolveDevCliBinaryPath(distDir: string, platform: NodeJS.Platform, arch: string): string {
  const repoRoot = path.join(distDir, '..', '..');
  const extension = platform === 'win32' ? '.exe' : '';
  const archDir = arch === 'arm64' ? 'arm64' : 'x64';
  switch (platform) {
    case 'darwin':
      return path.join(repoRoot, 'bin', 'darwin', archDir, `ropcode${extension}`);
    case 'linux':
      return path.join(repoRoot, 'bin', 'linux', 'x64', `ropcode${extension}`);
    case 'win32':
      return path.join(repoRoot, 'bin', 'win32', 'x64', `ropcode${extension}`);
    default:
      return path.join(repoRoot, 'bin', `ropcode${extension}`);
  }
}
