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
 * Revoke → billing/commission audit (§REVOKE-BILLING-2026-07-18). Regression coverage for the two
 * duplicate-billing paths reproduced on data, and for the MIS money projection that showed a REVOKED
 * task a full bill + commission on prod CASE-000004. Every assertion is ABSOLUTE (a relative one pins
 * nothing — cf. the 2026-07-17 window-test that stayed green at 45→0).
 */
const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BC = '9876543210';
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });

function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed write failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

async function seedCpvUnit(tag: string): Promise<{ clientId: number; productId: number; unitId: number }> {
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
      .send(verificationUnitFactory({ code: `U_${tag}` })),
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

async function createUser(o: { username: string; name: string; role: string }): Promise<string> {
  const res = await request(app)
    .post('/api/v2/users')
    .set(SA)
    .send({ email: `${o.username}@test.crm2.local`, ...o });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function seedCaseWithTask(
  ctx: { clientId: number; productId: number; unitId: number },
  name: string,
): Promise<{ caseId: string; taskId: string }> {
  const created = seeded<{ id: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        backendContactNumber: BC,
        applicants: [{ name, mobile: '9000012345' }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      }),
  );
  const applicantId = seeded<{ applicants: { id: string }[] }>(
    await request(app).get(`/api/v2/cases/${created.id}`).set(SA),
  ).applicants[0]!.id;
  const tasks = seeded<{ id: string }[]>(
    await request(app)
      .post(`/api/v2/cases/${created.id}/tasks`)
      .set(SA)
      .send({
        tasks: [{ verificationUnitId: ctx.unitId, applicantId, address: '12 MG ROAD', trigger: 'x' }],
      }),
  );
  return { caseId: created.id, taskId: tasks[0]!.id };
}

async function assign(caseId: string, taskId: string, fa: string, version: number): Promise<void> {
  const r = await request(app)
    .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
    .set(SA)
    .send({ assignedTo: fa, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1, version });
  if (r.status !== 200) throw new Error(`assign: ${r.status} ${JSON.stringify(r.body)}`);
}

/** device start → device submit → office complete. Task already ASSIGNED. locationId optional. */
async function driveAssignedToCompleted(
  caseId: string,
  taskId: string,
  fa: string,
  locationId?: number,
): Promise<void> {
  const start = await request(app)
    .post(`/api/v2/verification-tasks/${taskId}/start`)
    .set(hdr('FIELD_AGENT', fa));
  if (start.status !== 200) throw new Error(`start: ${start.status} ${JSON.stringify(start.body)}`);
  if (locationId !== undefined)
    await query(`UPDATE case_tasks SET area_id = $2, pincode_id = $2 WHERE id = $1`, [taskId, locationId]);
  const submit = await request(app)
    .post(`/api/v2/verification-tasks/${taskId}/complete`)
    .set(hdr('FIELD_AGENT', fa));
  if (submit.status !== 200) throw new Error(`submit: ${submit.status} ${JSON.stringify(submit.body)}`);
  const done = await request(app)
    .post(`/api/v2/cases/${caseId}/tasks/${taskId}/complete`)
    .set(SA)
    .send({ result: 'POSITIVE', remark: 'office verified', version: submit.body.version });
  if (done.status !== 200) throw new Error(`office complete: ${done.status} ${JSON.stringify(done.body)}`);
}

async function billingLines(caseId: string): Promise<{ lineCount: number; billTotal: number }> {
  const res = await request(app).get('/api/v2/billing/lines').set(SA).query({ limit: 100 });
  expect(res.status).toBe(200);
  const items = (res.body.items as { caseId: string; billTotal: number }[]).filter(
    (i) => i.caseId === caseId,
  );
  return { lineCount: items.length, billTotal: items.reduce((s, i) => s + (i.billTotal ?? 0), 0) };
}

describe.skipIf(!RUN)('§REVOKE-BILLING: duplicate-billing regressions', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
      'commission_rates',
      'rates',
      'task_assignment_history',
      'case_tasks',
      'case_applicants',
      'cases',
      'client_product_verification_units',
      'client_products',
      'verification_units',
      'clients',
      'products',
      'locations',
      'users',
    );
  });

  async function setup(tag: string): Promise<{
    ctx: { clientId: number; productId: number; unitId: number };
    fa1: string;
    fa2: string;
    fa3: string;
    loc: number;
  }> {
    const ctx = await seedCpvUnit(tag);
    const lc = tag.toLowerCase();
    const fa1 = await createUser({ username: `${lc}_fa1`, name: 'FA ONE', role: 'FIELD_AGENT' });
    const fa2 = await createUser({ username: `${lc}_fa2`, name: 'FA TWO', role: 'FIELD_AGENT' });
    const fa3 = await createUser({ username: `${lc}_fa3`, name: 'FA THREE', role: 'FIELD_AGENT' });
    const loc = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/locations')
        .set(SA)
        .send({ pincode: '400061', area: `${tag}AREA`, city: 'Mumbai', state: 'MH' }),
    ).id;
    seeded(
      await request(app).post('/api/v2/rates').set(SA).send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        verificationUnitId: ctx.unitId,
        clientRateType: 'LOCAL',
        amount: 100,
      }),
    );
    return { ctx, fa1, fa2, fa3, loc };
  }

  // ── The owner's literal claim: a REVOKED task never bills, never earns commission ──
  it('a REVOKED task produces no billing line and no commission', async () => {
    const { ctx, fa1, loc } = await setup('NREV');
    const { caseId, taskId } = await seedCaseWithTask(ctx, 'NO REV APPLICANT');
    await assign(caseId, taskId, fa1, 1);
    await query(`UPDATE case_tasks SET area_id = $2, pincode_id = $2 WHERE id = $1`, [taskId, loc]);
    const rev = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/revoke`)
      .set(SA)
      .send({ reason: 'agent unreachable' });
    expect(rev.status).toBe(200);
    expect(rev.body.status).toBe('REVOKED');
    // a revoked task carries no billable units (owner 2026-07-18): revoke zeroes bill_count, so the
    // case grid / MIS never show a phantom unit. Absolute — the assign set it to 1.
    expect(rev.body.billCount).toBe(0);

    expect(await billingLines(caseId)).toEqual({ lineCount: 0, billTotal: 0 });
    const commission = await request(app)
      .get('/api/v2/billing/commission-detail')
      .set(SA)
      .query({ limit: 100 });
    expect(commission.status).toBe(200);
    const forCase = (commission.body.items as { caseNumber?: string; taskNumber?: string }[]).filter((i) =>
      (i.taskNumber ?? '').startsWith('CASE-'),
    );
    // the revoked task's number must not appear on the commission surface at all
    const revokedTaskNumber = rev.body.taskNumber as string;
    expect(forCase.some((i) => i.taskNumber === revokedTaskNumber)).toBe(false);
  });

  // ── G-RB-1: reassign-after-revoke must not spawn a second billable replacement ──
  it('the same REVOKED parent cannot be reassigned while a replacement is still live (no double-bill)', async () => {
    const { ctx, fa1, fa2, fa3, loc } = await setup('DUP');
    const { caseId, taskId } = await seedCaseWithTask(ctx, 'DUP APPLICANT');
    await assign(caseId, taskId, fa1, 1);
    const rev = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/revoke`)
      .set(SA)
      .send({ reason: 'agent unreachable' });
    expect(rev.status).toBe(200);

    const re1 = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/reassign`)
      .set(SA)
      .send({ assignedTo: fa2, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1 });
    expect([200, 201]).toContain(re1.status);

    // Second reassign of the SAME still-REVOKED parent, while re1 is live → must be blocked (409).
    const re2 = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/reassign`)
      .set(SA)
      .send({ assignedTo: fa3, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1 });
    expect(re2.status).toBe(409);

    await driveAssignedToCompleted(caseId, re1.body.id as string, fa2, loc);
    // exactly ONE bill for the one verification
    expect(await billingLines(caseId)).toEqual({ lineCount: 1, billTotal: 100 });
  });

  it('a fresh reassign IS allowed once the previous replacement is terminal (revoked)', async () => {
    const { ctx, fa1, fa2, fa3, loc } = await setup('SEQ');
    const { caseId, taskId } = await seedCaseWithTask(ctx, 'SEQ APPLICANT');
    await assign(caseId, taskId, fa1, 1);
    expect(
      (
        await request(app)
          .post(`/api/v2/cases/${caseId}/tasks/${taskId}/revoke`)
          .set(SA)
          .send({ reason: 'unreachable' })
      ).status,
    ).toBe(200);
    const re1 = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/reassign`)
      .set(SA)
      .send({ assignedTo: fa2, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1 });
    expect([200, 201]).toContain(re1.status);
    // revoke the replacement too → slot freed
    expect(
      (
        await request(app)
          .post(`/api/v2/cases/${caseId}/tasks/${re1.body.id}/revoke`)
          .set(SA)
          .send({ reason: 'also unreachable' })
      ).status,
    ).toBe(200);
    // reassign the ORIGINAL again — allowed, because no live child occupies the slot
    const re2 = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/reassign`)
      .set(SA)
      .send({ assignedTo: fa3, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1 });
    expect([200, 201]).toContain(re2.status);
    await driveAssignedToCompleted(caseId, re2.body.id as string, fa3, loc);
    expect(await billingLines(caseId)).toEqual({ lineCount: 1, billTotal: 100 });
  });

  // ── G-RB-2: a revisit child at SUBMITTED still occupies the slot ──
  it('a second revisit is blocked while the first revisit child sits at SUBMITTED', async () => {
    const { ctx, fa1, fa2 } = await setup('SUBG');
    const { caseId, taskId } = await seedCaseWithTask(ctx, 'SUBG APPLICANT');
    await assign(caseId, taskId, fa1, 1);
    await driveAssignedToCompleted(caseId, taskId, fa1); // no location → children inherit none → no territory gate

    const rv1 = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/revisit`)
      .set(SA)
      .send({ reason: 'client asked for recheck' });
    expect([200, 201]).toContain(rv1.status);
    const child1 = rv1.body.id as string;

    // drive child1 to SUBMITTED only (device done, office has NOT completed)
    await assign(caseId, child1, fa2, rv1.body.version ?? 1);
    expect(
      (await request(app).post(`/api/v2/verification-tasks/${child1}/start`).set(hdr('FIELD_AGENT', fa2)))
        .status,
    ).toBe(200);
    const sub = await request(app)
      .post(`/api/v2/verification-tasks/${child1}/complete`)
      .set(hdr('FIELD_AGENT', fa2));
    expect(sub.status).toBe(200);
    const st = await query<{ status: string }>(`SELECT status FROM case_tasks WHERE id = $1`, [child1]);
    expect(st[0]!.status).toBe('SUBMITTED');

    // second revisit while child1 is SUBMITTED → must be blocked (409); SUBMITTED still holds the slot
    const rv2 = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/revisit`)
      .set(SA)
      .send({ reason: 'second revisit while first is submitted' });
    expect(rv2.status).toBe(409);
  });

  // ── G-RB-3: MIS per-row money columns must not project money for a non-billable task ──
  it('MIS shows no bill and no commission on a REVOKED task row (observed on prod CASE-000004)', async () => {
    const { ctx, fa1, loc } = await setup('MISG');
    const { caseId, taskId } = await seedCaseWithTask(ctx, 'MIS REV APPLICANT');
    await assign(caseId, taskId, fa1, 1);
    await query(`UPDATE case_tasks SET area_id = $2, pincode_id = $2 WHERE id = $1`, [taskId, loc]);
    const rev = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/revoke`)
      .set(SA)
      .send({ reason: 'agent unreachable' });
    expect(rev.status).toBe(200);

    const rows = await request(app)
      .get('/api/v2/mis/TASK_OPERATIONAL/rows')
      .set(SA)
      .query({ cols: 'taskNumber,taskStatus,billAmount,billLineAmount,commissionAmount', limit: 100 });
    expect(rows.status).toBe(200);
    const revokedRow = (
      rows.body.items as {
        taskNumber: string;
        taskStatus: string;
        billAmount: number | null;
        billLineAmount: number | null;
        commissionAmount: number | null;
      }[]
    ).find((r) => r.taskNumber === rev.body.taskNumber);
    expect(revokedRow).toBeTruthy();
    expect(revokedRow!.taskStatus).toBe('REVOKED');
    // a rate of ₹100 exists for the CPV, so the UNFILTERED column would show 100 — the bug. Must be null.
    expect(revokedRow!.billAmount).toBeNull();
    expect(revokedRow!.billLineAmount).toBeNull();
    expect(revokedRow!.commissionAmount).toBeNull();
  });
});
