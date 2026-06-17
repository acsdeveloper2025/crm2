import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

/**
 * Ephemeral test DB harness with PER-FILE ISOLATION.
 *
 * The integration suite runs every file in ONE process (vitest singleFork). A single shared
 * database let one file's rows / role-config mutations leak into another file's exact-count and
 * visibility assertions — non-deterministic, order-dependent flakes (a different test failed each
 * run, yet every file passed alone). The cure is to give each file the clean slate it gets when run
 * alone: `globalSetup` migrates ONE template database once, then each `createTestDb()` clones a
 * private database from that template (`CREATE DATABASE … TEMPLATE …` — a fast file copy, far
 * cheaper than replaying ~50 migrations per file) and drops it on `end()`. Files never share rows.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '../../../../db/v2/migrations');
const SEED_DIR = resolve(HERE, '../../../../db/v2/seed');

export interface TestDb {
  pool: Pool;
  migrate: () => Promise<void>;
  seed: (file: string) => Promise<void>;
  truncate: (...tables: string[]) => Promise<void>;
  end: () => Promise<void>;
}

const baseName = (url: string): string => new URL(url).pathname.replace(/^\//, '');
const templateName = (url: string): string => `${baseName(url)}_template`;
function withDbName(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/**
 * Run admin DDL (CREATE/DROP DATABASE — non-transactional, can't target the DB you're connected to)
 * over a short-lived connection to the BASE database, which always exists and is otherwise unused
 * (tests run on clones, never on the base). Each clone/template is a separate DB, so dropping or
 * cloning them from the base connection is safe.
 */
async function withAdmin(databaseUrl: string, fn: (admin: Pool) => Promise<unknown>): Promise<void> {
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await fn(admin);
  } finally {
    await admin.end();
  }
}

async function dropClones(admin: Pool, base: string): Promise<void> {
  const { rows } = await admin.query<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE datname LIKE $1`,
    [`${base}_c_%`],
  );
  for (const r of rows) await admin.query(`DROP DATABASE IF EXISTS "${r.datname}" WITH (FORCE)`);
}

const migrationFiles = (): string[] =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

/**
 * Build the template database ONCE (vitest globalSetup): drop any leftover template + clones from a
 * crashed run, recreate the template, and apply every migration into it. No-op without DATABASE_URL.
 */
export async function buildTemplateDb(databaseUrl = process.env['DATABASE_URL']): Promise<void> {
  if (!databaseUrl) return;
  const tmpl = templateName(databaseUrl);
  await withAdmin(databaseUrl, async (admin) => {
    await dropClones(admin, baseName(databaseUrl));
    await admin.query(`DROP DATABASE IF EXISTS "${tmpl}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${tmpl}"`);
  });
  const tp = new Pool({ connectionString: withDbName(databaseUrl, tmpl) });
  try {
    for (const f of migrationFiles()) await tp.query(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  } finally {
    await tp.end();
  }
}

/** Tear down the template + any surviving clones (vitest globalSetup teardown). */
export async function dropTemplateAndClones(databaseUrl = process.env['DATABASE_URL']): Promise<void> {
  if (!databaseUrl) return;
  await withAdmin(databaseUrl, async (admin) => {
    await dropClones(admin, baseName(databaseUrl));
    await admin.query(`DROP DATABASE IF EXISTS "${templateName(databaseUrl)}" WITH (FORCE)`);
  });
}

export function createTestDb(databaseUrl = process.env['DATABASE_URL']): TestDb {
  if (!databaseUrl) throw new Error('createTestDb: DATABASE_URL is required');
  const cloneName = `${baseName(databaseUrl)}_c_${randomBytes(6).toString('hex')}`;
  const pool = new Pool({ connectionString: withDbName(databaseUrl, cloneName) });
  let created = false;

  return {
    pool,
    async migrate() {
      if (created) return; // clone is the migrated schema — idempotent per file
      await withAdmin(databaseUrl, (admin) =>
        admin.query(`CREATE DATABASE "${cloneName}" TEMPLATE "${templateName(databaseUrl)}"`),
      );
      created = true;
    },
    async seed(file: string) {
      await pool.query(readFileSync(join(SEED_DIR, file), 'utf8'));
    },
    async truncate(...tables: string[]) {
      if (tables.length) await pool.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
    },
    async end() {
      await pool.end();
      await withAdmin(databaseUrl, (admin) =>
        admin.query(`DROP DATABASE IF EXISTS "${cloneName}" WITH (FORCE)`),
      );
    },
  };
}
