import { expect, test } from '@playwright/test';

const appUrl = process.env.ROPCODE_E2E_URL;
const serverPort = Number(process.env.ROPCODE_E2E_SERVER_PORT || 0);
const authKey = process.env.ROPCODE_E2E_AUTH_KEY || '';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('app_setting:startup_intro_enabled', 'false');
  });
});

test('Ropcode browser UI loads through Go server and navigates core panes', async ({ page }) => {
  test.skip(!appUrl || !serverPort || !authKey, 'ROPCODE_E2E_URL, ROPCODE_E2E_SERVER_PORT, and ROPCODE_E2E_AUTH_KEY are required');

  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });

  await expect.poll(async () => page.evaluate(() => window.__ROPCODE_WS_PORT__)).toBe(serverPort);
  await expect.poll(async () => page.evaluate(() => window.__ROPCODE_AUTH_KEY__)).toBe(authKey);

  const rpcResult = await page.evaluate(async ({ port, key }) => {
    return await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?authKey=${encodeURIComponent(key)}`);
      const timer = setTimeout(() => resolve({ ok: false, error: 'rpc timeout' }), 15_000);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          kind: 'rpc_request',
          request: {
            id: `browser-smoke-${Date.now()}`,
            method: 'ListProjects',
            params: [],
          },
        }));
      });

      ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.kind !== 'rpc_response') return;
        clearTimeout(timer);
        ws.close();
        resolve({
          ok: !message.response?.error,
          error: message.response?.error || '',
          count: Array.isArray(message.response?.result) ? message.response.result.length : null,
        });
      });

      ws.addEventListener('error', () => {
        clearTimeout(timer);
        resolve({ ok: false, error: 'websocket error' });
      });
    });
  }, { port: serverPort, key: authKey });

  expect(rpcResult).toMatchObject({ ok: true });

  await expect(page.getByRole('button', { name: 'Projects', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agents', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Settings' })).toBeVisible();

  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agent Packs', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Agent' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Create Agent' }).first().click();
  await expect(page.getByRole('heading', { name: 'Create Agent', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Agent', exact: true })).toBeVisible();
  await page.locator('button[title="Back to Agents"]').click();
  await expect(page.getByRole('heading', { name: 'Agent Packs', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add project' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3_000);

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
