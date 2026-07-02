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
  // exact: the login field is named "Password"; the show/hide button ("Show password") also
  // substring-matches, so an inexact getByLabel would be ambiguous (strict-mode violation).
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // ADR-0043 login gate: an active policy gates every user (incl. admin) on login into a
  // full-screen acceptance page (no app shell). Accept it so the authenticated shell renders.
  // Wait for whichever lands first (gate or shell), then accept if gated.
  const acceptBtn = page.getByRole('button', { name: 'I Accept' });
  const clientsLink = page.getByRole('link', { name: 'Clients' });
  await expect(acceptBtn.or(clientsLink).first()).toBeVisible();
  if (await acceptBtn.isVisible()) await acceptBtn.click();

  // The sidebar (with its Administration links) only renders once authenticated.
  await expect(clientsLink).toBeVisible();

  await page.context().storageState({ path: STATE_PATH });
});
