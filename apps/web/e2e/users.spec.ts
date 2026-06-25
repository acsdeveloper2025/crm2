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

// Regression: editing a user with no phone used to 400 — an empty phone was sent as '' and failed the
// server E.164 check. Asserting SAVE persists (returns to the LIST) catches it.
test('Users: editing the admin (no phone) Saves and returns to the list (no 400)', async ({ page }) => {
  await page.goto('/admin/users');
  const adminRow = page.locator('tr').filter({ hasText: 'admin' }).first();
  await adminRow.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Edit User' })).toBeVisible();
  // Save with no changes: the empty phone must serialize to null (not '') → no 400.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
});

// Regression: creating a user with no department used to 400 — departmentId/designationId were sent as
// null, which CreateUserSchema rejects (.optional(), not .nullable()); they must be OMITTED on create.
// MANAGER reports to no one, so it needs no reporting manager (works against the admin-only seed).
test('Users: creating a MANAGER with no department Saves and returns to the list (no 400)', async ({
  page,
}) => {
  await page.goto('/admin/users/new');
  await expect(page.getByRole('heading', { name: 'New User' })).toBeVisible();
  const username = `zz_mgr_${Date.now()}`; // unique → re-runnable (no USER_EXISTS)
  await page.getByPlaceholder('jane_doe').fill(username);
  await page.getByLabel('Full name', { exact: true }).fill('ZZ Manager E2E');
  await page
    .locator('label', { has: page.getByText('Role', { exact: true }) })
    .getByRole('combobox')
    .selectOption('MANAGER');
  await page.getByPlaceholder('8+ chars, upper, lower, digit, symbol').fill('Str0ng!Pass1');
  // Department + Designation left blank — the regression (must be omitted on create, not sent as null).
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByText(username)).toBeVisible();
});
