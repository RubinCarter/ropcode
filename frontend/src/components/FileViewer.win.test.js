import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fileViewerPath = path.resolve(currentDir, './FileViewer.tsx');
const customTitlebarPath = path.resolve(currentDir, './CustomTitlebar.tsx');
const platformPath = path.resolve(currentDir, '../lib/platform.ts');
const platformWinPath = path.resolve(currentDir, '../lib/platformWin.ts');
const diffPathPath = path.resolve(currentDir, '../lib/diffPath.ts');
const diffPathWinPath = path.resolve(currentDir, '../lib/diffPathWin.ts');
const pathUtilsPath = path.resolve(currentDir, '../lib/pathUtils.ts');
const pathUtilsWinPath = path.resolve(currentDir, '../lib/pathUtilsWin.ts');
const viteConfigPath = path.resolve(currentDir, '../../vite.config.ts');

async function readSource(filePath) {
  return readFile(filePath, 'utf8');
}

test('FileViewer uses cross-platform file RPCs instead of Unix shell commands', async () => {
  const source = await readSource(fileViewerPath);

  assert.match(source, /api\.getFileMetadata\(/);
  assert.match(source, /api\.readFile\(/);
  assert.doesNotMatch(source, /wc -c/);
  assert.doesNotMatch(source, /test -w/);
  assert.doesNotMatch(source, /file --mime-type/);
  assert.doesNotMatch(source, /cat "\$\{filePath\}"/);
});

test('DiffViewer uses cross-platform file RPCs for working tree content', async () => {
  const diffViewerPath = path.resolve(currentDir, './right-sidebar/DiffViewer.tsx');
  const source = await readSource(diffViewerPath);

  assert.match(source, /from '@\/lib\/diffPath'/);
  assert.match(source, /api\.getFileMetadata\(/);
  assert.match(source, /api\.readFile\(/);
  assert.match(source, /api\.readGitFileAtHead\(/);
  assert.doesNotMatch(source, /wc -c/);
  assert.doesNotMatch(source, /file --mime/);
  assert.doesNotMatch(source, /cat "\$\{filePath\}"/);
  assert.doesNotMatch(source, /api\.executeCommand\(/);
  assert.doesNotMatch(source, /git show HEAD:"\$\{filePath\}"/);
});

test('deleted diffs read HEAD without statting the missing working-tree file', async () => {
  const diffViewerSource = await readSource(path.resolve(currentDir, './right-sidebar/DiffViewer.tsx'));
  const rightSidebarSource = await readSource(path.resolve(currentDir, './right-sidebar/index.tsx'));
  const workspaceContainerSource = await readSource(path.resolve(currentDir, '../components/containers/WorkspaceContainer.tsx'));

  assert.match(rightSidebarSource, /createDiffTab\(file\.path, currentProjectPath, file\.status\)/);
  assert.match(workspaceContainerSource, /gitStatus=\{tab\.gitStatus\}/);
  assert.match(diffViewerSource, /gitStatus === 'deleted'/);
  assert.match(diffViewerSource, /api\.readGitFileAtHead\(workspacePath, gitPath\)/);
  assert.match(diffViewerSource, /setNewContent\(''\)/);
  assert.match(diffViewerSource, /api\.getFileMetadata\(absolutePath\)/);
  assert.ok(
    diffViewerSource.indexOf("gitStatus === 'deleted'") < diffViewerSource.indexOf('api.getFileMetadata(absolutePath)'),
    'deleted-file branch must run before working-tree metadata lookup'
  );
});

test('Diff path handling is split into default and Windows platform modules', async () => {
  const diffViewerPath = path.resolve(currentDir, './right-sidebar/DiffViewer.tsx');
  const diffViewerSource = await readSource(diffViewerPath);
  const defaultSource = await readSource(diffPathPath);
  const winSource = await readSource(diffPathWinPath);
  const viteConfigSource = await readSource(viteConfigPath);

  assert.match(diffViewerSource, /import \{ getDiffFilePaths \} from '@\/lib\/diffPath'/);
  assert.doesNotMatch(diffViewerSource, /const isAbsolutePath/);
  assert.doesNotMatch(diffViewerSource, /const normalizePathSeparators/);
  assert.match(defaultSource, /export function getDiffFilePaths/);
  assert.match(winSource, /export function getDiffFilePaths/);
  assert.match(winSource, /\[a-zA-Z\]:/);
  assert.doesNotMatch(defaultSource, /\[a-zA-Z\]:/);
  assert.match(viteConfigSource, /diffPathModule/);
  assert.match(viteConfigSource, /'@\/lib\/diffPath': diffPathModule/);
});

test('CustomTitlebar delegates platform differences to platform modules', async () => {
  const source = await readSource(customTitlebarPath);
  const platformSource = await readSource(platformPath);
  const platformWinSource = await readSource(platformWinPath);
  const viteConfigSource = await readSource(viteConfigPath);

  assert.match(source, /import \{ hasNativeWindowControls \} from '@\/lib\/platform'/);
  assert.match(source, /!hasNativeWindowControls\(\)/);
  assert.doesNotMatch(source, /navigator\.platform/);
  assert.doesNotMatch(source, /!isFullscreen && !isElectron &&/);
  assert.match(platformSource, /navigator\.platform/);
  assert.match(platformWinSource, /return false;/);
  assert.doesNotMatch(platformSource, /win32|windows/i);
  assert.match(viteConfigSource, /'@\/lib\/platform': platformModule/);
  assert.match(viteConfigSource, /process\.platform === 'win32'/);
  assert.match(viteConfigSource, /platformWin\.ts/);
});

test('frontend components delegate platform shortcuts and path handling', async () => {
  const rightSidebarSource = await readSource(path.resolve(currentDir, './right-sidebar/index.tsx'));
  const webViewerSource = await readSource(path.resolve(currentDir, './WebViewer.tsx'));
  const projectListSource = await readSource(path.resolve(currentDir, './ProjectList.tsx'));
  const pathUtilsSource = await readSource(pathUtilsPath);
  const pathUtilsWinSource = await readSource(pathUtilsWinPath);
  const viteConfigSource = await readSource(viteConfigPath);

  assert.match(rightSidebarSource, /from '@\/lib\/platform'/);
  assert.doesNotMatch(rightSidebarSource, /navigator\.platform/);
  assert.match(webViewerSource, /from '@\/lib\/pathUtils'/);
  assert.doesNotMatch(webViewerSource, /\[a-zA-Z\]:/);
  assert.doesNotMatch(webViewerSource, /workspacePath\.includes\('\\\\\\\\'\)/);
  assert.match(projectListSource, /from "@\/lib\/pathUtils"/);
  assert.doesNotMatch(projectListSource, /replace\(\/\\\\\\\\\/g, '\/'\)/);
  assert.match(pathUtilsSource, /export function basename/);
  assert.match(pathUtilsSource, /export function joinPath/);
  assert.match(pathUtilsSource, /export function resolveWorkspacePath/);
  assert.match(pathUtilsWinSource, /export function basename/);
  assert.match(pathUtilsWinSource, /export function resolveWorkspacePath/);
  assert.match(pathUtilsWinSource, /\[a-zA-Z\]:/);
  assert.match(viteConfigSource, /pathUtilsModule/);
  assert.match(viteConfigSource, /'@\/lib\/pathUtils': pathUtilsModule/);
});
