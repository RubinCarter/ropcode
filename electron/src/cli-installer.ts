import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export type InstallPlatform = NodeJS.Platform;

export interface InstallTarget {
  kind: 'symlink' | 'copy';
  directory: string;
  linkPath: string;
  needsPathUpdate: boolean;
  pathEntry: string;
  shellProfilePath?: string;
}

export interface InstallResult {
  linkPath: string;
  pathUpdated: boolean;
  shellProfilePath?: string;
}

export interface InstallEnvironment {
  platform: InstallPlatform;
  homeDir: string;
  pathValue: string;
  cliBinaryPath: string;
  fileExists(candidate: string): Promise<boolean>;
  mkdir(dir: string): Promise<void>;
  symlink(target: string, linkPath: string): Promise<void>;
  writeFile(filePath: string, content: string): Promise<void>;
  readFile(filePath: string): Promise<string>;
  chmod(filePath: string, mode: number): Promise<void>;
  copyFile(src: string, dst: string): Promise<void>;
  removeFile(filePath: string): Promise<void>;
  setUserPath(value: string): Promise<void>;
}

function splitPathEntries(pathValue: string, platform: InstallPlatform): string[] {
  return pathValue
    .split(platform === 'win32' ? ';' : ':')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function ensurePathContains(pathValue: string, entry: string, platform: InstallPlatform = process.platform): string {
  const separator = platform === 'win32' ? ';' : ':';
  const entries = splitPathEntries(pathValue, platform);
  if (entries.includes(entry)) {
    return entries.join(separator);
  }
  return entries.length > 0 ? `${entries.join(separator)}${separator}${entry}` : entry;
}

export function getCliBinaryBasename(platform: InstallPlatform): string {
  switch (platform) {
    case 'darwin':
    case 'linux':
      return 'ropcode';
    case 'win32':
      return 'ropcode.exe';
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export function resolvePackagedCliBinaryPath(resourcesPath: string, platform: InstallPlatform): string {
  return path.join(resourcesPath, 'bin', getCliBinaryBasename(platform));
}

async function pickUnixShellProfile(env: InstallEnvironment): Promise<string | undefined> {
  const shell = process.env.SHELL ? path.basename(process.env.SHELL) : '';
  const candidates = shell === 'zsh'
    ? ['.zprofile', '.zshrc', '.profile', '.bash_profile', '.bashrc']
    : ['.bash_profile', '.bashrc', '.profile', '.zprofile', '.zshrc'];

  for (const candidate of candidates) {
    const profilePath = path.join(env.homeDir, candidate);
    if (await env.fileExists(profilePath)) {
      return profilePath;
    }
  }

  return path.join(env.homeDir, shell === 'zsh' ? '.zprofile' : '.profile');
}

async function resolvePreferredUnixInstallDir(env: InstallEnvironment): Promise<{ directory: string; needsPathUpdate: boolean; shellProfilePath?: string }> {
  const preferredDirs = [
    path.join(env.homeDir, '.local', 'bin'),
    path.join(env.homeDir, 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const pathEntries = splitPathEntries(env.pathValue, env.platform);

  for (const directory of preferredDirs) {
    if (await env.fileExists(directory)) {
      return {
        directory,
        needsPathUpdate: !pathEntries.includes(directory),
        shellProfilePath: pathEntries.includes(directory) ? undefined : await pickUnixShellProfile(env),
      };
    }
  }

  const fallbackDir = path.join(env.homeDir, '.local', 'bin');
  return {
    directory: fallbackDir,
    needsPathUpdate: true,
    shellProfilePath: await pickUnixShellProfile(env),
  };
}

export async function getInstallTarget(env: InstallEnvironment): Promise<InstallTarget> {
  switch (env.platform) {
    case 'darwin':
    case 'linux': {
      const cliName = getCliBinaryBasename(env.platform);
      const unixTarget = await resolvePreferredUnixInstallDir(env);
      return {
        kind: 'symlink',
        directory: unixTarget.directory,
        linkPath: path.join(unixTarget.directory, cliName),
        needsPathUpdate: unixTarget.needsPathUpdate,
        pathEntry: unixTarget.directory,
        shellProfilePath: unixTarget.shellProfilePath,
      };
    }
    case 'win32': {
      const directory = path.join(env.homeDir, 'AppData', 'Local', 'Programs', 'Ropcode', 'bin');
      return {
        kind: 'copy',
        directory,
        linkPath: path.join(directory, getCliBinaryBasename(env.platform)),
        needsPathUpdate: !splitPathEntries(env.pathValue, env.platform).includes(directory),
        pathEntry: directory,
      };
    }
    default:
      throw new Error(`Unsupported platform: ${env.platform}`);
  }
}

async function appendPathToShellProfile(env: InstallEnvironment, profilePath: string, pathEntry: string): Promise<boolean> {
  const existing = await env.readFile(profilePath).catch(() => '');
  const exportLine = `export PATH="${pathEntry}:$PATH"`;
  if (existing.includes(exportLine)) {
    return false;
  }

  const prefix = existing.length > 0 && !existing.endsWith('\n') ? `${existing}\n` : existing;
  const content = `${prefix}# Added by Ropcode CLI installer\n${exportLine}\n`;
  await env.writeFile(profilePath, content);
  return true;
}

async function replaceFile(env: InstallEnvironment, targetPath: string, write: () => Promise<void>): Promise<void> {
  await env.removeFile(targetPath).catch(() => {});
  await write();
}

export async function installCliToPath(env: InstallEnvironment): Promise<InstallResult> {
  const target = await getInstallTarget(env);
  await env.mkdir(target.directory);

  if (target.kind === 'symlink') {
    await replaceFile(env, target.linkPath, async () => {
      await env.symlink(env.cliBinaryPath, target.linkPath);
    });
  } else {
    await replaceFile(env, target.linkPath, async () => {
      await env.copyFile(env.cliBinaryPath, target.linkPath);
    });
  }

  await env.chmod(target.linkPath, 0o755).catch(() => {});

  let pathUpdated = false;
  if (env.platform === 'win32' && target.needsPathUpdate) {
    await env.setUserPath(ensurePathContains(env.pathValue, target.pathEntry, env.platform));
    pathUpdated = true;
  } else if ((env.platform === 'darwin' || env.platform === 'linux') && target.needsPathUpdate && target.shellProfilePath) {
    pathUpdated = await appendPathToShellProfile(env, target.shellProfilePath, target.pathEntry);
  }

  return {
    linkPath: target.linkPath,
    pathUpdated,
    shellProfilePath: target.shellProfilePath,
  };
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function setWindowsUserPath(pathValue: string): Promise<void> {
  await execFile('setx', ['PATH', pathValue]);
}

export function createInstallEnvironment(cliBinaryPath: string): InstallEnvironment {
  return {
    platform: process.platform,
    homeDir: os.homedir(),
    pathValue: process.env.PATH ?? '',
    cliBinaryPath,
    fileExists: pathExists,
    mkdir: async (dir: string) => {
      await fs.mkdir(dir, { recursive: true });
    },
    symlink: async (target: string, linkPath: string) => {
      await fs.symlink(target, linkPath);
    },
    writeFile: (filePath: string, content: string) => fs.writeFile(filePath, content, 'utf8'),
    readFile: (filePath: string) => fs.readFile(filePath, 'utf8'),
    chmod: (filePath: string, mode: number) => fs.chmod(filePath, mode),
    copyFile: (src: string, dst: string) => fs.copyFile(src, dst),
    removeFile: (filePath: string) => fs.rm(filePath, { force: true }),
    setUserPath: setWindowsUserPath,
  };
}
