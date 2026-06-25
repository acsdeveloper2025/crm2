import { test, expect, type Page } from '@playwright/test';

/*
 * Rate Type Assignments (ADR-0069 — per-unit table). Pick a Client (required) + a Product ("All products
 * (Universal)" is the first option), then per verification-unit row toggle which active rate types apply;
 * one Save bulk-replaces each changed row's set. This asserts a toggled-on rate type PERSISTS: pick a combo,
 * turn a unit row's rate type ON, Save (wait the bulk POST 200), reload + re-pick the same combo, confirm it
 * is still on. The Client/Product selects are native <select> (resolved via the label-has-text locator).
 * Rate-type chips are visually-hidden checkboxes inside the table cell. Viewport-independent → Laptop only.
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Rate Type Assignments checked once');

const combo = (page: Page, label: string) =>
  page.locator('label', { has: page.getByText(label, { exact: true }) }).getByRole('combobox');

// First rate-type checkbox in the first unit row (the "All units (Universal)" row).
const firstRateTypeCheckbox = (page: Page) =>
  page.locator('table.rtable td[data-label="Rate Types"] input[type="checkbox"]').first();

async function pickCombo(page: Page): Promise<void> {
  // Client is required; Product defaults to "All products (Universal)" (index 0) — leave it Universal.
  await combo(page, 'Client').selectOption({ index: 1 });
}

test('Rate Type Assignments: a toggled rate type persists for a combo', async ({ page }) => {
  await page.goto('/admin/rate-type-assignments');
  await pickCombo(page);

  // The table loads once a client is chosen.
  const firstChip = firstRateTypeCheckbox(page);
  await expect(firstChip).toBeAttached();

  // Ensure the first rate type is ON, then Save and wait for the bulk write to land (200).
  if (!(await firstChip.isChecked())) await firstChip.check();
  const saved = page.waitForResponse(
    (r) =>
      r.url().includes('/api/v2/rate-type-assignments/bulk') &&
      r.request().method() === 'POST' &&
      r.status() === 200,
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await saved;

  // Reload (page state resets), re-pick the same combo, confirm the rate type is still ON.
  await page.reload();
  await pickCombo(page);
  const firstAfter = firstRateTypeCheckbox(page);
  await expect(firstAfter).toBeAttached();
  await expect(firstAfter).toBeChecked();
});
