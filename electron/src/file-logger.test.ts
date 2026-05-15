import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { createTimestampedLogPath } from './file-logger';

test('createTimestampedLogPath writes into ropcode logs with timestamped name', () => {
  const resolved = createTimestampedLogPath(
    'ropcode-renderer',
    new Date('2026-05-15T04:05:06.789Z'),
    'C:\\Users\\tester',
  );

  assert.equal(
    resolved,
    path.join('C:\\Users\\tester', '.ropcode', 'logs', 'ropcode-renderer-20260515-040506-789.log'),
  );
});
