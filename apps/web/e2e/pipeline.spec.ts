import { test, expect } from '@playwright/test';

/*
 * Pipeline (operations task queue — docs/specs/2026-06-11-pipeline-design.md §5).
 * Exercises what is Pipeline-specific on top of the shared DataGrid behaviour
 * (already covered by datagrid.spec): the status bucket bar (sets the `status`
 * domain filter, URL-synced) and the row-select → Assign dialog (intersection
 * pool + focus trap). Runs once at the Laptop band against the dev DB.
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Pipeline behaviour checked once');

test('bucket bar filters by status and persists to the URL', async ({ page }) => {
  await page.goto('/pipeline');
  const buckets = page.getByRole('group', { name: 'Status buckets' });
  await expect(buckets.getByRole('button', { name: /^All/ })).toBeVisible();

  // Picking a bucket writes the status domain filter to the URL and re-anchors to page 1.
  await buckets.getByRole('button', { name: /^Unassigned/ }).click();
  await expect(page).toHaveURL(/status=PENDING/);
  await expect(buckets.getByRole('button', { name: /^Unassigned/ })).toHaveAttribute('aria-pressed', 'true');

  // Survives a reload (bookmarkable), then All clears it.
  await page.reload();
  await expect(
    page.getByRole('group', { name: 'Status buckets' }).getByRole('button', { name: /^Unassigned/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: 'Status buckets' }).getByRole('button', { name: /^All/ }).click();
  await expect(page).not.toHaveURL(/status=/);

  // Bucket counts honor the grid's global search (URL key `q` → the stats `search` param):
  // a no-match search zeroes the All bucket (no extra navigation — avoids token-rotation races).
  await page.getByRole('textbox', { name: 'Search' }).fill('NO_SUCH_TASK_XYZ');
  await expect(
    page.getByRole('group', { name: 'Status buckets' }).getByRole('button', { name: /^All/ }),
  ).toHaveText(/All\s*0/);
});

test('row selection opens the Assign dialog with the eligibility pool (focus-trapped)', async ({ page }) => {
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');

  // Tick the first row → the bulk bar appears with the Assign action.
  const firstRowCheckbox = page.locator('tbody tr input[type=checkbox]').first();
  await firstRowCheckbox.check();
  const assignButton = page.getByRole('button', { name: 'Assign…' });
  await expect(assignButton).toBeVisible();

  // The dialog opens (focus-trapped modal) and the executive select loads the
  // server-side intersection pool (or its honest empty/error sentinel).
  await assignButton.click();
  const dialog = page.getByRole('dialog', { name: /Assign 1 task/ });
  await expect(dialog).toBeVisible();
  const select = dialog.locator('select').first(); // the Executive select (visit/distance follow)
  await expect(select).toBeVisible();
  await expect(select.locator('option').first()).not.toHaveText('Loading…');

  // Escape closes it (useFocusTrap) without assigning.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
