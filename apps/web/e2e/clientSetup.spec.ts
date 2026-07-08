import { test, expect } from '@playwright/test';

/*
 * Client Setup hub (ADR-0092 S1) — shell smoke: nav entry, client picker, deep-link safety, and the
 * responsive band. (a)-(d) are viewport-independent (checked once at Laptop, same convention as
 * rateTypeAssignments.spec.ts / layout.spec.ts); (e) owns its own 320/768/1024/1440 loop per the
 * RESPONSIVE_DESIGN_STANDARD band minimums (distinct from viewport.spec.ts's four projects).
 */
const LAPTOP_WIDTH = 1280;
const STEP_LABELS = ['Products & CPV units', 'Rate types', 'Rates', 'Commission rates'];
const BAND_WIDTHS = [320, 768, 1024, 1440];
const OVERFLOW_TOLERANCE_PX = 1;

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
    await page.getByPlaceholder('Select a client…').click();
    const options = page.getByRole('option');
    if ((await options.count()) === 0) {
      test.skip(true, 'dev DB has no clients to pick from — nothing to assert for this leg');
    }
    await options.first().click();

    await expect(page).toHaveURL(/[?&]clientId=\d+/);
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
    await page.getByPlaceholder('Select a client…').click();
    const options = page.getByRole('option');
    if ((await options.count()) === 0) {
      test.skip(true, 'dev DB has no clients to pick from — nothing to assert for this leg');
    }
    await options.first().click();
    await expect(page).toHaveURL(/[?&]clientId=\d+/);

    for (const width of BAND_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
    }
  });
});
