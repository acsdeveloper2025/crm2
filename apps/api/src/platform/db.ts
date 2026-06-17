import { Pool, type QueryResultRow } from 'pg';
import { loadEnv } from '@crm2/config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: loadEnv().DATABASE_URL });
  return pool;
}

/** For tests: inject an existing pool (the ephemeral test DB). */
export function setPool(p: Pool): void {
  pool = p;
}

const toCamel = (s: string): string => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** snake_case row → camelCase object (mirrors v1 camelizeRow contract). */
function camelize<T>(row: QueryResultRow): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out as T;
}

export async function query<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query(text, params);
  return res.rows.map((r) => camelize<T>(r));
}

/** Scoped query fn bound to a transaction client (same camelize contract as `query`). */
export type TxQuery = <T>(text: string, params?: unknown[]) => Promise<T[]>;

/** Run `fn` inside a single BEGIN/COMMIT (ROLLBACK on throw) on one pooled client. */
export async function withTransaction<T>(fn: (q: TxQuery) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const q: TxQuery = async <R>(text: string, params: unknown[] = []): Promise<R[]> => {
      const res = await client.query(text, params);
      return res.rows.map((r) => camelize<R>(r));
    };
    const out = await fn(q);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
