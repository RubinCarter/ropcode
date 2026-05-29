import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

test('WorkspaceContainer does not clear ProjectChat frames when switching providers', async () => {
  const source = await fs.readFile(path.resolve(currentDir, './WorkspaceContainer.tsx'), 'utf8');

  assert.doesNotMatch(source, /clearSessionFrames\(tab\.projectChatId\)/);
});
