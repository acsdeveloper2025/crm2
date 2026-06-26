import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createTestDb,
  clientFactory,
  productFactory,
  verificationUnitFactory,
  authHeaderForRole,
} from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool, query } from '../../../platform/db.js';

/**
 * ADR-0073 — per-user KYC-unit ASSIGNMENT ELIGIBILITY (not visibility). An OFFICE task is assignable only
 * to KYC verifiers GRANTED that task's unit (required-grant model); granting a unit does NOT widen what the
 * KYC user can see (visibility stays SELF). A KYC user created after the 0100 backfill starts with NO grants.
 */
const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BC = '9876543210';
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

/** client + product + a KYC unit (worker_role KYC_VERIFIER), CPV-enabled. */
async function seedKycCpv(tag: string): Promise<{ clientId: number; productId: number; unitId: number }> {
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
  return { clientId, productId, unitId };
}

async function createKycUser(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/v2/users')
    .set(SA)
    .send({ username, name: username, role: 'KYC_VERIFIER' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** Create a case with one applicant + one PENDING (unassigned) task at the unit. Returns the task id. */
async function pendingTask(ctx: { clientId: number; productId: number; unitId: number }): Promise<string> {
  const caseId = seeded<{ id: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        backendContactNumber: BC,
        applicants: [{ name: 'APP', mobile: '9000000001' }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      }),
  ).id;
  const applicants = seeded<{ applicants: { id: string }[] }>(
    await request(app).get(`/api/v2/cases/${caseId}`).set(SA),
  ).applicants;
  const tasks = seeded<{ id: string }[]>(
    await request(app)
      .post(`/api/v2/cases/${caseId}/tasks`)
      .set(SA)
      .send({
        tasks: [
          { verificationUnitId: ctx.unitId, applicantId: applicants[0]!.id, address: '1 RD', trigger: 'x' },
        ],
      }),
  );
  return tasks[0]!.id;
}

const grant = (userId: string, unitId: number) =>
  query(`INSERT INTO user_kyc_unit_access (user_id, verification_unit_id) VALUES ($1, $2)`, [userId, unitId]);

const assignOffice = (caseId: string, taskId: string, assignee: string) =>
  request(app)
    .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
    .set(SA)
    .send({ assignedTo: assignee, visitType: 'OFFICE', billCount: 1, version: 1 });

async function caseIdOf(taskId: string): Promise<string> {
  const rows = await query<{ caseId: string }>(`SELECT case_id AS "caseId" FROM case_tasks WHERE id = $1`, [
    taskId,
  ]);
  return rows[0]!.caseId;
}

describe.skipIf(!RUN)('KYC-unit assignment eligibility (ADR-0073)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
      'user_kyc_unit_access',
      'task_assignment_history',
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

  it('an UNGRANTED KYC user cannot be assigned an OFFICE task (400 INVALID_ASSIGNEE)', async () => {
    const ctx = await seedKycCpv('UG');
    const kyc = await createKycUser('kyc_ungranted');
    const taskId = await pendingTask(ctx);
    const res = await assignOffice(await caseIdOf(taskId), taskId, kyc);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ASSIGNEE'); // no grant for this unit ⇒ not assignable
  });

  it('a GRANTED KYC user can be assigned an OFFICE task for that unit (200)', async () => {
    const ctx = await seedKycCpv('GR');
    const kyc = await createKycUser('kyc_granted');
    await grant(kyc, ctx.unitId);
    const taskId = await pendingTask(ctx);
    const res = await assignOffice(await caseIdOf(taskId), taskId, kyc);
    expect(res.status).toBe(200);
    expect(res.body.assignedTo).toBe(kyc);
  });

  it('a grant for unit A does not make the user eligible for an OFFICE task at unit B', async () => {
    const ctx = await seedKycCpv('AB');
    const ctxB = await seedKycCpv('AB2'); // a different KYC unit
    const kyc = await createKycUser('kyc_unit_a');
    await grant(kyc, ctx.unitId); // granted unit A only
    const taskB = await pendingTask(ctxB); // task at unit B
    const res = await assignOffice(await caseIdOf(taskB), taskB, kyc);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ASSIGNEE');
  });

  it('the assignable-users picker for an OFFICE task lists only granted KYC users', async () => {
    const ctx = await seedKycCpv('PK');
    const granted = await createKycUser('kyc_pick_granted');
    const ungranted = await createKycUser('kyc_pick_ungranted');
    await grant(granted, ctx.unitId);
    const taskId = await pendingTask(ctx);
    const caseId = await caseIdOf(taskId);
    const res = await request(app)
      .get(`/api/v2/cases/${caseId}/assignable-users?taskId=${taskId}&visitType=OFFICE`)
      .set(SA);
    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((u) => u.id);
    expect(ids).toContain(granted);
    expect(ids).not.toContain(ungranted);
  });

  // ── grant CRUD (GET / PUT set-the-set) ──────────────────────────────────────────────────────────
  it('PUT sets the grant set and GET reflects it (round-trip)', async () => {
    const ctx = await seedKycCpv('CRUD');
    const kyc = await createKycUser('kyc_crud');
    const put = await request(app)
      .put(`/api/v2/users/${kyc}/kyc-units`)
      .set(SA)
      .send({ unitIds: [ctx.unitId] });
    expect(put.status).toBe(200);
    expect(put.body.grantedUnitIds).toEqual([ctx.unitId]);
    expect((put.body.availableUnits as { id: number }[]).map((u) => u.id)).toContain(ctx.unitId);
    const get = await request(app).get(`/api/v2/users/${kyc}/kyc-units`).set(SA);
    expect(get.body.grantedUnitIds).toEqual([ctx.unitId]);
    // set-the-set: an empty list revokes
    const revoke = await request(app).put(`/api/v2/users/${kyc}/kyc-units`).set(SA).send({ unitIds: [] });
    expect(revoke.body.grantedUnitIds).toEqual([]);
  });

  it('granting a non-KYC user → 400 NOT_KYC_VERIFIER; an unknown unit → 400 INVALID_REFERENCE', async () => {
    const ctx = await seedKycCpv('NEG');
    const backend = (
      await request(app)
        .post('/api/v2/users')
        .set(SA)
        .send({ username: 'backend_neg', name: 'BACKEND', role: 'BACKEND_USER' })
    ).body.id as string;
    const wrongRole = await request(app)
      .put(`/api/v2/users/${backend}/kyc-units`)
      .set(SA)
      .send({ unitIds: [ctx.unitId] });
    expect(wrongRole.status).toBe(400);
    expect(wrongRole.body.error).toBe('NOT_KYC_VERIFIER');
    const kyc = await createKycUser('kyc_neg');
    const unknownUnit = await request(app)
      .put(`/api/v2/users/${kyc}/kyc-units`)
      .set(SA)
      .send({ unitIds: [999999] });
    expect(unknownUnit.status).toBe(400);
    expect(unknownUnit.body.error).toBe('INVALID_REFERENCE');
  });

  it('grant writes are USER_MANAGE-gated (BACKEND_USER → 403; unauthenticated → 401)', async () => {
    const ctx = await seedKycCpv('PERM');
    const kyc = await createKycUser('kyc_perm');
    const BE = authHeaderForRole('BACKEND_USER');
    expect(
      (
        await request(app)
          .put(`/api/v2/users/${kyc}/kyc-units`)
          .set(BE)
          .send({ unitIds: [ctx.unitId] })
      ).status,
    ).toBe(403);
    expect((await request(app).put(`/api/v2/users/${kyc}/kyc-units`).send({ unitIds: [] })).status).toBe(401);
  });
});
