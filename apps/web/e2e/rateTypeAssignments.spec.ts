import { test, expect, type Page } from '@playwright/test';

/*
 * Rate Type Assignments (ADR-0067 Phase B) — pick a Client × Product × Verification Unit combo, tick
 * which active rate types apply, Save (bulk replace the combo's active set). This asserts the saved set
 * PERSISTS: select a combo, ensure a rate type is checked, Save, reload + re-select the same combo, and
 * confirm it is still checked. Combo dropdowns are native <select> (resolved via the label-has-text
 * locator, not getByLabel). Viewport-independent → runs once at the Laptop band.
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Rate Type Assignments checked once');

const combo = (page: Page, label: string) =>
  page.locator('label', { has: page.getByText(label, { exact: true }) }).getByRole('combobox');

async function pickFirstCombo(page: Page): Promise<void> {
  await combo(page, 'Client').selectOption({ index: 1 });
  await combo(page, 'Product').selectOption({ index: 1 });
  await combo(page, 'Verification Unit').selectOption({ index: 1 });
}

test('Rate Type Assignments: the saved set persists for a combo', async ({ page }) => {
  await page.goto('/admin/rate-type-assignments');
  await pickFirstCombo(page);

  // The checkbox matrix loads once all three combo selects are chosen.
  const firstCheckbox = page.locator('fieldset input[type="checkbox"]').first();
  await expect(firstCheckbox).toBeVisible();

  // Ensure the first rate type is checked, then Save and wait for the bulk write to land (200).
  if (!(await firstCheckbox.isChecked())) await firstCheckbox.check();
  const saved = page.waitForResponse(
    (r) =>
      r.url().includes('/api/v2/rate-type-assignments/bulk') &&
      r.request().method() === 'POST' &&
      r.status() === 200,
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await saved;

  // Reload (page state resets), re-select the same combo, confirm the rate type is still checked.
  await page.reload();
  await pickFirstCombo(page);
  const firstAfter = page.locator('fieldset input[type="checkbox"]').first();
  await expect(firstAfter).toBeVisible();
  await expect(firstAfter).toBeChecked();
});
