import { defineConfig, devices } from '@playwright/test';

/*
 * Responsive viewport harness (RESPONSIVE_DESIGN_STANDARD §"Testing requirements";
 * CI gates 49–50). Every page is exercised at the four supported bands — rendered
 * at the standard's device sizes 375/768/1280/1440 (band minimums 320/768/1024/1440) — and must
 * have no horizontal overflow, a reachable nav trigger, and a reachable primary
 * action. Runs against the vite dev server (port 5273) which proxies /api to the
 * API (default http://localhost:4000); a `setup` project logs in once and shares
 * the authenticated storage state with the viewport projects.
 */
const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:5273';

const VIEWPORTS = {
  Mobile: { width: 375, height: 812 },
  Tablet: { width: 768, height: 1024 },
  Laptop: { width: 1280, height: 800 },
  Desktop: { width: 1440, height: 900 },
} as const;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: BASE_URL, trace: 'on-first-retry' },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    ...Object.entries(VIEWPORTS).map(([name, viewport]) => ({
      name,
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], viewport, storageState: 'e2e/.auth/state.json' },
      dependencies: ['setup'],
    })),
  ],
  // Self-contained stack: boot the API (web proxies /api → :4000) then the web dev
  // server. Locally an already-running dev API/web is reused; CI boots both fresh
  // (the API reads DATABASE_URL from the job env). The health route answers 401 when
  // unauthenticated, which Playwright accepts as "ready".
  webServer: [
    {
      command: 'pnpm --filter @crm2/api dev',
      url: 'http://localhost:4000/api/v2/system/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm dev',
      url: BASE_URL,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
  ],
});
