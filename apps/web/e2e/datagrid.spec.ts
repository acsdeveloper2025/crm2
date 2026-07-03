import { test, expect } from '@playwright/test';

/*
 * Universal DataGrid behaviour (docs/DATAGRID_STANDARD.md; CI gate 45-48 surface).
 * Exercises the core on its reference page (/admin/clients): global search box,
 * server sorting via header click, page-size control, and URL-state persistence —
 * all of which must survive a reload. Runs once at the Laptop band (interactions
 * are viewport-independent).
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'DataGrid behaviour checked once');

test('DataGrid: search + sort + page-size persist to the URL', async ({ page }) => {
  await page.goto('/admin/clients');

  // Core controls are present.
  await expect(page.getByRole('textbox', { name: 'Search' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Rows per page' })).toBeVisible();

  // Server sorting: clicking a sortable header writes sort+dir to the URL.
  await page.getByRole('columnheader', { name: /^Code/ }).click();
  await expect(page).toHaveURL(/sort=code/);
  await expect(page).toHaveURL(/dir=asc/);
  // Clicking again flips the direction.
  await page.getByRole('columnheader', { name: /^Code/ }).click();
  await expect(page).toHaveURL(/dir=desc/);

  // Page size persists in the URL.
  await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('50');
  await expect(page).toHaveURL(/size=50/);

  // URL state survives a reload (bookmarkable).
  await page.reload();
  await expect(page).toHaveURL(/size=50/);
  await expect(page).toHaveURL(/sort=code/);
  await expect(page.getByRole('combobox', { name: 'Rows per page' })).toHaveValue('50');
});

test('DataGrid: column visibility toggles, persists to the URL, and survives reload', async ({ page }) => {
  await page.goto('/admin/clients');
  await expect(page.getByRole('columnheader', { name: /^Code/ })).toBeVisible();

  // Hide the Code column via the Columns menu.
  await page.getByRole('button', { name: 'Columns' }).click();
  const menu = page.getByRole('menu', { name: 'Toggle columns' });
  await menu.getByRole('checkbox', { name: 'Code' }).uncheck();

  // Header is removed and the hidden column is recorded in the URL.
  await expect(page.getByRole('columnheader', { name: /^Code/ })).toHaveCount(0);
  await expect(page).toHaveURL(/cols=code/);

  // Survives a reload (bookmarkable).
  await page.reload();
  await expect(page.getByRole('columnheader', { name: /^Code/ })).toHaveCount(0);

  // Re-showing clears it from the URL.
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('menu', { name: 'Toggle columns' }).getByRole('checkbox', { name: 'Code' }).check();
  await expect(page.getByRole('columnheader', { name: /^Code/ })).toBeVisible();
  await expect(page).not.toHaveURL(/cols=/);
});

test('DataGrid: export menu offers current/all × XLSX/CSV and downloads the current view', async ({
  page,
}) => {
  await page.goto('/admin/clients');

  await page.getByRole('button', { name: 'Export' }).click();
  const menu = page.getByRole('menu', { name: 'Export' });
  // Both modes are offered, each in XLSX + CSV (IMPORT_EXPORT_STANDARD §11).
  await expect(menu.getByText('Current view')).toBeVisible();
  await expect(menu.getByText('All matching rows')).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Export as CSV' })).toHaveCount(2);
  await expect(menu.getByRole('menuitem', { name: 'Export as Excel (XLSX)' })).toHaveCount(2);

  // Current-view CSV streams a file download named after the resource + date.
  const downloadPromise = page.waitForEvent('download');
  await menu.getByRole('menuitem', { name: 'Export as CSV' }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/clients-\d{8}\.csv/);
});

test('DataGrid: date-range filter sends f_<id>_from/_to, persists to the URL, and clears', async ({
  page,
}) => {
  await page.goto('/admin/clients');
  const from = page.getByLabel('Created from');
  const to = page.getByLabel('Created to');
  await expect(from).toBeVisible();
  await expect(to).toBeVisible();

  await from.fill('2026-06-01');
  await to.fill('2026-06-09');
  await expect(page).toHaveURL(/f_createdAt_from=2026-06-01/);
  await expect(page).toHaveURL(/f_createdAt_to=2026-06-09/);

  // Survives a reload (bookmarkable); inputs re-seed from the URL.
  await page.reload();
  await expect(page.getByLabel('Created from')).toHaveValue('2026-06-01');

  // Clearing a bound removes its param.
  await page.getByLabel('Created from').fill('');
  await expect(page).not.toHaveURL(/f_createdAt_from=/);
});

test('DataGrid: per-column filter sends f_<col>, persists to the URL, and survives reload', async ({
  page,
}) => {
  await page.goto('/admin/clients');
  const codeFilter = page.getByRole('textbox', { name: 'Filter Code' });
  await expect(codeFilter).toBeVisible();

  await codeFilter.fill('hd');
  await expect(page).toHaveURL(/f_code=hd/);

  // Survives a reload (bookmarkable); the input re-seeds from the URL.
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Filter Code' })).toHaveValue('hd');

  // Clearing removes the param.
  await page.getByRole('textbox', { name: 'Filter Code' }).fill('');
  await expect(page).not.toHaveURL(/f_code=/);
});

test('DataGrid: Excel-style header multi-select (§7) filters by enum, persists, and clears', async ({
  page,
}) => {
  // ADR-0070 dropped verification_units.kind; worker_role is the unit discriminator now, exposed as the
  // filterable "Worker" enum column — exercise the §7 multi-select feature on it.
  await page.goto('/admin/verification-units');
  const workerFilter = page.getByRole('button', { name: 'Filter Worker' });
  await expect(workerFilter).toBeVisible();
  await expect(workerFilter).toContainText('All');

  await workerFilter.click();
  const menu = page.getByRole('menu', { name: 'Worker options' });
  await menu.getByRole('checkbox', { name: 'Field', exact: true }).check();
  await expect(page).toHaveURL(/f_workerRole=FIELD_AGENT/);

  // Survives reload; the trigger reflects the selection count.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Filter Worker' })).toContainText('1 selected');

  // Unchecking clears the param.
  await page.getByRole('button', { name: 'Filter Worker' }).click();
  await page
    .getByRole('menu', { name: 'Worker options' })
    .getByRole('checkbox', { name: 'Field', exact: true })
    .uncheck();
  await expect(page).not.toHaveURL(/f_workerRole=/);
});

// Guard the contract change: EVERY page that consumes a paginated list endpoint (or the
// `/options` feeds) must read the right shape. A render crash (e.g. `.map` on the envelope
// object, or `.items` on a flat array) unmounts the whole tree — assert the shell + heading
// survive AFTER data loads on every envelope/options-consuming route (the viewport spec only
// asserts during the loading window, before the fetch resolves).
const ENVELOPE_PAGES = [
  '/admin/clients',
  '/admin/products',
  '/admin/verification-units',
  '/admin/users',
  '/admin/locations',
  '/admin/rates',
  '/admin/cpv',
  '/cases',
  '/cases/new',
];
test('every envelope/options-consuming page survives data load', async ({ page }) => {
  for (const path of ENVELOPE_PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /(open|collapse) menu/i })).toBeVisible();
    await expect(page.locator('main h1')).toBeVisible();
  }
});

// Keyboard-nav / focus management (DATAGRID_STANDARD §19/§20; axe gate 29).
// Menu popovers and modal dialogs must move focus in on open, trap it while open,
// and return it to the trigger on close — the carried-OPEN a11y item.
test('DataGrid: Columns menu moves focus in, then Escape closes it and returns focus to the trigger', async ({
  page,
}) => {
  await page.goto('/admin/clients');
  const trigger = page.getByRole('button', { name: 'Columns' });
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Toggle columns' });
  await expect(menu).toBeVisible();
  // focus moved into the menu (its first checkbox), not left on the trigger
  await expect(menu.getByRole('checkbox').first()).toBeFocused();
  // Escape closes the menu and restores focus to the button that opened it
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

// APG menu roving (KN-10): the DataGrid role="menu" popovers must be Arrow-navigable (Down/Up move
// focus, Home/End jump), not only Tab-cycled. Verified on the Columns menu (checkbox items).
test('DataGrid: the Columns menu supports Arrow / Home / End roving', async ({ page }) => {
  await page.goto('/admin/clients');
  const trigger = page.getByRole('button', { name: 'Columns' });
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Toggle columns' });
  const boxes = menu.getByRole('checkbox');
  // focus moved in to the first item on open
  await expect(boxes.first()).toBeFocused();
  // ArrowDown → next; End → last; Home → first
  await page.keyboard.press('ArrowDown');
  await expect(boxes.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(boxes.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(boxes.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

// Keyboard operability of the grid itself (Wave K / K1 — DATAGRID_STANDARD §19, axe gate 29):
// a sortable header must be focusable and toggle sort via Enter/Space (keeping aria-sort), and an
// onRowClick row must be focusable and open via Enter — not mouse-only.
test('DataGrid: a sortable header is keyboard-operable (focus + Enter toggles sort + aria-sort)', async ({
  page,
}) => {
  await page.goto('/admin/clients');
  const codeHeader = page.getByRole('columnheader', { name: /^Code/ });
  await expect(codeHeader).toBeVisible();
  await codeHeader.focus();
  await expect(codeHeader).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(codeHeader).toHaveAttribute('aria-sort', 'ascending');
  await expect(page).toHaveURL(/dir=asc/);
  await page.keyboard.press('Enter');
  await expect(codeHeader).toHaveAttribute('aria-sort', 'descending');
  await expect(page).toHaveURL(/dir=desc/);
});

test('DataGrid: an onRowClick row is keyboard-operable (focus + Enter opens the row)', async ({ page }) => {
  await page.goto('/cases');
  await page.waitForLoadState('networkidle');
  const firstRow = page.locator('tbody tr').first();
  await expect(firstRow).toBeVisible();
  await expect(firstRow).toHaveAttribute('tabindex', '0');
  await firstRow.focus();
  await expect(firstRow).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/cases\/[^/]+$/);
});

// Loading-experience time bands (PAGINATION_AND_LOADING_STANDARDS §6/§7): a list fetch slower
// than ~1s swaps the skeleton for the Hexagon loader (role=status), which clears once data lands.
test('DataGrid: a slow load shows the Hexagon loader, which clears when rows arrive', async ({ page }) => {
  // Delay the clients list response past the 1s loader band (the `?` query disambiguates the
  // list call from /clients/options and /clients/export).
  await page.route('**/api/v2/clients?**', async (route) => {
    await new Promise((r) => setTimeout(r, 1800));
    await route.continue();
  });
  await page.goto('/admin/clients');
  const loader = page.getByRole('status', { name: /loading/i });
  await expect(loader).toBeVisible();
  // Once the (delayed) page resolves, the loader is gone and real rows render.
  await expect(loader).toBeHidden();
  await expect(page.getByRole('button', { name: 'Columns' })).toBeVisible();
});

