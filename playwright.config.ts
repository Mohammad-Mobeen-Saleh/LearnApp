import { defineConfig, devices } from '@playwright/test';

/**
 * E2E-Tests gegen den Produktionsbuild.
 *   npx playwright install      (einmalig: Browser herunterladen)
 *   npm run test:e2e
 * iPhone-Profile verwenden WebKit (Safari-Engine), Desktop Chromium/Edge und Firefox.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [
    { name: 'iPhone 13 Pro Max (hoch)', use: { ...devices['iPhone 13 Pro Max'] } },
    { name: 'iPhone 13 Pro Max (quer)', use: { ...devices['iPhone 13 Pro Max landscape'] } },
    { name: 'iPhone SE (klein)', use: { ...devices['iPhone SE'] } },
    { name: 'Windows Laptop – Chrome', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: 'Windows Laptop – Firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1366, height: 768 } } },
  ],
});
