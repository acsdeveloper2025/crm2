import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDb } from '@crm2/test-utils';
import { query, setPool } from '../../../platform/db.js';

// `query` (platform/db) camelizes result rows, so information_schema columns come back as
// `columnName`/`isNullable`. The test DB harness applies every migration in db/v2/migrations on
// migrate(), so 0079 is exercised here end-to-end against an ephemeral Postgres clone.
const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;

describe.skipIf(!RUN)('0079 commission_rates dimensions', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });

  it('has the four new dimension columns, all nullable', async () => {
    const cols = await query<{ columnName: string; isNullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'commission_rates' AND column_name = ANY($1)`,
      [['location_id', 'product_id', 'verification_unit_id', 'tat_band']],
    );
    expect(cols.map((c) => c.columnName).sort()).toEqual([
      'location_id',
      'product_id',
      'tat_band',
      'verification_unit_id',
    ]);
    expect(cols.every((c) => c.isNullable === 'YES')).toBe(true);
  });

  it('field_rate_type is now nullable', async () => {
    const [rt] = await query<{ isNullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'commission_rates' AND column_name = 'field_rate_type'`,
    );
    expect(rt?.isNullable).toBe('YES');
  });

  it('no-overlap EXCLUDE rejects a duplicate (user,location,client,product,vu,band) period but allows a different location', async () => {
    // Idempotent across vitest `retry` (config sets retry:2; retries reuse this file's DB clone):
    // upsert the user and clear any rows a prior attempt inserted, so each attempt starts clean.
    const [u] = await query<{ id: string }>(
      `INSERT INTO users (username, name, role)
       VALUES ('mig79', 'Mig 79', 'SUPER_ADMIN')
       ON CONFLICT (username) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
    const uid = u!.id;
    await query(`DELETE FROM commission_rates WHERE user_id = $1`, [uid]);

    // location_id now carries a real FK to locations(id), so seed a real (generated-id) row.
    const [loc] = await query<{ id: number }>(
      `INSERT INTO locations (pincode, area, city, state)
       VALUES ('560079', 'MIG79 AREA', 'Bengaluru', 'Karnataka')
       ON CONFLICT (pincode, area) DO UPDATE SET city = EXCLUDED.city RETURNING id`,
    );
    const locId = loc!.id;

    const ins = (location: number | null): Promise<unknown[]> =>
      query(`INSERT INTO commission_rates (user_id, location_id, amount) VALUES ($1, $2, 10)`, [
        uid,
        location,
      ]);

    await ins(null); // location-less base
    await ins(locId); // different location -> no overlap, OK
    await expect(ins(locId)).rejects.toMatchObject({ code: '23P01' }); // same tuple+period -> reject
  });
});
