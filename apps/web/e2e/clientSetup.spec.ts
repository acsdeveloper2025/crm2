import { test, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';

/*
 * Client Setup hub (ADR-0092 S1) — shell smoke: nav entry, client picker, deep-link safety, and the
 * responsive band. (a)-(d) are viewport-independent (checked once at Laptop, same convention as
 * rateTypeAssignments.spec.ts / layout.spec.ts); (e) owns its own 320/768/1024/1440 loop per the
 * RESPONSIVE_DESIGN_STANDARD band minimums (distinct from viewport.spec.ts's four projects).
 *
 * Task 15 (ADR-0092 S6) adds the two onboarding journeys on top: Journey A drives the hub UI end to
 * end (create a client → link a product + enable a unit → assign a rate type), Journey B drives the
 * onboarding-workbook round trip (download template → upload a filled workbook → preview → confirm).
 * Both build a fresh, uniquely-coded client per run (same `E2E...${Date.now()}` convention as
 * rateTypes.spec.ts/rateTypeAssignments.spec.ts) so re-runs never collide.
 */
const LAPTOP_WIDTH = 1280;
const STEP_LABELS = ['Products & CPV units', 'Rate types', 'Rates', 'Commission rates'];
const BAND_WIDTHS = [320, 768, 1024, 1440];
const OVERFLOW_TOLERANCE_PX = 1;

/**
 * Opens the client picker and picks the first real option; skips the calling test if the dev DB has
 * no clients. The options query fires on page mount, so settle the network FIRST (same networkidle
 * convention as viewport.spec.ts) — a one-shot count taken while the fetch is still in flight sees
 * the transient "No matches" li (zero role=option) and would silently skip even when clients exist.
 */
async function pickFirstClient(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('Select a client…').click();
  const options = page.getByRole('option');
  if ((await options.count()) === 0) {
    test.skip(true, 'dev DB has no clients to pick from — nothing to assert for this leg');
  }
  await options.first().click();
  await expect(page).toHaveURL(/[?&]clientId=\d+/);
}

/** Picks a client by its unique code in the hub's type-to-search picker (types the code so the option
 *  list narrows to exactly one match — safe even when the dev DB already has many clients). */
async function pickClientByCode(page: Page, code: string): Promise<void> {
  const picker = page.getByPlaceholder('Select a client…');
  await picker.click();
  await picker.fill(code);
  await page.getByRole('option', { name: new RegExp(code) }).click();
  await expect(page).toHaveURL(/[?&]clientId=\d+/);
}

/** Resolves a native `<select>` by its field label text (same convention as rateTypeAssignments.spec.ts). */
const selectByLabel = (page: Page, label: string) =>
  page.locator('label', { has: page.getByText(label, { exact: true }) }).getByRole('combobox');

/**
 * Creates a client through the hub's own "+ New client" round-trip (ADR-0092 S2): the button navigates
 * to `/admin/clients?returnTo=…`; the Clients page is the shared `MasterDataCrud` inline-grid (ADR-0051)
 * — "+ Add row" opens a create row, Code/Name are click-to-edit cells, and the row's own Save button
 * (not a form submit) persists it. The "← Back to Client Setup" banner (only rendered because of the
 * `returnTo` query param) then returns to the hub — still with no client picked (the return URL was
 * built before this client existed), so the caller picks it via {@link pickClientByCode}.
 */
async function createClientViaHub(page: Page, code: string, name: string): Promise<void> {
  await page.goto('/admin/client-setup');
  await page.getByRole('button', { name: '+ New client' }).click();
  await expect(page).toHaveURL(/\/admin\/clients\?returnTo=/);

  await page.getByRole('button', { name: /Add row/i }).click();
  await page.locator('td[data-label="Code"]').first().getByRole('textbox').fill(code);
  await page.locator('td[data-label="Name"]').first().getByRole('textbox').fill(name);
  const created = page.waitForResponse(
    (r) => r.url().includes('/api/v2/clients') && r.request().method() === 'POST' && r.status() === 201,
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await created;

  await page.getByRole('link', { name: '← Back to Client Setup' }).click();
  await expect(page).toHaveURL(/\/admin\/client-setup/);
}

/**
 * Builds a minimal onboarding workbook (ADR-0092 S4/S5): one Products row (a brand-new product code)
 * and one CPV row linking that product to the client with a blank Unit Code (= Universal, ADR-0074).
 * A sheet the runner doesn't find in the uploaded file reports zero rows rather than erroring
 * (`apps/api/.../clients/onboarding.ts`), so RateTypeAssignments/Rates/CommissionRates are omitted —
 * this is the smallest file that exercises preview (Products valid, CPV pending-on-its-own-Products-row)
 * and confirm (both sheets import: CPV's phase-1 creates the client-product link this same request
 * needs, then the unit row itself). Headers are hardcoded (not imported from `@crm2/api` internals —
 * the web app never depends on API-internal modules) matching MASTER_IMPORT_COLUMNS /
 * WORKBOOK_CPV_IMPORT_COLUMNS verbatim.
 */
async function buildOnboardingWorkbook(opts: { clientCode: string; productCode: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const products = wb.addWorksheet('Products');
  products.addRow(['Code', 'Name', 'Effective From']);
  products.addRow([opts.productCode, `E2E Product ${opts.productCode}`, '']);

  const cpv = wb.addWorksheet('CPV');
  cpv.addRow(['Client Code', 'Product Code', 'Unit Code', 'Effective From']);
  cpv.addRow([opts.clientCode, opts.productCode, '', '']);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

test.describe('shell smoke', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Viewport-independent — checked once');

  test('"Client Setup" is the first Administration nav link and navigates to the hub', async ({ page }) => {
    await page.goto('/admin/clients');
    // Section renders the "Administration" heading then a sibling div holding the links —
    // walk to that sibling rather than assuming a fixed link count/order elsewhere in the file.
    const adminLinks = page
      .getByText('Administration', { exact: true })
      .locator('xpath=following-sibling::div[1]')
      .getByRole('link');
    await expect(adminLinks.first()).toHaveText('Client Setup');

    await adminLinks.first().click();
    await expect(page).toHaveURL(/\/admin\/client-setup$/);
    await expect(page.getByRole('heading', { name: 'Client Setup' })).toBeVisible();
  });

  test('empty state shows the pick-a-client prompt and the step chips are disabled', async ({ page }) => {
    await page.goto('/admin/client-setup');
    await expect(page.getByText('Pick or create a client to begin.')).toBeVisible();
    for (const label of STEP_LABELS) {
      await expect(page.getByRole('button', { name: new RegExp(label) })).toBeDisabled();
    }
  });

  test('picking a client puts clientId in the URL and enables the stepper', async ({ page }) => {
    await page.goto('/admin/client-setup');
    await pickFirstClient(page);

    await expect(page.getByText('Pick or create a client to begin.')).toBeHidden();
    for (const label of STEP_LABELS) {
      await expect(page.getByRole('button', { name: new RegExp(label) })).toBeEnabled();
    }
  });

  test('deep-link with an unknown clientId renders the empty state instead of crashing', async ({ page }) => {
    await page.goto('/admin/client-setup?clientId=999999&step=2');
    await expect(page.getByRole('heading', { name: 'Client Setup' })).toBeVisible();
    await expect(page.getByText('Pick or create a client to begin.')).toBeVisible();
    for (const label of STEP_LABELS) {
      await expect(page.getByRole('button', { name: new RegExp(label) })).toBeDisabled();
    }
  });
});

test.describe('responsive band', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Owns its own viewport loop below');

  test('no horizontal overflow at 320/768/1024/1440 with a client selected', async ({ page }) => {
    await page.goto('/admin/client-setup');
    await pickFirstClient(page);

    for (const width of BAND_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
    }
  });
});

/*
 * Journey A (ADR-0092 S6) — the hub UI end to end: create a client, link a product + enable a
 * Universal unit (step 1), assign a rate type (step 2). Every embedded page's grid is already scoped
 * to the hub's controlled client (`withClientFilter`, ADR-0092 S2), so a freshly-created row is the
 * only row shown — no extra searching needed to find it. Stops at step 2 (Rate types); Rates/Commission
 * rates are Journey B's territory here (the workbook covers CPV — the only step-1/2 dependency).
 */
test.describe('onboarding journey A: hub', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Journey checked once');

  test('create client → link product + enable unit → assign rate type → checklist reflects it', async ({
    page,
  }) => {
    const stamp = Date.now();
    const clientCode = `E2EHUBA${stamp}`;
    await createClientViaHub(page, clientCode, `E2E Hub Client A ${stamp}`);
    await pickClientByCode(page, clientCode);

    // Step 1 (Products & CPV units): the CpvPage create form — Client is read-only/pre-filled
    // (controlled), pick any existing product, leave Effective From blank (effective now).
    await selectByLabel(page, 'Product').selectOption({ index: 1 });
    const linked = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v2/client-products') && r.request().method() === 'POST' && r.status() === 201,
    );
    await page.getByRole('button', { name: 'Link product' }).click();
    await linked;

    // Expand the (only, client-scoped) row and enable the Universal unit via the sub-grid.
    const expandRow = page.getByRole('button', { name: 'Expand row' });
    await expect(expandRow).toBeVisible();
    await expandRow.click();
    const unitEnabled = page.waitForResponse(
      (r) => r.url().includes('/api/v2/cpv-units') && r.request().method() === 'POST' && r.status() === 201,
    );
    await page.getByRole('button', { name: 'Enable Universal (all units)' }).click();
    await unitEnabled;
    await expect(page.getByText('Universal (all units)')).toBeVisible();
    await expect(page.getByRole('button', { name: /Products & CPV units \(1 · 1\)/ })).toBeVisible();

    // Step 2 (Rate types): "+ New Assignment" carries the hub's client + a returnTo back to this step.
    await page.getByRole('button', { name: /Rate types/ }).click();
    await expect(page).toHaveURL(/[?&]step=2/);
    await page.getByRole('button', { name: '+ New Assignment' }).click();
    await expect(page).toHaveURL(/\/admin\/rate-type-assignments\/new\?/);
    await selectByLabel(page, 'Rate Type').selectOption({ index: 1 });
    const assigned = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v2/rate-type-assignments') &&
        r.request().method() === 'POST' &&
        r.status() === 201,
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await assigned;

    // Back at the hub, step 2 — the new (only) row is visible and the checklist chip is positive.
    await expect(page).toHaveURL(/\/admin\/client-setup\?clientId=\d+&step=2/);
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Rate types \(1\)/ })).toBeVisible();
  });
});

