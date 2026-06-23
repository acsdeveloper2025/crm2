import { test, expect } from '@playwright/test';

/*
 * Roles/RBAC record-page routes (ADR-0051 — Wave 4 D4). The inline RoleDialog modal is replaced by
 * record-page routes: "+ New Role" → /admin/rbac/new and a row's Edit → /admin/rbac/:code (loaded by
 * code via the additive GET /api/v2/roles/:code). No overlay dialog for add/edit. Roles are keyed by
 * code (alphanumeric), so the edit URL ends in the code, not a numeric id.
 * Interactions are viewport-independent, so this runs once at the Laptop band.
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Roles routes checked once');

test('Roles: create + edit are record-page routes, not modals', async ({ page }) => {
  await page.goto('/admin/rbac');

  // "+ New Role" navigates to a record page (URL changes), no add/edit dialog.
  await page.getByRole('button', { name: '+ New Role' }).click();
  await expect(page).toHaveURL(/\/admin\/rbac\/new$/);
  await expect(page.getByRole('heading', { name: 'New Role' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Back returns to the list.
  await page.getByRole('button', { name: /Back to access control/ }).click();
  await expect(page).toHaveURL(/\/admin\/rbac$/);

  // A row's Edit (enabled for non-grants_all roles) navigates to the record page, loaded by code.
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/rbac\/[A-Z0-9_]+$/);
  await expect(page.getByRole('heading', { name: 'Edit Role' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
