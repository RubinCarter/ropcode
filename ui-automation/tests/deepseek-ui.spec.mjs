import { expect, test } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appUrl = process.env.ROPCODE_E2E_URL;
const serverPort = Number(process.env.ROPCODE_E2E_SERVER_PORT || 0);
const authKey = process.env.ROPCODE_E2E_AUTH_KEY || '';
const fixtureRoot = process.env.ROPCODE_E2E_DEEPSEEK_PROJECT
  || path.resolve('artifacts', 'deepseek-ui-hi-fixture');

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('app_setting:startup_intro_enabled', 'false');
  });
});

function rpc(method, ...params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?authKey=${encodeURIComponent(authKey)}`);
    const timer = setTimeout(() => reject(new Error(`${method} timeout`)), 15_000);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        kind: 'rpc_request',
        request: {
          id: `deepseek-ui-${method}-${Date.now()}`,
          method,
          params,
        },
      }));
    });

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.kind !== 'rpc_response') return;
      clearTimeout(timer);
      ws.close();
      if (message.response?.error) {
        reject(new Error(message.response.error));
      } else {
        resolve(message.response?.result);
      }
    });

    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`${method} websocket error`));
    });
  });
}

test('DeepSeek UI responds to hi through Ropcode provider path', async ({ page }) => {
  test.skip(!appUrl || !serverPort || !authKey, 'ROPCODE_E2E_URL, ROPCODE_E2E_SERVER_PORT, and ROPCODE_E2E_AUTH_KEY are required');
  test.skip(process.env.ROPCODE_E2E_DEEPSEEK_FAKE !== '1', 'requires fake DeepSeek shim test environment');

  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(path.join(fixtureRoot, 'README.md'), '# DeepSeek UI hi fixture\n', 'utf8');

  await rpc('CreateProviderApiConfig', {
    id: '',
    name: 'DeepSeek UI Test',
    provider_id: 'deepseek',
    base_url: 'https://deepseek.ui.test/v1',
    auth_token: 'ui-token',
    is_default: true,
    is_builtin: false,
  });
  await rpc('AddProjectToIndex', fixtureRoot);

  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => page.evaluate(() => window.__ROPCODE_WS_PORT__)).toBe(serverPort);
  await expect.poll(async () => page.evaluate(() => window.__ROPCODE_AUTH_KEY__)).toBe(authKey);

  await page.getByRole('button', { name: 'Projects' }).click();
  const projectButton = page.getByRole('button', { name: 'deepseek-ui-hi-fixture', exact: true });
  await expect(projectButton).toBeVisible();
  await projectButton.click();

  await page.evaluate((spacePath) => {
    window.dispatchEvent(new CustomEvent('open-new-session', { detail: { spacePath } }));
  }, fixtureRoot);

  const claudePrompt = page.getByPlaceholder('@ for files/agents, / for Claude capabilities...').last();
  await expect(claudePrompt).toBeVisible();

  const selectorToggle = page.locator('button').filter({
    has: page.locator('svg.lucide-sliders-horizontal'),
  }).last();
  await expect(selectorToggle).toBeVisible();
  await selectorToggle.click();

  await page.getByRole('button', { name: 'Claude C' }).last().click();
  await page.getByText('DeepSeek', { exact: true }).click();
  const deepseekPrompt = page.getByPlaceholder('@ for files/agents, / for commands, : for skills...').last();
  await expect(deepseekPrompt).toBeVisible();

  await deepseekPrompt.fill('hi');
  await page.locator('button').filter({ has: page.locator('svg.lucide-send') }).last().click();

  await expect(page.getByText('hi', { exact: true }).last()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('body')).toContainText('DeepSeek · Deepseek V4 Pro · Auto');

  await page.screenshot({ path: path.resolve('artifacts', 'deepseek-ui-hi.png'), fullPage: false });
  await writeFile(path.resolve('artifacts', 'deepseek-ui-hi.txt'), await page.locator('body').innerText(), 'utf8');
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
