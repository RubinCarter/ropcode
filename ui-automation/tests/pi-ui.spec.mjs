import { expect, test } from '@playwright/test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appUrl = process.env.ROPCODE_E2E_URL;
const serverPort = Number(process.env.ROPCODE_E2E_SERVER_PORT || 0);
const authKey = process.env.ROPCODE_E2E_AUTH_KEY || '';
const fixtureRoot = process.env.ROPCODE_E2E_PI_PROJECT
  || path.resolve('artifacts', 'pi-ui-hi-fixture');
const piLogPath = process.env.ROPCODE_E2E_PI_LOG || path.resolve('artifacts', 'fake-pi-commands.jsonl');

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
          id: `pi-ui-${method}-${Date.now()}`,
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

async function piLogLines() {
  const text = await readFile(piLogPath, 'utf8').catch(() => '');
  return text.split(/\r?\n/).filter(Boolean);
}

test('Pi UI responds to prompts through one long-lived provider process', async ({ page }) => {
  test.skip(!appUrl || !serverPort || !authKey, 'ROPCODE_E2E_URL, ROPCODE_E2E_SERVER_PORT, and ROPCODE_E2E_AUTH_KEY are required');
  test.skip(process.env.ROPCODE_E2E_PI_FAKE !== '1', 'requires fake Pi shim test environment');

  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(path.join(fixtureRoot, 'README.md'), '# Pi UI hi fixture\n', 'utf8');

  await rpc('CreateProviderApiConfig', {
    id: '',
    name: 'Pi UI Test',
    provider_id: 'pi',
    base_url: '',
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
  const projectButton = page.getByRole('button', { name: 'pi-ui-hi-fixture', exact: true });
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

  await page.getByRole('button', { name: 'Claude C' }).first().click();
  await page.getByText('Pi', { exact: true }).click();

  const piPrompt = page.getByPlaceholder('@ for files/agents, / for commands, : for skills...').last();
  await expect(piPrompt).toBeVisible();
  await piPrompt.fill('hi');
  await page.locator('button').filter({ has: page.locator('svg.lucide-send') }).last().click();

  await expect(page.getByText('hi', { exact: true }).last()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('body')).toContainText('Pi fake response');
  await expect(page.locator('body')).toContainText('Pi · Anthropic/Claude Sonnet 4');

  await piPrompt.fill('again');
  await page.locator('button').filter({ has: page.locator('svg.lucide-send') }).last().click();

  await expect.poll(async () => {
    const lines = await piLogLines();
    return lines.filter((line) => line.includes('"type":"prompt"')).length;
  }).toBe(2);
  await expect.poll(async () => {
    const lines = await piLogLines();
    return lines.filter((line) => line.includes('"type":"fake_start"')).length;
  }).toBe(1);

  await page.screenshot({ path: path.resolve('artifacts', 'pi-ui-hi.png'), fullPage: false });
  await writeFile(path.resolve('artifacts', 'pi-ui-hi.txt'), await page.locator('body').innerText(), 'utf8');
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
