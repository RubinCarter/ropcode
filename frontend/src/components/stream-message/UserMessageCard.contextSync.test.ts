import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('UserMessageCard renders array project chat context sync with visible text only', () => {
  const source = readFileSync(join(__dirname, 'UserMessageCard.tsx'), 'utf8');

  assert.match(source, /content\.type === "text"[\s\S]*isContextSync[\s\S]*visibleUserMessageText\(message as any\)/);
  assert.match(source, /isContextSync[\s\S]*userPresentation[\s\S]*getUserMessagePresentation/);
  assert.match(source, /projectchat-context-sync-\$\{\(message as any\)\.session_id \|\| 'unknown'\}/);
});
