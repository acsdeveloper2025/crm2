import { test as setup, expect } from '@playwright/test';

/*
 * Logs in once (dev seed admin/admin123) and persists the authenticated storage
 * state — tokens live in localStorage, which Playwright captures per origin. The
 * viewport projects depend on this so each spec starts already signed in.
 */
const STATE_PATH = 'e2e/.auth/state.json';
const USERNAME = process.env['E2E_USERNAME'] ?? 'admin';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'admin123';

setup('authenticate', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Username').fill(USERNAME);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // The sidebar (with its Administration links) only renders once authenticated.
  await expect(page.getByRole('link', { name: 'Clients' })).toBeVisible();

  await page.context().storageState({ path: STATE_PATH });
});
