import { test, expect, type Page } from '@playwright/test';

/*
 * Rate Type Assignments (ADR-0067/0093 — CREATE_PAGE_STANDARD multi-add, Fork B). A DataGrid LIST
 * (+ search / filters / export / import / Columns) and a merged create page: "+ New Assignment" →
 * /admin/rate-type-assignments/new — Step 1 picks the slot (Client required + Universal-able
 * Product/Unit, native <select>), Step 2 ticks MANY rate-type chips. Exactly one chip → a single POST
 * (201) + navigate back; the new row appears on the list. Viewport-independent → Laptop band only.
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Rate Type Assignments checked once');

// The Field label wraps its <select> and carries a required "*" marker, so match by substring.
const select = (page: Page, label: string) => page.locator('label', { hasText: label }).getByRole('combobox');

test('Rate Type Assignments: + New → slot + one rate type → it appears on the list', async ({ page }) => {
  await page.goto('/admin/rate-type-assignments');

  // "+ New Assignment" navigates to the merged create page (URL changes), no overlay dialog.
  await page.getByRole('button', { name: '+ New Assignment' }).click();
  await expect(page).toHaveURL(/\/admin\/rate-type-assignments\/new$/);
  await expect(page.getByRole('heading', { name: 'New Rate Type Assignment' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Step 1: Client (required) — first real option; Product/Unit left Universal (default). Step 2: tick
  // exactly one rate-type chip → the button reads "Save" and does a single POST. Wait for the amber
  // "already assigned" hint query to settle, then tick the first UNASSIGNED chip (an amber one would
  // make willCreate=0 and disable Save), so the test is robust across runs on a persistent DB.
  const amberQuery = page.waitForResponse(
    (r) => r.url().includes('/api/v2/rate-type-assignments?') && r.url().includes('active=true'),
  );
  await select(page, 'Client').selectOption({ index: 1 });
  await amberQuery;
  await page
    .locator('label.rounded-full')
    .filter({ hasNot: page.getByText('assigned', { exact: true }) })
    .first()
    .click();

  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/v2/rate-type-assignments') &&
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
