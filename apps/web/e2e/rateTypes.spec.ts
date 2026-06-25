import { test, expect } from '@playwright/test';

/*
 * Rate Types admin (ADR-0064 Phase A) — the managed rate-type catalog as an inline-grid (ADR-0051):
 * click a Name/Description/Category/Sort cell to edit in place; "+ Add row" to create; no modal form.
 * `code` is the catalog key — settable in the add-row but IMMUTABLE on an existing row (the DataGrid
 * `createOnly` flag). The OFFICE row is seeded by migration 0092. Interactions are viewport-independent,
 * so this runs once at the Laptop band.
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Rate Types inline grid checked once');

test('Rate Types: inline-grid; code immutable on edit, settable on create', async ({ page }) => {
  await page.goto('/admin/rate-types');

  // Grid loads a row before asserting (so the no-modal checks aren't a transient empty-grid pass).
  const codeCell = page.locator('td[data-label="Code"]').first();
  await expect(codeCell).toBeVisible();
  // The OFFICE band (seeded by mig 0092) is present.
  await expect(page.getByText('OFFICE', { exact: true }).first()).toBeVisible();

  // Inline-grid, not a modal: no per-row "Edit" button.
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);

  // A Name cell IS click-to-edit (editable on existing rows).
  const nameCell = page.locator('td[data-label="Name"]').first();
  await nameCell.click();
  await expect(nameCell.getByRole('textbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(nameCell.getByRole('textbox')).toHaveCount(0);

  // The Code cell is NOT click-to-edit on an existing row (createOnly → immutable identity).
  await codeCell.click();
  await expect(codeCell.getByRole('textbox')).toHaveCount(0);

  // "+ Add row" opens a create row that DOES expose a Code editor (createOnly settable at create).
  await page.getByRole('button', { name: /Add row/i }).click();
  const createCodeEditor = page.locator('td[data-label="Code"]').first().getByRole('textbox');
  await expect(createCodeEditor).toBeVisible();
  await page.keyboard.press('Escape'); // cancel the add-row (no row created)
  await expect(page.locator('td[data-label="Code"]').first().getByRole('textbox')).toHaveCount(0);
});
