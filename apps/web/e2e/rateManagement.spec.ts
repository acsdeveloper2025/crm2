import { test, expect } from '@playwright/test';

/*
 * Rate Management record-page routes (ADR-0051 — the last popup conversion). The inline AddRateForm +
 * the Revise modal are replaced by record-page routes: "+ Add rate" → /admin/rates/new (full cascade)
 * and a row's Revise → /admin/rates/:id (loaded by id via the additive GET /rates/:id; revise = amount
 * + effective-from only). The read-only History overlay stays. No overlay dialog for add/revise.
 * Viewport-independent → runs once at the Laptop band.
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Rate routes checked once');

test('Rate Management: add + revise are record-page routes, not modals', async ({ page }) => {
  await page.goto('/admin/rates');

  await page.getByRole('button', { name: '+ Add rate', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/rates\/new$/);
  await expect(page.getByRole('heading', { name: 'New Rate' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: /Back to rate management/ }).click();
  await expect(page).toHaveURL(/\/admin\/rates$/);

  await page.getByRole('button', { name: 'Revise', exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/rates\/\d+$/);
  await expect(page.getByRole('heading', { name: 'Revise Rate' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
