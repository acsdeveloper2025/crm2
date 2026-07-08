import { test, expect, type Page } from '@playwright/test';

/*
 * CI gate 49: every page has no horizontal overflow + a reachable nav trigger and
 * primary action across the four supported bands (rendered at 375/768/1280/1440 —
 * the standard's device sizes; the band minimums are 320/768/1024/1440). Runs once
 * per viewport project. `card`
 * pages additionally assert the table→card transform on mobile (<md) — each cell
 * becomes a stacked, labelled row (RESPONSIVE_DESIGN_STANDARD §"Table strategy").
 */
const TABLET_MIN_WIDTH = 768;
const OVERFLOW_TOLERANCE_PX = 1;

interface PageSpec {
  name: string;
  path: string;
  primary?: RegExp;
  card?: boolean;
}

const PAGES: PageSpec[] = [
  { name: 'Client Setup', path: '/admin/client-setup' },
  { name: 'Clients', path: '/admin/clients', primary: /Add row/, card: true },
  { name: 'Products', path: '/admin/products', primary: /Add row/, card: true },
  { name: 'Verification Units', path: '/admin/verification-units', primary: /New/, card: true },
  { name: 'Users', path: '/admin/users', primary: /New/, card: true },
  { name: 'Location Management', path: '/admin/locations', card: true },
  { name: 'Rate Management', path: '/admin/rates', card: true },
  { name: 'CPV Mapping', path: '/admin/cpv', card: true },
  { name: 'Access Control', path: '/admin/rbac' },
  { name: 'System', path: '/admin/system' },
  { name: 'Cases', path: '/cases', primary: /New/, card: true },
  { name: 'New Case', path: '/cases/new', primary: /Create Case/ },
  { name: 'Pipeline', path: '/pipeline', card: true },
  { name: 'Dedupe', path: '/dedupe' },
  { name: 'Field Monitoring', path: '/field-monitoring' },
  { name: 'Billing', path: '/billing', card: true },
  { name: 'Commission Rates', path: '/admin/commission-rates', primary: /New/, card: true },
  { name: 'Departments', path: '/admin/departments', primary: /Add row/, card: true },
  { name: 'Designations', path: '/admin/designations', primary: /Add row/, card: true },
  { name: 'Policies', path: '/admin/policies', primary: /New Policy/, card: true },
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Profile', path: '/profile' },
  { name: 'Security', path: '/security' },
];

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const spec of PAGES) {
  test(`${spec.name} is responsive`, async ({ page }) => {
    await page.goto(spec.path);
    // Wait for the list fetch to settle before the card-transform assertion below counts
    // rows — otherwise the grid may still be loading (0 cells) and the count check races.
    await page.waitForLoadState('networkidle');
    // Layout (hence the hamburger) only renders once the app shell mounts.
    const navTrigger = page.getByRole('button', { name: /(open|collapse) menu/i });
    await expect(navTrigger).toBeVisible();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

    if (spec.primary) {
      await expect(page.getByRole('button', { name: spec.primary }).first()).toBeVisible();
    }

    const isMobile = (page.viewportSize()?.width ?? 0) < TABLET_MIN_WIDTH;
    if (spec.card && isMobile) {
      // Assert the table→card transform only when the list has rows (an empty list —
      // e.g. a fresh CI database — has nothing to card; overflow + nav still hold).
      // Only LABELLED cells flatten to flex — `data-label=""` opt-out cells (the selection
      // checkbox / expander columns) stay block by design (index.css carve-out).
      const cells = page.locator('table.rtable > tbody > tr > td[data-label]:not([data-label=""])');
      if ((await cells.count()) > 0) {
        const cell = cells.first();
        await expect(cell).toBeVisible();
        // On mobile the responsive table flattens each cell into a labelled flex row.
        const display = await cell.evaluate((el) => getComputedStyle(el).display);
        expect(display).toBe('flex');
      }
    }
  });
}
