import { expect, test } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appUrl = process.env.ROPCODE_E2E_URL;
const serverPort = Number(process.env.ROPCODE_E2E_SERVER_PORT || 0);
const authKey = process.env.ROPCODE_E2E_AUTH_KEY || '';
const artifactsDir = path.resolve('artifacts');
const fixtureRoot = path.resolve(artifactsDir, 'right-sidebar-fixture');

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('app_setting:startup_intro_enabled', 'false');
    localStorage.setItem('sidebar_panel_mode', 'sessions');
  });
});

test('right sidebar rail renders correctly and responds to semantic interactions', async ({ page }) => {
  test.skip(!appUrl || !serverPort || !authKey, 'ROPCODE_E2E_URL, ROPCODE_E2E_SERVER_PORT, and ROPCODE_E2E_AUTH_KEY are required');

  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
  await writeFile(path.join(fixtureRoot, 'README.md'), '# Right sidebar fixture\n', 'utf8');
  await writeFile(path.join(fixtureRoot, 'src', 'main.ts'), 'export const answer = 42;\n', 'utf8');

  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => page.evaluate(() => window.__ROPCODE_WS_PORT__)).toBe(serverPort);
  await expect.poll(async () => page.evaluate(() => window.__ROPCODE_AUTH_KEY__)).toBe(authKey);

  await page.evaluate(async ({ port, key, projectPath }) => {
    const call = (method, ...params) => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?authKey=${encodeURIComponent(key)}`);
      const timer = setTimeout(() => reject(new Error(`${method} timeout`)), 15_000);
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          kind: 'rpc_request',
          request: {
            id: `right-sidebar-${method}-${Date.now()}`,
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

    await call('AddProjectToIndex', projectPath);
  }, { port: serverPort, key: authKey, projectPath: fixtureRoot });

  await page.getByRole('button', { name: 'Projects' }).click();
  const fixtureProjectButton = page.getByRole('button', { name: 'right-sidebar-fixture', exact: true });
  await expect(fixtureProjectButton).toBeVisible();
  await fixtureProjectButton.click();
  await expect(page.getByText('Ready').first()).toBeVisible();
  await expect(page.getByText('Loading...')).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Console' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Files' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tasks' })).toBeVisible();

  const expandedPng = path.join(artifactsDir, 'right-sidebar-expanded.png');
  await page.screenshot({ path: expandedPng, fullPage: false });

  const expandedAria = await page.ariaSnapshot({ mode: 'ai', boxes: true, depth: 8 });
  const expandedAriaPath = path.join(artifactsDir, 'right-sidebar-expanded.aria.yml');
  await writeFile(expandedAriaPath, expandedAria, 'utf8');
  expect(expandedAria).not.toContain('button "Collapse right sidebar"');
  expect(expandedAria).not.toContain('button "Expand right sidebar"');
  expect(expandedAria).toContain('button "Console"');
  expect(expandedAria).toContain('button "Files"');
  expect(expandedAria).toContain('button "Tasks"');
  expect(expandedAria).toContain('Terminal 1');

  const expandedWidth = await page.locator('[tabindex="-1"]').filter({
    has: page.getByRole('button', { name: 'Console' }),
  }).last().evaluate((el) => el.getBoundingClientRect().width);
  expect(expandedWidth).toBeGreaterThan(250);

  await page.getByRole('button', { name: 'Files' }).click();
  await expect(page.getByText('Files').first()).toBeVisible();
  await expect(page.getByText('README.md')).toBeVisible();
  await expect(page.getByText('src')).toBeVisible();
  const filesAria = await page.ariaSnapshot({ mode: 'ai', boxes: true, depth: 8 });
  await writeFile(path.join(artifactsDir, 'right-sidebar-files.aria.yml'), filesAria, 'utf8');
  expect(filesAria).toContain('button "Files"');
  expect(filesAria).toContain('README.md');

  await page.getByRole('button', { name: 'Files' }).click();
  await expect(page.getByText('README.md')).toBeHidden();
  const collapsedPng = path.join(artifactsDir, 'right-sidebar-collapsed.png');
  await page.screenshot({ path: collapsedPng, fullPage: false });
  const collapsedAria = await page.ariaSnapshot({ mode: 'ai', boxes: true, depth: 8 });
  await writeFile(path.join(artifactsDir, 'right-sidebar-collapsed.aria.yml'), collapsedAria, 'utf8');
  expect(collapsedAria).not.toContain('button "Expand right sidebar"');
  expect(collapsedAria).not.toContain('button "Collapse right sidebar"');
  expect(collapsedAria).toContain('button "Console"');
  expect(collapsedAria).toContain('button "Files"');
  expect(collapsedAria).not.toContain('README.md');

  const collapsedWidth = await page.locator('[tabindex="-1"]').filter({
    has: page.getByRole('button', { name: 'Files' }),
  }).last().evaluate((el) => el.getBoundingClientRect().width);
  expect(collapsedWidth).toBeGreaterThanOrEqual(60);
  expect(collapsedWidth).toBeLessThanOrEqual(70);

  await page.getByRole('button', { name: 'Console' }).click();
  await expect.poll(async () => page.locator('[tabindex="-1"]').filter({
    has: page.getByRole('button', { name: 'Console' }),
  }).last().evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(250);
  await expect(page.getByText('Terminal 1')).toBeVisible();
  await expect(page.getByText('README.md')).toBeHidden();

  await page.getByRole('button', { name: 'Console' }).click();
  await expect(page.getByText('Terminal 1')).toBeHidden();
  await expect.poll(async () => page.locator('[tabindex="-1"]').filter({
    has: page.getByRole('button', { name: 'Console' }),
  }).last().evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(70);

  await expect(page.getByRole('button', { name: 'Tasks' })).toBeEnabled();
  await page.getByRole('button', { name: 'Tasks' }).click();
  await expect.poll(async () => page.locator('[tabindex="-1"]').filter({
    has: page.getByRole('button', { name: 'Tasks' }),
  }).last().evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(250);
  const tasksAria = await page.ariaSnapshot({ mode: 'ai', boxes: true, depth: 8 });
  await writeFile(path.join(artifactsDir, 'right-sidebar-tasks.aria.yml'), tasksAria, 'utf8');
  expect(tasksAria).toContain('button "Tasks"');

  await page.getByRole('button', { name: 'Tasks' }).click();
  await expect.poll(async () => page.locator('[tabindex="-1"]').filter({
    has: page.getByRole('button', { name: 'Tasks' }),
  }).last().evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(70);

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
