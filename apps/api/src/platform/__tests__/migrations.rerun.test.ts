import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

/**
 * Guardrail for the project's most-bitten prod hazard. The deploy runner (db/v2/migrate.sh) now applies
 * only NEW or EDITED migrations (tracked in `schema_migrations`), but idempotency is STILL required: (a)
 * the first deploy after the runner lands replays the full set once, and (b) an EDITED migration
 * re-applies — so a late migration that RENAMEs a column or DROP+ADDs a CHECK can still break an earlier
 * one when it re-executes. Exactly the `0037` (status CHECK) and `0083` (rate-type rename) incidents. The
 * per-file test harness builds its template by applying each migration ONCE, so it can't catch this. Here
 * we simulate THREE consecutive full applies against a fresh scratch DB and assert the set re-applies
 * cleanly and the schema converges (no resurrected pre-rename columns).
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

      // ADR-0068 Phase C: the FK conversion DROPS the 3 old string columns in place (mig 0094). After a
      // full 3× re-run the old `client_rate_type`/`field_rate_type` columns must stay GONE and only
      // `rate_type_id` remains — every earlier migration that (re)creates the old columns (0011/0013/0079/
      // 0083/0084) must no-op once the FK exists, or a re-run resurrects them (the 0037/0083 trap).
      // `task_assignment_history.field_rate_type` is an append-only audit varchar — NOT converted, KEPT.
      const { rows } = await pool.query<{ table_name: string; cols: string }>(
        `SELECT table_name, string_agg(column_name, ',' ORDER BY column_name) AS cols
           FROM information_schema.columns
          WHERE table_name IN ('rates', 'case_tasks', 'commission_rates', 'task_assignment_history')
            AND (column_name LIKE '%rate_type%' OR column_name = 'distance_band')
          GROUP BY table_name`,
      );
      const byTable = Object.fromEntries(rows.map((r) => [r.table_name, r.cols]));
      expect(byTable['rates']).toBe('rate_type_id');
      expect(byTable['case_tasks']).toBe('rate_type_id');
      expect(byTable['commission_rates']).toBe('rate_type_id');
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

      // ADR-0067 Phase B: rate_type_assignments + its UNIQUE constraint + partial index must survive
      // the 3× re-run (idempotent CREATE TABLE IF NOT EXISTS / guarded constraint / CREATE INDEX IF NOT EXISTS).
      const { rows: rta } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM information_schema.tables WHERE table_name = 'rate_type_assignments'`,
      );
      expect(rta[0]!.n).toBe('1');
      const { rows: rtaUq } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_constraint WHERE conname = 'uq_rate_type_assignment'`,
      );
      expect(rtaUq[0]!.n).toBe('1');
      const { rows: rtaIdx } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_indexes WHERE indexname = 'idx_rta_combo'`,
      );
      expect(rtaIdx[0]!.n).toBe('1');

      // ADR-0069: product_id/verification_unit_id become NULLABLE (NULL = Universal) and the unique key is
      // NULLS NOT DISTINCT (so a Universal NULL row is a single value the bulk upsert dedupes). Survive 3×.
      const { rows: rtaNull } = await pool.query<{ cols: string }>(
        `SELECT string_agg(column_name, ',' ORDER BY column_name) AS cols
           FROM information_schema.columns
          WHERE table_name = 'rate_type_assignments' AND is_nullable = 'YES'
            AND column_name IN ('product_id', 'verification_unit_id')`,
      );
      expect(rtaNull[0]!.cols).toBe('product_id,verification_unit_id');
      const { rows: rtaNnd } = await pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'uq_rate_type_assignment'`,
      );
      expect(rtaNnd[0]!.def).toContain('NULLS NOT DISTINCT');

      // ADR-0068 Phase C: the rate_type_id FKs must SURVIVE the 3× re-run. This also proves the catalog is
      // NOT dropped+recreated each deploy: 0013's unconditional `DROP TABLE rate_types CASCADE` (now
      // guarded on rate_types.category) would CASCADE-drop these FKs, and 0094's `ADD COLUMN IF NOT EXISTS`
      // would NOT re-create them (column already present) — so their survival is the catalog-stability proof.
      const { rows: fks } = await pool.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint WHERE contype = 'f' AND conname IN
           ('rates_rate_type_id_fkey', 'commission_rates_rate_type_id_fkey', 'case_tasks_rate_type_id_fkey')
         ORDER BY conname`,
      );
      expect(fks.map((f) => f.conname)).toEqual([
        'case_tasks_rate_type_id_fkey',
        'commission_rates_rate_type_id_fkey',
        'rates_rate_type_id_fkey',
      ]);
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
