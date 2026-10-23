import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  testDir: path.join(__dirname, 'e2e'),
  testMatch: /.*\.spec\.mjs$/,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    },
  },
  updateSnapshots: 'missing',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{projectName}/{arg}{ext}',
  outputDir: path.join(__dirname, 'report', 'artifacts'),
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(__dirname, 'report', 'html'), open: 'never' }],
    ['json', { outputFile: path.join(__dirname, 'report', 'results.json') }],
  ],
  use: {
    baseURL: process.env.PREVIEW_URL || 'http://127.0.0.1:4173',
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
    viewport: { width: 1440, height: 900 },
    screenshot: 'on',
    video: 'off',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  projects: [
    {
      name: 'desktop',
      use: {
        viewport: { width: 1440, height: 900 },
        isMobile: false,
        hasTouch: false,
      },
    },
    {
      name: 'tablet',
      use: {
        viewport: { width: 1024, height: 768 },
        isMobile: false,
        hasTouch: true,
      },
    },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
