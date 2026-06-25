import { test, expect, type Page } from '@playwright/test';

/*
 * Rate Type Assignments (ADR-0069 — rebuilt as standard CRUD, cloned from Commission Rates). A DataGrid
 * LIST (+ search / filters / export / import / Columns) and a record-page FORM: "+ New Assignment" →
 * /admin/rate-type-assignments/new with Client (required) + Universal-able Product/Unit + Rate Type
 * (required). Save POSTs and returns to the list, where the new row appears. The selects are native
 * <select> resolved via the label-has-text locator. Viewport-independent → Laptop band only.
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Rate Type Assignments checked once');

const select = (page: Page, label: string) =>
  page.locator('label', { has: page.getByText(label, { exact: true }) }).getByRole('combobox');

test('Rate Type Assignments: + New → form → create an assignment → it appears on the list', async ({
  page,
}) => {
  await page.goto('/admin/rate-type-assignments');

  // "+ New Assignment" navigates to a record-page form (URL changes), no overlay dialog.
  await page.getByRole('button', { name: '+ New Assignment' }).click();
  await expect(page).toHaveURL(/\/admin\/rate-type-assignments\/new$/);
  await expect(page.getByRole('heading', { name: 'New Rate Type Assignment' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Client (required) — first real option; Product/Unit left Universal (default index 0); Rate Type (required).
  await select(page, 'Client').selectOption({ index: 1 });
  await select(page, 'Rate Type').selectOption({ index: 1 });

  const created = page.waitForResponse(
    (r) =>
      r.url().includes('/api/v2/rate-type-assignments') &&
      r.request().method() === 'POST' &&
      r.status() === 201,
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await created;

  // Save persisted → back on the list, and at least one row (the new assignment) is present.
  await expect(page).toHaveURL(/\/admin\/rate-type-assignments$/);
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  // A Universal product/unit row renders the literal "Universal".
  await expect(page.getByText('Universal').first()).toBeVisible();
});
