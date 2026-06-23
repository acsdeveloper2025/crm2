import { test, expect } from '@playwright/test';

/*
 * Users record-page routes (ADR-0051 — Wave 4 D4). The 2-tab UserDialog modal is replaced by
 * record-page routes: "+ New" → /admin/users/new and a row's Edit → /admin/users/:id (loaded by id
 * via the additive GET /api/v2/users/:id; the id is a UUID). No overlay dialog for add/edit; the
 * Reset-password dialog stays a list-row modal (not exercised here).
 * Interactions are viewport-independent, so this runs once at the Laptop band.
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Users routes checked once');

test('Users: create + edit are record-page routes, not modals', async ({ page }) => {
  await page.goto('/admin/users');

  // "+ New" navigates to a record page (URL changes), no add/edit dialog.
  await page.getByRole('button', { name: '+ New', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users\/new$/);
  await expect(page.getByRole('heading', { name: 'New User' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Back returns to the list.
  await page.getByRole('button', { name: /Back to users/ }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);

  // A row's Edit navigates to the record page loaded by id (a UUID), still no dialog.
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Edit User' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
