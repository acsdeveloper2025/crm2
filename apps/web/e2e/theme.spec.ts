import { test, expect } from '@playwright/test';

/*
 * Dark-mode toggle (ADR-0008 dark palette, exposed by lib/theme + the header ThemeToggle).
 * The full dark token set already exists; this verifies the user-facing switch: it flips the
 * `.dark` class on <html> (which drives the token swap) and persists the choice across reloads.
 * Theme is global, so check once at the Laptop band (mirrors layout.spec).
 */
const LAPTOP_WIDTH = 1280;
test.skip(
  ({ viewport }) => (viewport?.width ?? 0) !== LAPTOP_WIDTH,
  'theme toggle is global — checked once at the Laptop band',
);

test('dark-mode toggle flips the theme and persists across reloads', async ({ page }) => {
  await page.goto('/dashboard');
  const html = page.locator('html');

  // Default (no stored pref, light system) — no dark class.
  await expect(html).not.toHaveClass(/\bdark\b/);

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(html).toHaveClass(/\bdark\b/);

  // Persisted to localStorage → survives a reload.
  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);

  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
});
