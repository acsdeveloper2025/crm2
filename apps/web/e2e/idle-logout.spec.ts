import { expect, test } from '@playwright/test';

/*
 * Idle auto-logout (ADR-0045) — real-browser regression for the warn-then-reset path, driven by
 * Playwright's mocked clock so the 9-min threshold is deterministic (no real waiting).
 *
 * Scope note (kept intentionally non-destructive so it's safe under the parallel viewport projects,
 * which all share one authenticated admin session):
 *   - This spec asserts the WARNING renders at the threshold and "Stay logged in" dismisses + resets.
 *     "Stay" is purely client-side (no /auth/me ping, no revoke), so it never touches the shared session.
 *   - The actual LOGOUT path (timeout / "Log out now" → revoke this session → login screen + reason
 *     banner) AND the realtime `auth:session_revoked` drop are verified live in the browser
 *     (revoke 200 + "Your session was ended." banner) and by the API integration tests.
 *   - FIELD_AGENT exemption (no timer at all) is covered by the API integration test (login → null
 *     idleLogoutMinutes) and the sessionManager unit test (null config ⇒ never starts).
 *
 * The viewport projects authenticate as the seed admin (SUPER_ADMIN) — a DESK role that IS subject to
 * idle-logout (idle 10 min, warn at 9) — so no extra fixture is needed here.
 */
test('DESK user is warned at the idle threshold and "Stay logged in" resets the timer', async ({ page }) => {
  await page.clock.install({ time: new Date() });
  // The saved auth state carries a stale acs.lastActivity from the setup login; clear it on load so
  // the poll below waits for THIS session's manager to arm (not the stale value).
  await page.addInitScript(() => localStorage.removeItem('acs.lastActivity'));
  await page.goto('/');
  // Shell rendered ⇒ the idle manager has mounted + armed for this DESK user. "Account menu" is in
  // the header at every viewport width (unlike the sidebar toggle, which flips open/collapse label).
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible({ timeout: 15_000 });
  // Wait until the manager has armed (it stamps acs.lastActivity on init) so its 1s poll is running
  // under the mocked clock before we fast-forward — otherwise fastForward can race the arm.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('acs.lastActivity')), { timeout: 10_000 })
    .not.toBeNull();

  // 9 min of inactivity → the warning modal (warn at 9, hard logout at 10). runFor fires every 1s
  // poll tick (fastForward can collapse interval firings and miss the warn tick).
  await page.clock.runFor('09:05');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText(/signed out/i);

  // "Stay logged in" dismisses the warning and resets the idle clock.
  await page.getByRole('button', { name: 'Stay logged in' }).click();
  await expect(dialog).toBeHidden();

  // Well short of the threshold again after the reset → still no warning.
  await page.clock.runFor('05:00');
  await expect(dialog).toBeHidden();
});
