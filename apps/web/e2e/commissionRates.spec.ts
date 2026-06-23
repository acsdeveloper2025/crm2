import { test, expect } from '@playwright/test';

/*
 * Commission Rates record-page routes (ADR-0051 — Wave 4 D4). The CommissionRateDialog modal is
 * replaced by record-page routes: "+ New Commission Rate" → /admin/commission-rates/new (full cascade)
 * and a row's Revise → /admin/commission-rates/:id (loaded by id via the additive GET /:id; revise =
 * amount + effective-from only). No overlay dialog for add/revise.
 * Interactions are viewport-independent, so this runs once at the Laptop band.
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Commission Rates routes checked once');

test('Commission Rates: create + revise are record-page routes, not modals', async ({ page }) => {
  await page.goto('/admin/commission-rates');

  // "+ New Commission Rate" navigates to a record page (URL changes), no add/revise dialog.
  await page.getByRole('button', { name: '+ New Commission Rate' }).click();
  await expect(page).toHaveURL(/\/admin\/commission-rates\/new$/);
  await expect(page.getByRole('heading', { name: 'New Commission Rate' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Back returns to the list.
  await page.getByRole('button', { name: /Back to commission rates/ }).click();
  await expect(page).toHaveURL(/\/admin\/commission-rates$/);

  // A row's Revise navigates to the record page loaded by id (deep-linkable), still no dialog.
  await page.getByRole('button', { name: 'Revise', exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/commission-rates\/\d+$/);
  await expect(page.getByRole('heading', { name: 'Revise Commission Rate' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
