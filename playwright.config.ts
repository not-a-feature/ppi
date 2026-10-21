import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

assert(
  process.env.TEST_DATABASE_URL,
  'Set TEST_DATABASE_URL to a local disposable PostgreSQL database.'
);
const database = new URL(process.env.TEST_DATABASE_URL);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname));
const schema = (process.env.PPI_E2E_SCHEMA ??= `ppi_e2e_${randomUUID().replaceAll('-', '')}`);
assert(/^ppi_e2e_[a-f0-9]{32}$/.test(schema));
database.searchParams.set('options', `-c search_path=${schema},public`);
Object.assign(process.env, {
  DATABASE_URL: database.href,
  ORIGIN: 'http://127.0.0.1:4174',
  UPLOAD_DIR: resolve('.data', schema),
  BETTER_AUTH_SECRET: 'browser-test-only-secret-not-for-any-deployment-2026'
});

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 45_000,
  forbidOnly: Boolean(process.env.CI),
  globalTeardown: './tests/browser/teardown.ts',
  use: {
    baseURL: process.env.ORIGIN,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure'
  },
  webServer: {
    command: `"${process.execPath}" --import tsx tests/browser/server.ts`,
    url: `${process.env.ORIGIN}/login`,
    timeout: 120_000,
    reuseExistingServer: false
  }
});
