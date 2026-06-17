import { test, expect } from '@playwright/test';

/*
 * App-shell (Layout) accessibility. Below the `lg` breakpoint the sidebar is a fixed overlay
 * drawer: it must trap focus and close on Escape (WCAG 2.1.2 / 2.4.3). At `lg+` it is `lg:static`
 * in-flow navigation, so the trap MUST stay inert — that desktop carve-out is implicitly guarded by
 * every Laptop-band datagrid/a11y test (a trap there would break their Tab/focus flows).
 */
const LAPTOP_WIDTH = 1280;
test.skip(
  ({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH,
  'self-resizes to a phone width — checked once at the Laptop band',
);

test('mobile nav drawer: traps focus on open, Escape closes it and restores focus to the hamburger', async ({
  page,
}) => {
  await page.goto('/admin/clients');
  // Shrink below lg so the hamburger opens the sidebar as an overlay drawer, not the in-flow nav.
  await page.setViewportSize({ width: 390, height: 844 });

  const hamburger = page.getByRole('button', { name: 'Open menu' });
  await hamburger.click();

  // Focus moves into the drawer — the trap lands on its first focusable, the in-drawer close button.
  await expect(page.getByRole('button', { name: 'Collapse menu' })).toBeFocused();

  // Escape (onEscape = close) dismisses the drawer and returns focus to the opener.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'CPV Mapping' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
});
