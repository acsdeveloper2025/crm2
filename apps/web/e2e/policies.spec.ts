import { test, expect } from '@playwright/test';

/*
 * Policies record-page routes (ADR-0051 — Wave 4 D4 reference spike). The Policies create/edit modal
 * (PolicyDialog) is replaced by full record-page routes: "+ New Policy" → /admin/policies/new and a
 * row's Edit → /admin/policies/:id (deep-linkable, loaded by id). No overlay dialog for add/edit.
 * Interactions are viewport-independent, so this runs once at the Laptop band.
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Policies routes checked once');

test('Policies: create + edit are record-page routes, not modals', async ({ page }) => {
  await page.goto('/admin/policies');

  // "+ New Policy" navigates to a record page (URL changes), with no add/edit dialog.
  await page.getByRole('button', { name: '+ New Policy' }).click();
  await expect(page).toHaveURL(/\/admin\/policies\/new$/);
  await expect(page.getByRole('heading', { name: 'New Policy' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Back returns to the list.
  await page.getByRole('button', { name: /Back to policies/ }).click();
  await expect(page).toHaveURL(/\/admin\/policies$/);

  // A row's Edit navigates to the record page loaded by id (deep-linkable), still no dialog.
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/policies\/\d+$/);
  await expect(page.getByRole('heading', { name: 'Edit Policy' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
