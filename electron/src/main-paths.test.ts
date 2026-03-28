import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { resolveDevCliBinaryPath } from './main-paths';

test('resolveDevCliBinaryPath returns arch-specific bin CLI path on darwin arm64', () => {
  const resolved = resolveDevCliBinaryPath('/repo/electron/dist', 'darwin', 'arm64');
  assert.equal(resolved, path.join('/repo', 'bin', 'darwin', 'arm64', 'ropcode'));
});

test('resolveDevCliBinaryPath returns arch-specific bin CLI path on darwin x64', () => {
  const resolved = resolveDevCliBinaryPath('/repo/electron/dist', 'darwin', 'x64');
  assert.equal(resolved, path.join('/repo', 'bin', 'darwin', 'x64', 'ropcode'));
});

test('resolveDevCliBinaryPath returns arch-specific bin CLI path on linux x64', () => {
  const resolved = resolveDevCliBinaryPath('/repo/electron/dist', 'linux', 'x64');
  assert.equal(resolved, path.join('/repo', 'bin', 'linux', 'x64', 'ropcode'));
});

test('resolveDevCliBinaryPath returns arch-specific bin CLI path on win32 x64', () => {
  const resolved = resolveDevCliBinaryPath('/repo/electron/dist', 'win32', 'x64');
  assert.equal(resolved, path.join('/repo', 'bin', 'win32', 'x64', 'ropcode.exe'));
});
