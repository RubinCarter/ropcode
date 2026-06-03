import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const worktreeHelperPath = path.resolve(currentDir, './worktreeHelper.ts');

async function readSource() {
  return readFile(worktreeHelperPath, 'utf8');
}

test('worktree prompt allows reading outside the workspace and gates writes', async () => {
  const source = await readSource();

  assert.doesNotMatch(source, /Do NOT read or write files outside the workspace directory/);
  assert.doesNotMatch(source, /EVERY absolute path you use should start with/);
  assert.match(source, /You may read files outside \$\{worktreeInfo\.current_path\} when needed for context/);
  assert.match(
    source,
    /Project file changes must stay inside the workspace directory unless the user explicitly asks you to modify files elsewhere and the tool policy allows it/
  );
  assert.match(
    source,
    /Do NOT write files outside \$\{worktreeInfo\.current_path\} or at \$\{worktreeInfo\.root_path\} unless the user explicitly allows that specific write/
  );
});
