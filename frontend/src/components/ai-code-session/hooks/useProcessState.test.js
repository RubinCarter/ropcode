import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = await readFile(new URL('./useProcessState.ts', import.meta.url), 'utf8');

test('process state consumes provider-owned activity events', () => {
  assert.match(source, /useProviderActivityChanged/);
  assert.match(source, /type ProviderSessionActivityEvent/);
  assert.match(source, /const applyProviderActivity = useCallback/);
  assert.match(source, /setIsLoading\(active\);/);
});

test('pending sends ignore pre-turn idle activity events', () => {
  assert.match(source, /if \(isPendingSendRef\.current && running && !active\) \{/);
  assert.match(source, /return;/);
});

void fileURLToPath;
