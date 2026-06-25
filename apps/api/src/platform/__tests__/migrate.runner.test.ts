import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

/**
 * Tests the tracked migration runner (db/v2/migrate.sh): it must apply only NEW or EDITED
 * migrations and skip the unchanged set — the fix for the every-deploy full replay. Drives the
 * REAL shell script against a scratch DB and a throwaway migrations dir, so the behaviour proven here
 * is exactly what runs on the box.
 */
const RUN = !!process.env['DATABASE_URL'];
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '../../../../../db/v2/migrate.sh');
const sh = promisify(execFile);

const baseName = (url: string): string => new URL(url).pathname.replace(/^\//, '');
function withDbName(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function runMigrate(dbUrl: string, migrationsDir: string, seedDir: string): Promise<string> {
  const { stdout } = await sh('sh', [SCRIPT], {
    env: { ...process.env, DATABASE_URL: dbUrl, MIGRATIONS_DIR: migrationsDir, SEED_DIR: seedDir },
  });
  return stdout;
}

describe.skipIf(!RUN)('tracked migration runner (only new/edited migrations apply)', () => {
  it('applies all once, skips unchanged, re-applies edited, applies added', async () => {
    const url = process.env['DATABASE_URL']!;
    const scratch = `${baseName(url)}_runner_${randomBytes(5).toString('hex')}`;
    const scratchUrl = withDbName(url, scratch);
    const migrationsDir = mkdtempSync(join(tmpdir(), 'crm2-migr-'));
    const seedDir = mkdtempSync(join(tmpdir(), 'crm2-seed-')); // empty → seeds skipped

    const admin = new Pool({ connectionString: url, max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${scratch}"`);
    } finally {
      await admin.end();
    }

    // Idempotent fixtures (an edited migration re-runs, so they must be safe to re-apply).
    writeFileSync(join(migrationsDir, '0001_a.sql'), `CREATE TABLE IF NOT EXISTS t_a (id int);`);
    writeFileSync(join(migrationsDir, '0002_b.sql'), `CREATE TABLE IF NOT EXISTS t_b (id int);`);

    const pool = new Pool({ connectionString: scratchUrl });
    const tableExists = async (t: string): Promise<boolean> =>
      (await pool.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [t])).rows[0].ok as boolean;
    const trackedCount = async (): Promise<number> =>
      Number((await pool.query(`SELECT count(*)::int n FROM schema_migrations`)).rows[0].n);

    try {
      // 1) fresh DB → both apply.
      const out1 = await runMigrate(scratchUrl, migrationsDir, seedDir);
      expect(out1).toContain('2 applied, 0 skipped');
      expect(await tableExists('t_a')).toBe(true);
      expect(await tableExists('t_b')).toBe(true);
      expect(await trackedCount()).toBe(2);

      // 2) nothing changed → both skip (this is the bug fix: no full replay).
      const out2 = await runMigrate(scratchUrl, migrationsDir, seedDir);
      expect(out2).toContain('0 applied, 2 skipped');

      // 3) edit 0002 → only it re-applies; its new statement takes effect.
      writeFileSync(
        join(migrationsDir, '0002_b.sql'),
        `CREATE TABLE IF NOT EXISTS t_b (id int);\nCREATE TABLE IF NOT EXISTS t_b2 (id int);`,
      );
      const out3 = await runMigrate(scratchUrl, migrationsDir, seedDir);
      expect(out3).toContain('1 applied, 1 skipped');
      expect(out3).toContain('re-apply (edited) 0002_b.sql');
      expect(await tableExists('t_b2')).toBe(true);
      expect(await trackedCount()).toBe(2); // still 2 tracked rows (0002 updated, not duplicated)

      // 4) add 0003 → only the new one applies.
      writeFileSync(join(migrationsDir, '0003_c.sql'), `CREATE TABLE IF NOT EXISTS t_c (id int);`);
      const out4 = await runMigrate(scratchUrl, migrationsDir, seedDir);
      expect(out4).toContain('1 applied, 2 skipped');
      expect(await tableExists('t_c')).toBe(true);
      expect(await trackedCount()).toBe(3);
    } finally {
      await pool.end();
      const admin2 = new Pool({ connectionString: url, max: 1 });
      try {
        await admin2.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
      } finally {
        await admin2.end();
      }
      rmSync(migrationsDir, { recursive: true, force: true });
      rmSync(seedDir, { recursive: true, force: true });
    }
  });

  it('backfills an already-migrated DB without replaying (transition safety)', async () => {
    const url = process.env['DATABASE_URL']!;
    const scratch = `${baseName(url)}_backfill_${randomBytes(5).toString('hex')}`;
    const scratchUrl = withDbName(url, scratch);
    const migrationsDir = mkdtempSync(join(tmpdir(), 'crm2-migr-'));
    const seedDir = mkdtempSync(join(tmpdir(), 'crm2-seed-'));

    const admin = new Pool({ connectionString: url, max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${scratch}"`);
    } finally {
      await admin.end();
    }

    const pool = new Pool({ connectionString: scratchUrl });
    const exists = async (t: string): Promise<boolean> =>
      (await pool.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [t])).rows[0].ok as boolean;
    try {
      // Simulate an existing/migrated DB: an app table is already present, tracking is empty.
      await pool.query(`CREATE TABLE already_here (id int)`);
      // A migration that WOULD fail if replayed against existing data (mirrors the 0064/0066 trap).
      writeFileSync(join(migrationsDir, '0001_x.sql'), `CREATE TABLE t_x (id int);`);

      const out = await runMigrate(scratchUrl, migrationsDir, seedDir);
      expect(out).toContain('backfilling');
      // Recorded as applied …
      expect(Number((await pool.query(`SELECT count(*)::int n FROM schema_migrations`)).rows[0].n)).toBe(1);
      // … but NOT executed (no replay) — the table the migration creates must NOT exist.
      expect(await exists('t_x')).toBe(false);

      // Subsequent run is a pure skip (already recorded), still no replay.
      const out2 = await runMigrate(scratchUrl, migrationsDir, seedDir);
      expect(out2).toContain('0 applied, 1 skipped');
      expect(await exists('t_x')).toBe(false);
    } finally {
      await pool.end();
      const admin2 = new Pool({ connectionString: url, max: 1 });
      try {
        await admin2.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
      } finally {
        await admin2.end();
      }
      rmSync(migrationsDir, { recursive: true, force: true });
      rmSync(seedDir, { recursive: true, force: true });
    }
  });
});
