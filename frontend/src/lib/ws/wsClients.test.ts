import test from 'node:test';
import assert from 'node:assert/strict';
import { getRpcWebSocketUrl } from './rpcClient';
import { getSessionStreamWebSocketUrl } from './sessionStreamClient';
import { getBulkStreamWebSocketUrl } from './bulkStreamClient';
import { getSyncWebSocketUrl } from './syncClient';
import { createReloadCircuitBreaker } from './reloadCircuitBreaker';

const locationLike = {
  hostname: 'localhost',
  search: '',
  port: '5173',
} as Location;

test('ws clients build split channel urls with auth keys', () => {
  assert.equal(getRpcWebSocketUrl(5173, 'key', locationLike), 'ws://localhost:5173/ws/rpc?authKey=key');
  assert.equal(getSyncWebSocketUrl(5173, 'key', locationLike), 'ws://localhost:5173/ws/sync?authKey=key');
  assert.equal(
    getSessionStreamWebSocketUrl(5173, 'key', 'runtime/session 1', locationLike),
    'ws://localhost:5173/ws/stream/session/runtime%2Fsession%201?authKey=key',
  );
  assert.equal(
    getBulkStreamWebSocketUrl(5173, 'key', 'pty', 'term/1', locationLike),
    'ws://localhost:5173/ws/stream/bulk/pty/term%2F1?authKey=key',
  );
});

test('reload circuit breaker opens after repeated failures and resets on success', () => {
  const breaker = createReloadCircuitBreaker({ maxFailures: 2, windowMs: 1000 });

  assert.equal(breaker.recordFailure(0), false);
  assert.equal(breaker.recordFailure(10), true);
  assert.equal(breaker.isOpen(20), true);

  breaker.recordSuccess();
  assert.equal(breaker.isOpen(30), false);
});
