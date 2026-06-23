import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/*
 * CI gate 29: automated accessibility (axe) on every page. WCAG 2.0/2.1 A + AA
 * rules. The gate fails on any SERIOUS or CRITICAL violation. The contrast
 * remediation (2026-06-06) darkened the muted-foreground + in-progress/approved/
 * revisit status tokens to ≥4.5:1 and marked the inactive Operations nav items
 * aria-disabled (WCAG 1.4.3 inactive-component exemption), clearing the last
 * serious findings (E-5). Runs once per page at the Laptop band — these violations
 * are viewport-independent.
 */
const GATED_IMPACTS = new Set(['serious', 'critical']);
const LAPTOP_WIDTH = 1280;
const A11Y_TIMEOUT_MS = 90_000; // axe DOM analysis needs headroom on heavy pages under parallel load

const PAGES: { name: string; path: string }[] = [
  { name: 'Clients', path: '/admin/clients' },
  { name: 'Products', path: '/admin/products' },
  { name: 'Verification Units', path: '/admin/verification-units' },
  { name: 'Users', path: '/admin/users' },
  // Location Management is deliberately omitted: its 157k-row pincode catalog makes a
  // full axe DOM analysis prohibitively slow/flaky, and its a11y surface uses the same
  // table/filter components already scanned on the other admin pages. It stays covered
  // by viewport.spec for the responsive (overflow/nav) gate.
  { name: 'Rate Management', path: '/admin/rates' },
  { name: 'CPV Mapping', path: '/admin/cpv' },
  { name: 'Templates', path: '/admin/templates' },
  { name: 'Access Control', path: '/admin/rbac' },
  { name: 'System', path: '/admin/system' },
  { name: 'Cases', path: '/cases' },
  { name: 'New Case', path: '/cases/new' },
  // /cases/:id (case detail) is deliberately omitted: axe needs a concrete, seeded case id,
  // which varies by database. Its rich button/dialog surface reuses the same primitives
  // (Button/StatusChip/DataGrid/dialogs) already scanned on the pages above.
  { name: 'Pipeline', path: '/pipeline' },
  { name: 'Dedupe', path: '/dedupe' },
  { name: 'Field Monitoring', path: '/field-monitoring' },
  { name: 'Billing', path: '/billing' },
  { name: 'Commission Rates', path: '/admin/commission-rates' },
  { name: 'MIS Layouts', path: '/admin/report-layouts' },
  { name: 'Departments', path: '/admin/departments' },
  { name: 'Designations', path: '/admin/designations' },
  { name: 'Policies', path: '/admin/policies' },
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Profile', path: '/profile' },
  { name: 'Security', path: '/security' },
];

test.skip(
  ({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH,
  'a11y is viewport-independent — checked once at the Laptop band',
);

/** Run axe over the current DOM and assert no serious/critical WCAG 2.0/2.1 A+AA violations. */
async function expectNoGatedViolations(page: import('@playwright/test').Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const fmt = (v: (typeof results.violations)[number]) =>
    `${v.impact} · ${v.id} (${v.nodes.length}) — ${v.help}`;
  const gated = results.violations.filter((v) => GATED_IMPACTS.has(v.impact ?? ''));
  expect(gated, `serious/critical a11y violations on ${label}:\n${gated.map(fmt).join('\n')}`).toEqual([]);
}

for (const spec of PAGES) {
  test(`${spec.name} has no serious/critical a11y violations`, async ({ page }) => {
    test.setTimeout(A11Y_TIMEOUT_MS); // the Locations catalog renders enough rows that axe needs headroom
    await page.goto(spec.path);
    await expect(page.getByRole('button', { name: /(open|collapse) menu/i })).toBeVisible();
    await expectNoGatedViolations(page, spec.name);
  });
}

// The per-page loop above only scans CLOSED pages. These two scan OPEN overlays (a modal dialog and
// the mobile nav drawer) — the focus-trapped surfaces are otherwise never axe-checked open.
test('an open modal dialog has no serious/critical a11y violations', async ({ page }) => {
  // Every master-data add/edit surface is now inline-grid or a record-page route (ADR-0051 — no modal).
  // The bulk-Import modal (on every master-data list, not a D4 target) is the stable focus-trapped
  // overlay to axe-scan while open.
  await page.goto('/admin/clients');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Import clients' })).toBeVisible();
  await expectNoGatedViolations(page, 'Import dialog (open)');
});

test('the open mobile nav drawer has no serious/critical a11y violations', async ({ page }) => {
  await page.goto('/admin/clients');
  // Below lg the sidebar is a fixed overlay drawer (focus-trapped); resize the Laptop page to a phone
  // width so the hamburger opens it as an overlay rather than the in-flow desktop nav.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /open menu/i }).click();
  await expect(page.getByRole('link', { name: 'CPV Mapping' })).toBeVisible();
  await expectNoGatedViolations(page, 'mobile nav drawer (open)');
});
