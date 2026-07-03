import { test, expect } from '@playwright/test';

/*
 * Shared Tabs (components/ui/Tabs.tsx) — WAI-ARIA APG horizontal tablist (KN-5). Previously every tab
 * was a normal Tab-stop with no arrow-key support. It must now use roving tabindex (only the selected
 * tab is a tab stop) and Arrow Left/Right (wrapping) + Home/End to move focus AND activate. jsdom can't
 * do focus, so this lives in Playwright. /mis renders the Tabular/Summary view tabs. Checked once at Laptop.
 */
const LAPTOP_WIDTH = 1280;
test.skip(({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH, 'Tabs keyboard checked once');

test('Tabs: roving tabindex + Arrow/Home/End move focus and activate the tab', async ({ page }) => {
  await page.goto('/mis');
  const tablist = page.getByRole('tablist');
  await expect(tablist).toBeVisible();
  const tabs = tablist.getByRole('tab');
  const first = tabs.first();
  const second = tabs.nth(1);
  await expect(second).toBeVisible();

  // Roving tabindex: only the selected tab is a tab stop.
  await expect(first).toHaveAttribute('tabindex', '0');
  await expect(second).toHaveAttribute('tabindex', '-1');

  await first.focus();
  await expect(first).toBeFocused();

  // ArrowRight moves focus to the next tab AND activates it (automatic activation); roving updates.
  await page.keyboard.press('ArrowRight');
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(second).toHaveAttribute('tabindex', '0');
  await expect(first).toHaveAttribute('tabindex', '-1');

  // ArrowRight wraps back to the first tab.
  await page.keyboard.press('ArrowRight');
  await expect(first).toBeFocused();

  // Home / End jump to the ends.
  await page.keyboard.press('End');
  await expect(second).toBeFocused();
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
});