// Row selection + bulk-action bar (DATAGRID_STANDARD §15).
test('DataGrid: selecting rows shows the bulk-action bar with Export Selected, and Clear hides it', async ({
  page,
}) => {
  await page.goto('/admin/clients');
  await expect(page.getByRole('button', { name: 'Columns' })).toBeVisible();
  const firstRow = page.getByRole('checkbox', { name: 'Select row' }).first();
  await expect(firstRow).toBeVisible();
  await firstRow.check();
  const bar = page.getByRole('region', { name: 'Bulk actions' });
  await expect(bar).toBeVisible();
  await expect(bar.getByText(/\d+ selected/)).toBeVisible();
  // Export Selected is offered (it's the built-in bulk action when the grid has an export fn).
  await expect(bar.getByRole('button', { name: 'Export XLSX' })).toBeVisible();
  // Clearing the selection hides the bar.
  await bar.getByRole('button', { name: 'Clear' }).click();
  await expect(bar).toBeHidden();
});

test('DataGrid dialog: Import traps focus and Escape closes it, returning focus to the trigger', async ({
  page,
}) => {
  // All add/edit modals are gone (ADR-0051 — inline-grid + record-page routes). The bulk-Import modal
  // (not a D4 target) is the stable focus-trapped overlay opened from a DataGrid list page.
  await page.goto('/admin/clients');
  const trigger = page.getByRole('button', { name: 'Import', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Import clients' });
  await expect(dialog).toBeVisible();
  // focus landed inside the dialog (first focusable — the Download-template button)
  await expect(dialog.getByRole('button', { name: /Download template/ })).toBeFocused();
  // Escape (onEscape=onClose) dismisses and returns focus to the opener
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('DataGrid: master-detail row expansion (§20) toggles the inline detail (CPV unit manager)', async ({
  page,
}) => {
  await page.goto('/admin/cpv');
  await page.waitForLoadState('networkidle');
  // Each CPV link row carries a leading chevron expander (renderExpanded). The detail is hidden first.
  const expander = page.getByRole('button', { name: 'Expand row' }).first();
  await expect(expander).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable unit' })).toBeHidden();
  // Expand → the inline UnitManager detail row appears; the expander flips to Collapse.
  await expander.click();
  await expect(page.getByRole('button', { name: 'Enable unit' })).toBeVisible();
  const collapse = page.getByRole('button', { name: 'Collapse row' }).first();
  await expect(collapse).toBeVisible();
  // Collapse → the detail is removed again (one row open at a time, ephemeral).
  await collapse.click();
  await expect(page.getByRole('button', { name: 'Enable unit' })).toBeHidden();
});
