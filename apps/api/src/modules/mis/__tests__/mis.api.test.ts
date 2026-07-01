import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createTestDb,
  clientFactory,
  productFactory,
  verificationUnitFactory,
  authHeaderForRole,
} from '@crm2/test-utils';
import type { MisReportTypeMeta } from '@crm2/sdk';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });

const SA = authHeaderForRole('SUPER_ADMIN'); // grants_all → billing + mis
const TL = authHeaderForRole('TEAM_LEADER'); // mis.view WITHOUT billing.view (money-gate probe)
const FA = authHeaderForRole('FIELD_AGENT'); // no mis.view
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });
const BC = '9876543210';
const ADDR = '12 MG ROAD';
const ROWS = '/api/v2/mis/TASK_OPERATIONAL/rows';

function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

async function createUser(role: string, username: string): Promise<string> {
  const { rows } = await db!.pool.query<{ id: string }>(
    `INSERT INTO users (id, username, name, role) VALUES (gen_random_uuid(), $1, 'X', $2) RETURNING id`,
    [username, role],
  );
  return rows[0]!.id;
}

/** Seed client+product with one CPV-enabled unit (effective in the past so the enablement gate can't race). */
async function seedCpv(tag: string): Promise<{ clientId: number; productId: number; unitId: number }> {
  const clientId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send(clientFactory({ code: `C_${tag}` })),
  ).id;
  const productId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/products')
      .set(SA)
      .send(productFactory({ code: `P_${tag}` })),
  ).id;
  const unitId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: `UE_${tag}` })),
  ).id;
  const cpId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/client-products')
      .set(SA)
      .send({ clientId, productId, effectiveFrom: PAST }),
  ).id;
  seeded(
    await request(app)
      .post('/api/v2/cpv-units')
      .set(SA)
      .send({ clientProductId: cpId, verificationUnitId: unitId, effectiveFrom: PAST }),
  );
  return { clientId, productId, unitId };
}

/** Seed one case with `n` tasks (task-grain: n task rows). Returns the case id. */
async function seedCaseWithTasks(tag: string, n: number): Promise<string> {
  const { clientId, productId, unitId } = await seedCpv(tag);
  const caseId = seeded<{ id: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId,
        productId,
        backendContactNumber: BC,
        applicants: [{ name: 'RAMESH KUMAR', mobile: '9876543210', pan: 'ABCDE1234F' }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      }),
  ).id;
  const applicantId = (await request(app).get(`/api/v2/cases/${caseId}`).set(SA)).body.applicants[0]
    .id as string;
  const tasks = Array.from({ length: n }, () => ({ verificationUnitId: unitId, applicantId, address: ADDR }));
  seeded(await request(app).post(`/api/v2/cases/${caseId}/tasks`).set(SA).send({ tasks }));
  return caseId;
}

describe.skipIf(!RUN)('MIS API (ADR-0084)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
      'user_scope_assignments',
      'case_tasks',
      'case_applicants',
      'cases',
      'client_product_verification_units',
      'client_products',
      'verification_units',
      'clients',
      'products',
      'users',
    );
  });

  it('report-types catalog: billing.view holder sees money columns; a mis.view-only role sees none', async () => {
    const asSA = seeded<MisReportTypeMeta[]>(await request(app).get('/api/v2/mis/report-types').set(SA));
    const task = asSA.find((t) => t.type === 'TASK_OPERATIONAL')!;
    expect(task).toBeTruthy();
    expect(task.columns.some((c) => c.key === 'billAmount' && c.money)).toBe(true);
    expect(task.columns.some((c) => c.key === 'commissionAmount')).toBe(true);

    const asTL = seeded<MisReportTypeMeta[]>(await request(app).get('/api/v2/mis/report-types').set(TL));
    const tlTask = asTL.find((t) => t.type === 'TASK_OPERATIONAL')!;
    expect(tlTask.columns.some((c) => c.money)).toBe(false); // money columns omitted entirely
    expect(tlTask.columns.some((c) => c.key === 'taskNumber')).toBe(true); // non-money still present
  });

  it('gates: no mis.view → 403; unauthenticated → 401', async () => {
    expect((await request(app).get('/api/v2/mis/report-types').set(FA)).status).toBe(403);
    expect((await request(app).get(ROWS).set(FA)).status).toBe(403);
    expect((await request(app).get('/api/v2/mis/report-types')).status).toBe(401);
  });

  it('rows: returns the seeded task at task grain (no fan-out) with the default columns populated', async () => {
    await seedCaseWithTasks('R1', 2); // one case, two tasks
    const res = await request(app).get(ROWS).set(SA);
    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(2); // task grain — two task rows, never multiplied
    expect(res.body.items).toHaveLength(2);
    const row = res.body.items[0];
    // API camelizes response keys (additive-camelize contract) → registry keys are camelCase.
    expect(row.caseNumber).toMatch(/^CASE-\d{6}$/);
    expect(row.taskNumber).toBeTruthy();
    expect(row.applicantName).toBe('RAMESH KUMAR');
    expect(row.taskStatus).toBe('PENDING');
    // money columns resolve for a billing.view holder (null is fine — no rate configured)
    expect('billAmount' in row).toBe(true);
  });

  it('scope: an out-of-scope actor gets 0 rows (never 403/IDOR)', async () => {
    await seedCaseWithTasks('R2', 1); // created by SA
    const outsider = await createUser('BACKEND_USER', 'be_out_mis');
    const res = await request(app).get(ROWS).set(hdr('BACKEND_USER', outsider));
    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it('money-gate: a mis.view-only role cannot select or receive money columns', async () => {
    await seedCaseWithTasks('R3', 1);
    // default columns for a non-billing role carry no money keys
    const def = await request(app)
      .get(ROWS)
      .set(hdr('TEAM_LEADER', await createUser('TEAM_LEADER', 'tl_mis')));
    expect(def.status).toBe(200);
    if (def.body.items[0]) expect('billAmount' in def.body.items[0]).toBe(false);
    // explicitly requesting a money column → 400 (not in the allowed set for this actor)
    expect((await request(app).get(`${ROWS}?cols=taskNumber,billAmount`).set(TL)).status).toBe(400);
    // …but a billing.view holder may select it
    expect((await request(app).get(`${ROWS}?cols=taskNumber,billAmount`).set(SA)).status).toBe(200);
  });

  it('strict column validation: unknown key → 400, duplicate key → 400', async () => {
    expect((await request(app).get(`${ROWS}?cols=taskNumber,not_a_column`).set(SA)).status).toBe(400);
    expect((await request(app).get(`${ROWS}?cols=taskNumber,taskNumber`).set(SA)).status).toBe(400);
  });

  it('strict sort validation: an unknown sortBy → 400; unknown report type → 404', async () => {
    expect((await request(app).get(`${ROWS}?sortBy=not_sortable`).set(SA)).status).toBe(400);
    expect((await request(app).get('/api/v2/mis/NOPE/rows').set(SA)).status).toBe(404);
  });
});
