import { loadTokensValidAfter, setTokensValidAfter } from './repository.js';

/**
 * Access-token kill switch (ADR-0076 Phase 2). Access tokens are stateless 15-min JWTs; this gives a
 * per-user "valid-after" cutoff so a user-wide revoke kills live access tokens immediately instead of
 * waiting out their TTL. authenticate() (REST) and the socket handshake both reject a token whose
 * `iat` predates the cutoff. (Layering: realtime depends on this module for the handshake check, so this
 * module must NOT depend on realtime — the live-socket force-disconnect is done at the service sites.)
 *
 * The cutoff is read on every authenticated request, so it is cached in-process with the same short TTL
 * as the role cache; a revoke busts the user's entry for instant effect on this instance. The cutoff is
 * a DURABLE column (not a cache) — a read error propagates (fail-closed: a DB outage already fails every
 * request) rather than silently allowing a revoked token through.
 */
const CACHE_TTL_MS = 5_000;
const MS_PER_S = 1000;

interface Entry {
  /** whole-second epoch cutoff, or null when the user has never been revoked */
  cutoff: number | null;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

async function getCutoff(userId: string): Promise<number | null> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.cutoff;
  const ts = await loadTokensValidAfter(userId);
  const cutoff = ts === null ? null : Math.floor(new Date(ts).getTime() / MS_PER_S);
  cache.set(userId, { cutoff, expiresAt: Date.now() + CACHE_TTL_MS });
  return cutoff;
}

/**
 * True when an access token (issued at `tokenIatSeconds`) was killed by a user-wide revoke. Strict `<`
 * with whole-second granularity: a token minted in the SAME second as the revoke survives, so a
 * legitimate re-login immediately after a revoke is never self-killed (≤1s exposure, accepted).
 */
export async function isAccessRevoked(userId: string, tokenIatSeconds: number): Promise<boolean> {
  const cutoff = await getCutoff(userId);
  return cutoff !== null && tokenIatSeconds < cutoff;
}

/**
 * Kill a user's live access tokens NOW (ADR-0076): stamp the durable cutoff and bust the cache so this
 * instance sees it on the next request. Call on every USER-WIDE revoke — never single-session revoke
 * (device-scoped; its access token dies at TTL). Pair with `getRealtime().disconnectUser(userId)` at
 * the call site to also drop the user's live sockets.
 */
export async function revokeUserAccessTokens(userId: string): Promise<void> {
  await setTokensValidAfter(userId);
  cache.delete(userId);
}
