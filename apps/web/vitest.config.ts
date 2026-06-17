import { defineConfig } from 'vitest/config';

/*
 * Unit/component tests (vitest) live under src/. The e2e/ directory is owned by
 * the Playwright viewport harness (playwright.config.ts) — its `*.spec.ts` files
 * use Playwright's test runner and must not be collected by vitest.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
