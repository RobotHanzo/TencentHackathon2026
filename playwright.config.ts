import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each invocation uses its own workspace. Never reuse a developer's running API.
const databasePath = join(mkdtempSync(join(tmpdir(), 'clearport-browser-')), 'workspace.db');

export default defineConfig({
  testDir: './tests',
  testMatch: '**/workflow.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    viewport: { width: 1440, height: 1080 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1080 } },
    },
  ],
  webServer: [
    {
      command: 'npx tsx server/index.ts',
      url: 'http://127.0.0.1:3101/api/health',
      env: {
        DATA_PATH: databasePath,
        PORT: '3101',
        DEMO_MODE: 'true',
        NODE_ENV: 'test',
        AI_API_KEY: '',
        AI_BASE_URL: '',
        AI_MODEL: '',
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run dev:client -- --port 5174',
      url: 'http://127.0.0.1:5174',
      env: { CLEARPORT_API_TARGET: 'http://127.0.0.1:3101' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
