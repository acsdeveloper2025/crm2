import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

/**
 * Guardrail for the project's most-bitten prod hazard: the deploy migrate step RE-RUNS every migration
 * in `db/v2/migrations` on EVERY deploy (it is a one-shot replay, not a tracked "apply once"). So a late
 * migration that RENAMEs a column or DROP+ADDs a CHECK can silently break an EARLIER migration that
 * re-executes verbatim on the next deploy — exactly the `0037` (status CHECK) and `0083` (rate-type
 * rename) incidents. The per-file test harness builds its template by applying each migration ONCE, so it
 * can't catch this. Here we simulate THREE consecutive deploys against a fresh scratch DB and assert the
 * full set re-applies cleanly and the schema converges (no resurrected pre-rename columns).
 */
const RUN = !!process.env['DATABASE_URL'];
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '../../../../../db/v2/migrations');

const baseName = (url: string): string => new URL(url).pathname.replace(/^\//, '');
function withDbName(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

describe.skipIf(!RUN)('migrations re-run safety (prod re-applies the full set every deploy)', () => {
  it('applies the entire migration set 3× without error and leaves no resurrected rate-type columns', async () => {
    const url = process.env['DATABASE_URL']!;
    const scratch = `${baseName(url)}_rerun_${randomBytes(5).toString('hex')}`;
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const sql = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));

    const admin = new Pool({ connectionString: url, max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${scratch}"`);
    } finally {
      await admin.end();
    }

    const pool = new Pool({ connectionString: withDbName(url, scratch) });
    try {
      for (let pass = 1; pass <= 3; pass++) {
        for (let i = 0; i < files.length; i++) {
          // Each .sql is its own BEGIN;…COMMIT; — a non-idempotent statement throws here, naming the file.
          await expect(pool.query(sql[i]!), `deploy ${pass}, migration ${files[i]}`).resolves.toBeDefined();
        }
      }

      // The two rate-type renames (0083) must leave NO pre-rename column behind after a full re-run:
      // every earlier migration that adds `rate_type` / `distance_band` must no-op once renamed.
      const { rows } = await pool.query<{ table_name: string; cols: string }>(
        `SELECT table_name, string_agg(column_name, ',' ORDER BY column_name) AS cols
           FROM information_schema.columns
          WHERE table_name IN ('rates', 'case_tasks', 'commission_rates', 'task_assignment_history')
            AND (column_name LIKE '%rate_type%' OR column_name = 'distance_band')
          GROUP BY table_name`,
      );
      const byTable = Object.fromEntries(rows.map((r) => [r.table_name, r.cols]));
      expect(byTable['rates']).toBe('client_rate_type');
      expect(byTable['case_tasks']).toBe('field_rate_type');
      expect(byTable['commission_rates']).toBe('field_rate_type');
      expect(byTable['task_assignment_history']).toBe('field_rate_type');

      // The billing/commission no-overlap integrity guards must survive the re-run.
      const { rows: cons } = await pool.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conname IN ('rates_no_overlap', 'commission_rates_no_overlap') ORDER BY conname`,
      );
      expect(cons.map((c) => c.conname)).toEqual(['commission_rates_no_overlap', 'rates_no_overlap']);

      // ADR-0064 Phase A: rate_types gains name/description/category/version and an OFFICE row,
      // and must survive the 3× re-run unchanged (idempotent ADD COLUMN + ON CONFLICT seed).
      const { rows: rtCols } = await pool.query<{ cols: string }>(
        `SELECT string_agg(column_name, ',' ORDER BY column_name) AS cols
           FROM information_schema.columns WHERE table_name = 'rate_types'`,
      );
      for (const c of ['category', 'description', 'name', 'version']) expect(rtCols[0]!.cols).toContain(c);
      const { rows: office } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM rate_types WHERE code = 'OFFICE' AND category = 'OFFICE'`,
      );
      expect(office[0]!.n).toBe('1'); // exactly one OFFICE row after three deploys (ON CONFLICT no-dupe)
    } finally {
      await pool.end();
      const admin2 = new Pool({ connectionString: url, max: 1 });
      try {
        await admin2.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
      } finally {
        await admin2.end();
      }
    }
  }, 180_000);
});
