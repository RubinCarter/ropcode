import test from 'node:test';
import assert from 'node:assert/strict';
import { appendBulkFrame, clearBulkFrames, getBulkText, subscribeBulk } from './bulkStore';

test('bulkStore appends text by source and id in seq order', () => {
  clearBulkFrames('pty', 'term-1');

  appendBulkFrame({ source: 'pty', id: 'term-1', seq: 2, data: 'world' });
  appendBulkFrame({ source: 'pty', id: 'term-1', seq: 1, data: 'hello ' });
  appendBulkFrame({ source: 'agent', id: 'term-1', seq: 1, data: 'ignored' });

  assert.equal(getBulkText('pty', 'term-1'), 'hello world');
});

test('bulkStore notifies only matching stream subscribers', () => {
  clearBulkFrames('agent', 'run-1');

  let matching = 0;
  let other = 0;
  const unsubscribeMatching = subscribeBulk('agent', 'run-1', () => matching++);
  const unsubscribeOther = subscribeBulk('agent', 'run-2', () => other++);

  appendBulkFrame({ source: 'agent', id: 'run-1', seq: 1, data: 'chunk' });
  unsubscribeMatching();
  unsubscribeOther();

  assert.equal(matching, 1);
  assert.equal(other, 0);
});