/*
 * Journey B (ADR-0092 S6) — the onboarding-workbook round trip: download the template (asserts the
 * request fires and succeeds), upload a filled-in workbook, preview, confirm, and see the checklist
 * counts move. Uses a separate fresh client + a brand-new product code so it never collides with
 * Journey A (or a prior run of itself).
 */
test.describe('onboarding journey B: workbook import', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Journey checked once');

  test('download template → upload a filled workbook → preview → confirm → checklist counts move', async ({
    page,
  }) => {
    const stamp = Date.now();
    const clientCode = `E2EHUBB${stamp}`;
    const productCode = `E2EPROD${stamp}`;
    await createClientViaHub(page, clientCode, `E2E Hub Client B ${stamp}`);
    await pickClientByCode(page, clientCode);

    // "Download workbook" fires GET .../onboarding-template — assert it round-trips 200 (no need to
    // parse the file; the modal's upload/preview/confirm path is exercised with our own buffer below).
    const templateReq = page.waitForResponse(
      (r) => /\/onboarding-template$/.test(r.url()) && r.request().method() === 'GET' && r.status() === 200,
    );
    await page.getByRole('button', { name: 'Download workbook' }).click();
    await templateReq;

    // "Import workbook" opens a modal (WorkbookImportModal) — scope every locator to it: its own
    // confirm button is also labelled "Import workbook", same text as the trigger behind the overlay.
    await page.getByRole('button', { name: 'Import workbook' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const workbook = await buildOnboardingWorkbook({ clientCode, productCode });
    await dialog.getByLabel('Upload filled workbook (.xlsx)').setInputFiles({
      name: 'onboarding.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: workbook,
    });

    // Preview: 5 per-sheet panels; Products' one row is immediately valid (a brand-new code), CPV's
    // is "pending" (it depends on the Products row landing first — see buildOnboardingWorkbook).
    await expect(dialog.getByText('✓ 1 valid', { exact: false })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Products', exact: true })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'CPV', exact: true })).toBeVisible();

    const confirmed = page.waitForResponse(
      (r) =>
        r.url().includes('-import?mode=confirm') && r.request().method() === 'POST' && r.status() === 200,
    );
    await dialog.getByRole('button', { name: 'Import workbook' }).click();
    await confirmed;

    // Result: both sheets imported (Products creates the product; CPV's phase-1 creates the missing
    // client-product link this same request needs, then the unit row itself — see onboarding.ts). The
    // checklist assertion below is the real correctness check (it only reads "1 · 1" if both landed).
    await expect(dialog.getByText('Imported:').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    // The hub's checklist re-derives from the same invalidated queries — step 1 now reads 1 link · 1 unit.
    await expect(page.getByRole('button', { name: /Products & CPV units \(1 · 1\)/ })).toBeVisible();
  });
});
