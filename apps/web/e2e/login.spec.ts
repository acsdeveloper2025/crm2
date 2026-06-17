import { test, expect } from '@playwright/test';

/* The login page must be usable, overflow-free, and its form reachable at every band. */
const OVERFLOW_TOLERANCE_PX = 1;

test.use({ storageState: { cookies: [], origins: [] } });

test('Login is responsive', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  await expect(page.getByLabel('Username')).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
});
