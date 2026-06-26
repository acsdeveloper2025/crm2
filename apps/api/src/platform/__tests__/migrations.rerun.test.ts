import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

/**
 * Guardrail for the project's most-bitten prod hazard, now enforced via the tracked runner
 * (db/v2/migrate.sh): the deploy applies each migration EXACTLY ONCE (recorded in `schema_migrations`)
 * and never raw-replays the full set, so a late migration that DROPs a column an earlier one references
 * (e.g. 0097 dropping `verification_units.kind`, which 0086 reads) can no longer break a re-run — the
 * `0037`/`0083` trap is structurally gone. Here we drive the REAL runner 3× against a fresh scratch DB and
 * assert it applies the full set cleanly once, SKIPS every migration on re-invocation, and the schema
 * converges (rate-type FK columns/constraints, kind dropped, no resurrected pre-rename columns).
 */
const RUN = !!process.env['DATABASE_URL'];
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '../../../../../db/v2/migrate.sh');
const MIGRATIONS_DIR = resolve(HERE, '../../../../../db/v2/migrations');
const sh = promisify(execFile);

const baseName = (url: string): string => new URL(url).pathname.replace(/^\//, '');
function withDbName(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

describe.skipIf(!RUN)('migrations re-run safety (tracked runner applies once, skips thereafter)', () => {
  it('runs the full migration set via migrate.sh 3× cleanly and converges the schema', async () => {
    const url = process.env['DATABASE_URL']!;
    const scratch = `${baseName(url)}_rerun_${randomBytes(5).toString('hex')}`;
    const scratchUrl = withDbName(url, scratch);
    const emptySeed = mkdtempSync(join(tmpdir(), 'crm2-rerun-seed-')); // skip the heavy data seeds

    const admin = new Pool({ connectionString: url, max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${scratch}"`);
    } finally {
      await admin.end();
    }

    const pool = new Pool({ connectionString: scratchUrl });
    try {
      // pass 1 applies every migration (fresh DB → no backfill); passes 2-3 must SKIP every one cleanly.
      for (let pass = 1; pass <= 3; pass++) {
        const { stdout } = await sh('sh', [SCRIPT], {
          env: { ...process.env, DATABASE_URL: scratchUrl, MIGRATIONS_DIR, SEED_DIR: emptySeed },
        });
        if (pass > 1) expect(stdout, `deploy ${pass} should skip the unchanged set`).toContain('0 applied,');
      }

      // ADR-0070: verification_units.kind is dropped (0097) and stays dropped across the re-runs.
      const { rows: kindCol } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_name = 'verification_units' AND column_name = 'kind'`,
      );
      expect(kindCol[0]!.n).toBe(0);

      // ADR-0068 Phase C: the FK conversion DROPS the 3 old string columns in place (mig 0094) — only
      // `rate_type_id` remains. `task_assignment_history.field_rate_type` is an append-only audit varchar — KEPT.
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

      // The billing/commission no-overlap integrity guards must be present.
      const { rows: cons } = await pool.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conname IN ('rates_no_overlap', 'commission_rates_no_overlap') ORDER BY conname`,
      );
      expect(cons.map((c) => c.conname)).toEqual(['commission_rates_no_overlap', 'rates_no_overlap']);

      // ADR-0064 Phase A: rate_types gains name/description/category/version + a single OFFICE row.
      const { rows: rtCols } = await pool.query<{ cols: string }>(
        `SELECT string_agg(column_name, ',' ORDER BY column_name) AS cols
           FROM information_schema.columns WHERE table_name = 'rate_types'`,
      );
      for (const c of ['category', 'description', 'name', 'version']) expect(rtCols[0]!.cols).toContain(c);
      const { rows: office } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM rate_types WHERE code = 'OFFICE' AND category = 'OFFICE'`,
      );
      expect(office[0]!.n).toBe('1');

      // ADR-0067 Phase B: rate_type_assignments + its UNIQUE constraint + partial index exist.
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

      // ADR-0069: product_id/verification_unit_id are NULLABLE (NULL = Universal) with a NULLS NOT DISTINCT key.
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

      // ADR-0068 Phase C: the rate_type_id FKs exist (catalog stability — not dropped+recreated each deploy).
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
      rmSync(emptySeed, { recursive: true, force: true });
      const admin2 = new Pool({ connectionString: url, max: 1 });
      try {
        await admin2.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
      } finally {
        await admin2.end();
      }
    }
  }, 180_000);
});
