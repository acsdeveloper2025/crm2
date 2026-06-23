import { test, expect } from '@playwright/test';

/*
 * Report Layouts record-page routes (ADR-0051 — Wave 4 D4). The LayoutDesignerDialog modal is
 * replaced by full record-page routes: "New Layout" → /admin/report-layouts/new and a row's Edit →
 * /admin/report-layouts/:id (deep-linkable, loaded by id). No overlay dialog for the designer.
 * Interactions are viewport-independent, so this runs once at the Laptop band.
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Report Layouts routes checked once');

test('Report Layouts: create + edit are record-page routes, not modals', async ({ page }) => {
  await page.goto('/admin/report-layouts');

  // "New Layout" navigates to a record page (URL changes), no designer dialog.
  await page.getByRole('button', { name: 'New Layout' }).click();
  await expect(page).toHaveURL(/\/admin\/report-layouts\/new$/);
  await expect(page.getByRole('heading', { name: 'New Report Layout' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Back returns to the list.
  await page.getByRole('button', { name: /Back to MIS Layouts/ }).click();
  await expect(page).toHaveURL(/\/admin\/report-layouts$/);

  // A row's Edit navigates to the record page loaded by id (deep-linkable), still no dialog.
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/report-layouts\/\d+$/);
  await expect(page.getByRole('heading', { name: 'Edit Report Layout' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
