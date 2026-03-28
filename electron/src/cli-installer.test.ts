import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  ensurePathContains,
  getCliBinaryBasename,
  getInstallTarget,
  installCliToPath,
  resolvePackagedCliBinaryPath,
} from './cli-installer';

import type { InstallEnvironment, InstallPlatform } from './cli-installer';

function createEnv(overrides: Partial<InstallEnvironment> = {}): InstallEnvironment {
  return {
    platform: 'darwin',
    homeDir: '/Users/tester',
    pathValue: '/usr/local/bin:/usr/bin',
    cliBinaryPath: '/Applications/Ropcode.app/Contents/Resources/bin/ropcode',
    fileExists: async () => true,
    mkdir: async () => {},
    symlink: async () => {},
    writeFile: async () => {},
    readFile: async () => '',
    chmod: async () => {},
    copyFile: async () => {},
    removeFile: async () => {},
    setUserPath: async () => {},
    ...overrides,
  };
}

test('resolvePackagedCliBinaryPath returns platform-specific packaged path', () => {
  assert.equal(
    resolvePackagedCliBinaryPath('/Resources', 'darwin'),
    path.join('/Resources', 'bin', 'ropcode'),
  );
  assert.equal(
    resolvePackagedCliBinaryPath('/resources', 'linux'),
    path.join('/resources', 'bin', 'ropcode'),
  );
  assert.equal(
    resolvePackagedCliBinaryPath('C:\\Resources', 'win32'),
    path.join('C:\\Resources', 'bin', 'ropcode.exe'),
  );
});

test('getCliBinaryBasename returns executable name per platform', () => {
  assert.equal(getCliBinaryBasename('darwin'), 'ropcode');
  assert.equal(getCliBinaryBasename('linux'), 'ropcode');
  assert.equal(getCliBinaryBasename('win32'), 'ropcode.exe');
});

test('ensurePathContains appends missing entry once', () => {
  assert.equal(ensurePathContains('/usr/local/bin:/usr/bin', '/Users/tester/.local/bin'), '/usr/local/bin:/usr/bin:/Users/tester/.local/bin');
  assert.equal(ensurePathContains('/usr/local/bin:/Users/tester/.local/bin', '/Users/tester/.local/bin'), '/usr/local/bin:/Users/tester/.local/bin');
  assert.equal(ensurePathContains('C:\\Windows\\System32', 'C:\\Users\\tester\\bin', 'win32'), 'C:\\Windows\\System32;C:\\Users\\tester\\bin');
});

test('getInstallTarget prefers existing PATH directory on darwin', async () => {
  const target = await getInstallTarget(createEnv({
    platform: 'darwin',
    pathValue: '/opt/homebrew/bin:/usr/bin',
    fileExists: async (candidate: string) => candidate === '/opt/homebrew/bin',
  }));

  assert.equal(target.kind, 'symlink');
  assert.equal(target.directory, '/opt/homebrew/bin');
  assert.equal(target.linkPath, '/opt/homebrew/bin/ropcode');
  assert.equal(target.needsPathUpdate, false);
  assert.equal(target.pathEntry, '/opt/homebrew/bin');
  assert.equal(target.shellProfilePath, undefined);
});

test('getInstallTarget uses fixed unix install priority instead of PATH order', async () => {
  const target = await getInstallTarget(createEnv({
    platform: 'darwin',
    homeDir: '/Users/tester',
    pathValue: '/Users/tester/.antigravity/antigravity/bin:/opt/homebrew/bin:/Users/tester/.local/bin:/usr/local/bin:/usr/bin',
    fileExists: async (candidate: string) => candidate === '/Users/tester/.local/bin' || candidate === '/Users/tester/.antigravity/antigravity/bin' || candidate === '/opt/homebrew/bin' || candidate === '/usr/local/bin',
  }));

  assert.equal(target.kind, 'symlink');
  assert.equal(target.directory, '/Users/tester/.local/bin');
  assert.equal(target.linkPath, '/Users/tester/.local/bin/ropcode');
  assert.equal(target.needsPathUpdate, false);
  assert.equal(target.pathEntry, '/Users/tester/.local/bin');
  assert.equal(target.shellProfilePath, undefined);
});



