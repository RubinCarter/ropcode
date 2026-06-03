import test from 'node:test';
import assert from 'node:assert/strict';
import { appendBulkFrame, clearBulkFrames, getBulkText, subscribeBulk, subscribeBulkFrames } from './bulkStore';

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

test('bulkStore frame subscribers receive only incremental frames', () => {
  clearBulkFrames('pty', 'term-frames');

  const frames: string[] = [];
  const unsubscribe = subscribeBulkFrames('pty', 'term-frames', (frame) => {
    frames.push(frame.data ?? '');
  });

  appendBulkFrame({ source: 'pty', id: 'term-frames', seq: 1, data: 'a' });
  appendBulkFrame({ source: 'pty', id: 'term-other', seq: 1, data: 'ignored' });
  appendBulkFrame({ source: 'pty', id: 'term-frames', seq: 2, data: 'b' });
  unsubscribe();
  appendBulkFrame({ source: 'pty', id: 'term-frames', seq: 3, data: 'c' });

  assert.deepEqual(frames, ['a', 'b']);
  assert.equal(getBulkText('pty', 'term-frames'), 'abc');
});
