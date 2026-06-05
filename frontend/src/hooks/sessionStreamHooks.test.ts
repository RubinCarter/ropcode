import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { useBulkStream } from './useBulkStream';
import { useSessionMessages } from './useSessionMessages';
import { useSessionRuntime } from './useSessionRuntime';
import { useSessionStream } from './useSessionStream';
import { useSyncEvents } from './useSyncEvents';

void useBulkStream;
void useSessionMessages;
void useSessionRuntime;
void useSessionStream;
void useSyncEvents;

test('session stream hooks are thin useSyncExternalStore adapters', async () => {
  const streamSource = await readFile(new URL('./useSessionStream.ts', import.meta.url), 'utf8');
  const messagesSource = await readFile(new URL('./useSessionMessages.ts', import.meta.url), 'utf8');
  const runtimeSource = await readFile(new URL('./useSessionRuntime.ts', import.meta.url), 'utf8');

  assert.match(streamSource, /connectSessionStream/);
  assert.doesNotMatch(streamSource, /useState<.*SessionFrame/s);
  assert.match(streamSource, /reconnectDelayMs/);
  assert.match(streamSource, /scheduleReconnect\(\);/);
  assert.match(messagesSource, /useSyncExternalStore/);
  assert.match(messagesSource, /getSessionMessages/);
  assert.match(runtimeSource, /useSyncExternalStore/);
  assert.match(runtimeSource, /getSessionRuntime/);
});

test('bulk and sync hooks read from external stores', async () => {
  const bulkSource = await readFile(new URL('./useBulkStream.ts', import.meta.url), 'utf8');
  const syncSource = await readFile(new URL('./useSyncEvents.ts', import.meta.url), 'utf8');

  assert.match(bulkSource, /connectBulkStream/);
  assert.match(bulkSource, /useSyncExternalStore/);
  assert.match(bulkSource, /getBulkText/);
  assert.match(syncSource, /connectSyncStream/);
  assert.match(syncSource, /useSyncExternalStore/);
  assert.match(syncSource, /getSyncEvents/);
});
