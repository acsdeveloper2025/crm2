import { test, expect } from '@playwright/test';

/*
 * Verification Units record-page routes (ADR-0051 — Wave 4 D4, the last entity). The
 * VerificationUnitDialog modal is replaced by record-page routes: "+ New Unit" →
 * /admin/verification-units/new and a row's Edit → /admin/verification-units/:id (loaded by id).
 * System (mobile-locked) rows show a "System" chip instead of Edit, so the edit check targets a
 * non-system row. No overlay dialog for add/edit.
 * Interactions are viewport-independent, so this runs once at the Laptop band.
 */
const LAPTOP_WIDTH = 1280;
test.skip(
  ({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH,
  'Verification Units routes checked once',
);

test('Verification Units: create + edit are record-page routes, not modals', async ({ page }) => {
  await page.goto('/admin/verification-units');

  // "+ New Unit" navigates to a record page (URL changes), no add/edit dialog.
  await page.getByRole('button', { name: '+ New Unit' }).click();
  await expect(page).toHaveURL(/\/admin\/verification-units\/new$/);
  await expect(page.getByRole('heading', { name: 'New Verification Unit' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Back returns to the list.
  await page.getByRole('button', { name: /Back to verification units/ }).click();
  await expect(page).toHaveURL(/\/admin\/verification-units$/);

  // A non-system row's Edit navigates to the record page loaded by id, still no dialog.
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/verification-units\/\d+$/);
  await expect(page.getByRole('heading', { name: 'Edit Verification Unit' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
