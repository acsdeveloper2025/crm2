import { query } from '../db.js';

/**
 * Raw access to `users.tokens_valid_after` — the access-token kill-switch cutoff (ADR-0076 Phase 2).
 * Kept in a repository (the only place raw SQL is allowed) and read/written via the cache in
 * `../tokenRevocation/index.ts`.
 */

/** The per-user cutoff (whole-second timestamptz), or null when the user has never been revoked. */
export async function loadTokensValidAfter(userId: string): Promise<Date | null> {
  const rows = await query<{ tokensValidAfter: Date | null }>(
    `SELECT tokens_valid_after FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.tokensValidAfter ?? null;
}

/** Stamp the cutoff at the current whole second — invalidates every access token issued before now. */
export async function setTokensValidAfter(userId: string): Promise<void> {
  await query(`UPDATE users SET tokens_valid_after = date_trunc('second', now()) WHERE id = $1`, [userId]);
}
