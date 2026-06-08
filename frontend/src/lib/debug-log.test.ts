import test from 'node:test';
import assert from 'node:assert/strict';

test('debug log writes to the desktop renderer log bridge by default', async () => {
  const writes: unknown[][] = [];
  const previousWindow = (globalThis as any).window;

  (globalThis as any).window = {
    electronAPI: {
      writeRendererLog: (...args: unknown[]) => {
        writes.push(args);
      },
    },
    addEventListener: () => undefined,
  };

  try {
    const moduleUrl = new URL(`./debug-log.ts?default-bridge-${Date.now()}`, import.meta.url).href;
    const { debugLog } = await import(moduleUrl);

    debugLog.log('settings-opened');

    assert.equal(debugLog.getEntries().length, 1);
    assert.deepEqual(writes, [['log', 'renderer-debug-log', ['settings-opened']]]);
  } finally {
    (globalThis as any).window = previousWindow;
  }
});

test('debug log does not require the desktop renderer log bridge', async () => {
  const previousWindow = (globalThis as any).window;

  (globalThis as any).window = {
    addEventListener: () => undefined,
  };

  try {
    const moduleUrl = new URL(`./debug-log.ts?missing-bridge-${Date.now()}`, import.meta.url).href;
    const { debugLog } = await import(moduleUrl);

    assert.doesNotThrow(() => debugLog.info('browser-preview-opened'));
    assert.equal(debugLog.getEntries().length, 1);
  } finally {
    (globalThis as any).window = previousWindow;
  }
});
