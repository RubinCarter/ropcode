import test from 'node:test';
import assert from 'node:assert/strict';
import { clearBulkFrames, getBulkText } from '@/stores/bulkStore';
import { connectBulkStream } from './bulkStreamClient';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent | Event) => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3;
  }
}

test('bulk stream client can bypass the global bulk store for command sinks', () => {
  clearBulkFrames('pty', 'direct-term');
  MockWebSocket.instances = [];
  const received: string[] = [];
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = {
    location: {
      protocol: 'http:',
      hostname: 'localhost',
      host: 'localhost:5173',
    },
  };

  try {
    connectBulkStream(5173, 'auth', 'pty', 'direct-term', {
      appendToStore: false,
      WebSocketCtor: MockWebSocket as unknown as typeof WebSocket,
      onFrame: (frame) => received.push(frame.data ?? ''),
    });

    const ws = MockWebSocket.instances[0];
    ws.onmessage?.({
      data: JSON.stringify({ source: 'pty', id: 'direct-term', seq: 1, data: 'direct' }),
    });

    assert.deepEqual(received, ['direct']);
    assert.equal(getBulkText('pty', 'direct-term'), '');
  } finally {
    (globalThis as any).window = originalWindow;
  }
});
