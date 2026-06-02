import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = await readFile(new URL('./useEventSubscription.ts', import.meta.url), 'utf8');

test('event subscription cleanup removes only its own wrapped handler', () => {
  assert.match(source, /const wrappedHandler = \(event: T\) => \{/);
  assert.match(source, /EventsOn\(eventName, wrappedHandler\);/);
  assert.match(source, /EventsOff\(eventName, wrappedHandler\);/);
  assert.doesNotMatch(source, /EventsOff\(eventName\);/);
});

test('process changed events expose provider and session identity', () => {
  assert.match(source, /provider_id\?: string;/);
  assert.match(source, /session_id\?: string;/);
});

test('session changed provider stays provider-agnostic', () => {
  assert.match(source, /provider: string;/);
  assert.doesNotMatch(source, /provider: 'claude' \| 'gemini' \| 'codex';/);
});

void fileURLToPath;
