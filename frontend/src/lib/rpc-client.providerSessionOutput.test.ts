import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('rpc client exposes provider session output wrapper', () => {
  const source = readFileSync(join(__dirname, 'rpc-client.ts'), 'utf8');

  assert.match(source, /export function GetProviderSessionOutput\(sessionId: string \| number\): Promise<string>/);
  assert.match(source, /wsClient\.call\('GetProviderSessionOutput', String\(sessionId\)\)/);
});