test('getInstallTarget uses user local app data on windows', async () => {
  const target = await getInstallTarget(createEnv({
    platform: 'win32',
    homeDir: 'C:\\Users\\tester',
    pathValue: 'C:\\Windows\\System32',
  }));

  assert.equal(target.kind, 'copy');
  assert.equal(target.directory, path.join('C:\\Users\\tester', 'AppData', 'Local', 'Programs', 'Ropcode', 'bin'));
  assert.equal(target.linkPath, path.join('C:\\Users\\tester', 'AppData', 'Local', 'Programs', 'Ropcode', 'bin', 'ropcode.exe'));
  assert.equal(target.needsPathUpdate, true);
  assert.equal(target.pathEntry, path.join('C:\\Users\\tester', 'AppData', 'Local', 'Programs', 'Ropcode', 'bin'));
  assert.equal(target.shellProfilePath, undefined);
});

test('installCliToPath creates symlink and shell profile export on unix fallback', async () => {
  const calls: string[] = [];
  let profileContents = '# existing\n';
  const env = createEnv({
    platform: 'linux',
    homeDir: '/home/tester',
    pathValue: '/usr/bin:/bin',
    fileExists: async (candidate: string) => candidate === '/home/tester/.bashrc',
    mkdir: async (dir: string) => {
      calls.push(`mkdir:${dir}`);
    },
    symlink: async (target: string, linkPath: string) => {
      calls.push(`symlink:${target}->${linkPath}`);
    },
    writeFile: async (filePath: string, content: string) => {
      calls.push(`write:${filePath}`);
      profileContents = content;
    },
    readFile: async () => profileContents,
  });

  const result = await installCliToPath(env);

  assert.equal(result.linkPath, '/home/tester/.local/bin/ropcode');
  assert.equal(result.pathUpdated, true);
  assert.match(profileContents, /# Added by Ropcode CLI installer/);
  assert.match(profileContents, /export PATH="\/home\/tester\/\.local\/bin:\$PATH"/);
  assert.deepEqual(calls, [
    'mkdir:/home/tester/.local/bin',
    'symlink:/Applications/Ropcode.app/Contents/Resources/bin/ropcode->/home/tester/.local/bin/ropcode',
    'write:/home/tester/.bashrc',
  ]);
});

test('installCliToPath updates user PATH on windows and copies the cli binary', async () => {
  const calls: string[] = [];
  let updatedPath = '';
  const installDir = path.join('C:\\Users\\tester', 'AppData', 'Local', 'Programs', 'Ropcode', 'bin');
  const exePath = path.join(installDir, 'ropcode.exe');
  const env = createEnv({
    platform: 'win32',
    homeDir: 'C:\\Users\\tester',
    pathValue: 'C:\\Windows\\System32',
    cliBinaryPath: 'C:\\Program Files\\Ropcode\\resources\\bin\\ropcode.exe',
    mkdir: async (dir: string) => {
      calls.push(`mkdir:${dir}`);
    },
    copyFile: async (src: string, dst: string) => {
      calls.push(`copy:${src}->${dst}`);
    },
    setUserPath: async (value: string) => {
      calls.push('setUserPath');
      updatedPath = value;
    },
  });

  const result = await installCliToPath(env);

  assert.equal(result.linkPath, exePath);
  assert.equal(result.pathUpdated, true);
  assert.equal(updatedPath, `C:\\Windows\\System32;${installDir}`);
  assert.deepEqual(calls, [
    `mkdir:${installDir}`,
    `copy:C:\\Program Files\\Ropcode\\resources\\bin\\ropcode.exe->${exePath}`,
    'setUserPath',
  ]);
});

test('installCliToPath rejects unsupported platforms', async () => {
  await assert.rejects(() => installCliToPath(createEnv({ platform: 'freebsd' as InstallPlatform })), /Unsupported platform/);
});
