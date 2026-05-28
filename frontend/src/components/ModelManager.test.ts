import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const modelManagerPath = path.resolve(currentDir, './ModelManager.tsx');

test('ModelManager allows Pi model sync through the Pi CLI backend path', async () => {
  const source = await readFile(modelManagerPath, 'utf8');

  assert.match(source, /\{ id: "pi", name: "Pi" \}/);
  assert.match(source, /provider\.id === "codex" \|\| provider\.id === "claude" \|\| provider\.id === "pi"/);
});
