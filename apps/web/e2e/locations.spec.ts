import { test, expect } from '@playwright/test';

/*
 * Locations inline-grid editing (ADR-0051 — Wave 4 D3 tail). Location Management dropped its
 * per-row "Edit Location" MODAL for Twenty-style per-cell editing in the DataGrid: click a cell
 * (e.g. Area) to edit it in place; the multi-area batch-create form above the grid stays.
 * Interactions are viewport-independent, so this runs once at the Laptop band.
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Locations inline edit checked once');

test('Locations: editing is inline per-cell, not a modal', async ({ page }) => {
  await page.goto('/admin/locations');

  // Wait for the grid to load a row before asserting (so "no Edit button" isn't a transient
  // empty-grid pass).
  const areaCell = page.locator('td[data-label="Area"]').first();
  await expect(areaCell).toBeVisible();

  // The edit modal is gone: no per-row "Edit" button, no "Edit Location" dialog.
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Edit Location' })).toHaveCount(0);

  // Clicking an editable grid cell opens an in-place editor seeded with the row's value (the editor
  // holds the raw value; the display cell may upper-case it via CSS, so read the editor as the source).
  await areaCell.click();
  const editor = areaCell.getByRole('textbox');
  await expect(editor).toBeVisible();
  await expect(editor).not.toHaveValue('');
  const seeded = await editor.inputValue();

  // Escape cancels the edit (no mutation): the editor closes and the cell shows its value again.
  await page.keyboard.press('Escape');
  await expect(areaCell.getByRole('textbox')).toHaveCount(0);
  await expect(areaCell).toHaveText(seeded);
});

// Inline-edit KEYBOARD access (KN-1/KN-2, WCAG 2.1.1 + 2.4.3): the editable cell was previously
// mouse-only (tabIndex=-1, no key handler). It must now be a keyboard-reachable button — Enter opens
// the editor, and Escape returns focus to the CELL (not lost to <body>).
test('Locations: an editable cell opens on Enter and returns focus to the cell on Escape', async ({
  page,
}) => {
  await page.goto('/admin/locations');
  const areaCell = page.locator('td[data-label="Area"]').first();
  await expect(areaCell).toBeVisible();
  // KN-1: keyboard-reachable, not a mouse-only cell (was tabIndex=-1).
  await expect(areaCell).toHaveAttribute('tabindex', '0');
  await areaCell.focus();
  await expect(areaCell).toBeFocused();
  const seeded = await areaCell.textContent();
  // Enter opens the inline editor and moves focus into it.
  await page.keyboard.press('Enter');
  const editor = areaCell.getByRole('textbox');
  await expect(editor).toBeFocused();
  // Escape cancels and returns focus to the cell (KN-2) — the display value is unchanged.
  await page.keyboard.press('Escape');
  await expect(areaCell.getByRole('textbox')).toHaveCount(0);
  await expect(areaCell).toBeFocused();
  await expect(areaCell).toHaveText((seeded ?? '').trim());
});
