import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [['line']],
  use: {
    channel: 'msedge',
    headless: process.env.ROPCODE_E2E_HEADED === '1' ? false : true,
    viewport: { width: 1440, height: 960 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'edge',
      use: {
        channel: 'msedge',
      },
    },
  ],
});
