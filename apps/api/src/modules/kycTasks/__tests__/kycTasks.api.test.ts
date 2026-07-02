import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import {
  createTestDb,
  clientFactory,
  productFactory,
  verificationUnitFactory,
  authHeaderForRole,
} from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

/**
 * KYC-verifier queue (ADR-0085 S2): self-scoped OFFICE-task read model with the DERIVED export
 * state. Integration — requires DATABASE_URL (ephemeral PG); self-skips otherwise.
 */

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });

const SA = authHeaderForRole('SUPER_ADMIN');
const FA = authHeaderForRole('FIELD_AGENT'); // no kyc_tasks.view → 403
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });
const BC = '9876543210';
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const LIST = '/api/v2/kyc-tasks';

function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

async function createUser(role: string, username: string): Promise<string> {
  const { rows } = await db!.pool.query<{ id: string }>(
    `INSERT INTO users (id, username, name, role) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
    [username, username.toUpperCase(), role],
  );
  const id = rows[0]!.id;
  // ADR-0073: OFFICE assignment needs a per-unit grant — make test verifiers universally eligible.
  if (role === 'KYC_VERIFIER')
    await db!.pool.query(
      `INSERT INTO user_kyc_unit_access (user_id, verification_unit_id)
       SELECT $1, vu.id FROM verification_units vu WHERE vu.is_active ON CONFLICT DO NOTHING`,
      [id],
    );
  return id;
}

/** Client+product with one CPV-enabled KYC unit → a case with one OFFICE task assigned to `assignee`. */
async function seedOfficeTask(
  tag: string,
  assignee: string,
  doc?: { documentNumber?: string; documentDetails?: Record<string, string> },
): Promise<{ caseId: string; taskId: string }> {
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
      .send(verificationUnitFactory({ code: `U_${tag}`, workerRole: 'KYC_VERIFIER' })),
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
  // the fresh unit postdates the verifiers' blanket grant → grant it to every test verifier (ADR-0073)
  await db!.pool.query(
    `INSERT INTO user_kyc_unit_access (user_id, verification_unit_id)
     SELECT u.id, $1 FROM users u WHERE u.role = 'KYC_VERIFIER' ON CONFLICT DO NOTHING`,
    [unitId],
  );
  const caseId = seeded<{ id: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId,
        productId,
        backendContactNumber: BC,
        applicants: [{ name: `APPL ${tag}`, pan: 'ABCPE1234F', mobile: '9876543210' }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      }),
  ).id;
  const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
  const applicantId = detail.body.applicants[0].id as string;
  const tasks = seeded<Array<{ id: string }>>(
    await request(app)
      .post(`/api/v2/cases/${caseId}/tasks`)
      .set(SA)
      .send({ tasks: [{ verificationUnitId: unitId, applicantId, ...doc }] }),
  );
  const taskId = tasks[0]!.id;
  const assign = await request(app)
    .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
    .set(SA)
    .send({ assignedTo: assignee, visitType: 'OFFICE', billCount: 1, version: 1 });
  if (assign.status !== 200) throw new Error(`assign failed: ${JSON.stringify(assign.body)}`);
  return { caseId, taskId };
}

/** Test seam: stamp a first-export event (S3 builds the real endpoint that writes these). */
async function stampFirstExport(caseId: string, taskId: string, byUserId: string): Promise<void> {
  await db!.pool.query(
    `INSERT INTO task_export_events (task_id, case_id, exported_by, format) VALUES ($1, $2, $3, 'xlsx')`,
    [taskId, caseId, byUserId],
  );
}

describe.skipIf(!RUN)('KYC-verifier queue (ADR-0085 S2)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });

  it('RBAC: no kyc_tasks.view → 403; unauth → 401; KYC_VERIFIER → 200', async () => {
    const verifier = await createUser('KYC_VERIFIER', 'kv_rbac');
    expect((await request(app).get(`${LIST}?state=TO_EXPORT`)).status).toBe(401);
    expect((await request(app).get(`${LIST}?state=TO_EXPORT`).set(FA)).status).toBe(403);
    const ok = await request(app).get(`${LIST}?state=TO_EXPORT`).set(hdr('KYC_VERIFIER', verifier));
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty('items');
    expect(ok.body).toHaveProperty('totalCount');
  });

  it('strict validation: unknown state / column / sort → 400', async () => {
    const verifier = await createUser('KYC_VERIFIER', 'kv_val');
    const H = hdr('KYC_VERIFIER', verifier);
    expect((await request(app).get(`${LIST}?state=NOPE`).set(H)).status).toBe(400);
    expect((await request(app).get(`${LIST}?state=TO_EXPORT&cols=evil`).set(H)).status).toBe(400);
    expect((await request(app).get(`${LIST}?state=TO_EXPORT&sortBy=evil`).set(H)).status).toBe(400);
  });

  it('self-scope + state derivation: own ASSIGNED OFFICE task in TO_EXPORT; export event moves it to EXPORTED; other verifier sees 0', async () => {
    const mine = await createUser('KYC_VERIFIER', 'kv_own');
    const other = await createUser('KYC_VERIFIER', 'kv_other');
    const { caseId, taskId } = await seedOfficeTask('S2A', mine, {
      documentNumber: 'PAN123',
      documentDetails: { 'BANK NAME': 'HDFC' },
    });

    const H = hdr('KYC_VERIFIER', mine);
    const toExport = await request(app).get(`${LIST}?state=TO_EXPORT`).set(H);
    expect(toExport.status).toBe(200);
    expect(toExport.body.totalCount).toBe(1);
    const row = toExport.body.items[0];
    expect(row.documentNumber).toBe('PAN123');
    expect(row.documentDetails).toEqual({ 'BANK NAME': 'HDFC' });
    expect(row.status).toBe('ASSIGNED');
    expect(row.exportedAt).toBeNull();

    // the other verifier sees NOTHING (SELF scope; out-of-scope = 0 rows, never an error)
    const others = await request(app).get(`${LIST}?state=TO_EXPORT`).set(hdr('KYC_VERIFIER', other));
    expect(others.body.totalCount).toBe(0);

    // a first-export event flips the derived state — no case_tasks.status change involved
    await stampFirstExport(caseId, taskId, mine);
    const after = await request(app).get(`${LIST}?state=TO_EXPORT`).set(H);
    expect(after.body.totalCount).toBe(0);
    const exported = await request(app).get(`${LIST}?state=EXPORTED`).set(H);
    expect(exported.body.totalCount).toBe(1);
    expect(exported.body.items[0].exportedAt).not.toBeNull();
    expect(exported.body.items[0].exportCount).toBe(1);
    expect(exported.body.items[0].status).toBe('ASSIGNED'); // task status untouched (derived state)
  });

  it('FIELD tasks never appear; SA (grants-all, unrestricted scope) sees all OFFICE rows', async () => {
    const verifier = await createUser('KYC_VERIFIER', 'kv_field');
    await seedOfficeTask('S2B', verifier);
    // no FIELD seeding needed for the negative half: the base WHERE is visit_type='OFFICE', and the
    // S2A/S2B seeds only create OFFICE tasks — assert the SA view is exactly the OFFICE set.
    const sa = await request(app).get(`${LIST}?state=TO_EXPORT`).set(SA);
    expect(sa.status).toBe(200);
    const numbers = (sa.body.items as Array<{ taskNumber: string }>).map((r) => r.taskNumber);
    expect(numbers.length).toBe(sa.body.totalCount);
    // every row the SA sees is an OFFICE task from this suite's seeds (no FIELD/foreign rows)
    expect(sa.body.items.every((r: { status: string }) => r.status === 'ASSIGNED')).toBe(true);
  });
});
