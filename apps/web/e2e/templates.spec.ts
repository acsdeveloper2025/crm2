import { test, expect } from '@playwright/test';

/*
 * Report Templates record-page routes (ADR-0051 — the last popup conversion). The TemplateDialog
 * modal is replaced by record-page routes: "+ New" → /admin/templates/new and a row's Edit →
 * /admin/templates/:id (loaded by id via the additive GET /report-templates/:id). No overlay dialog
 * for add/edit. Viewport-independent → runs once at the Laptop band.
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Templates routes checked once');

test('Report Templates: create + edit are record-page routes, not modals', async ({ page }) => {
  await page.goto('/admin/templates');

  await page.getByRole('button', { name: '+ New', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/templates\/new$/);
  await expect(page.getByRole('heading', { name: 'New Template' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: /Back to templates/ }).click();
  await expect(page).toHaveURL(/\/admin\/templates$/);

  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/templates\/\d+$/);
  await expect(page.getByRole('heading', { name: 'Edit Template' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
