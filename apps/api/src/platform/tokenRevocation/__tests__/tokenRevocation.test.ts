import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb } from '@crm2/test-utils';
import { setPool } from '../../db.js';
import { isAccessRevoked, revokeUserAccessTokens } from '../index.js';

/** Access-token kill switch (ADR-0076 Phase 2) — the security-critical comparison + write + cache. */
const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;

const U1 = '00000000-0000-0000-0000-0000000000c1';
const U2 = '00000000-0000-0000-0000-0000000000c2';
const U3 = '00000000-0000-0000-0000-0000000000c3';

async function seedUser(id: string, username: string): Promise<void> {
  await db!.pool.query(
    `INSERT INTO users (id, username, name, role) VALUES ($1, $2, $2, 'MANAGER') ON CONFLICT (id) DO NOTHING`,
    [id, username],
  );
}

describe.skipIf(!RUN)('access-token kill switch (ADR-0076)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate('auth_refresh_tokens', 'users');
  });

  it('a cutoff kills tokens issued STRICTLY before it; same-second or later survive', async () => {
    await seedUser(U1, 'kill1');
    await db!.pool.query(`UPDATE users SET tokens_valid_after = to_timestamp(1000) WHERE id = $1`, [U1]);
    expect(await isAccessRevoked(U1, 999)).toBe(true); // issued before the cutoff second → killed
    expect(await isAccessRevoked(U1, 1000)).toBe(false); // same second → survives (no re-login self-kill)
    expect(await isAccessRevoked(U1, 1001)).toBe(false); // issued after → survives
  });

  it('no cutoff → never revoked', async () => {
    await seedUser(U2, 'kill2');
    expect(await isAccessRevoked(U2, 1)).toBe(false);
  });

  it('revokeUserAccessTokens stamps the cutoff and busts the cache (a prior token is killed)', async () => {
    await seedUser(U3, 'kill3');
    const nowSec = Math.floor(Date.now() / 1000);
    expect(await isAccessRevoked(U3, nowSec)).toBe(false); // caches "no cutoff"
    await revokeUserAccessTokens(U3); // sets cutoff = now(), busts the cache
    expect(await isAccessRevoked(U3, nowSec - 5)).toBe(true); // a 5s-old token is now killed (cache busted)
  });
});
