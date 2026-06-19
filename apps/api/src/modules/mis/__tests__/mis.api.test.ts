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
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
// SA: grantsAll=true → billing.view=true, hierarchy=ALL (no scope predicate) — used for data queries.
// Roles with restricted hierarchy (DIRECT_TEAM/SUBTREE) or RESTRICT dimensions need real DB users.
const SA = authHeaderForRole('SUPER_ADMIN');
const BC = '9876543210';
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });

function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

async function seedCpvUnit(tag: string): Promise<{ clientId: number; productId: number; unitId: number }> {
  const clientId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send(clientFactory({ code: `MC_${tag}` })),
  ).id;
  const productId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/products')
      .set(SA)
      .send(productFactory({ code: `MP_${tag}` })),
  ).id;
  const unitId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: `MU_${tag}` })),
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
  const res = await request(app).post('/api/v2/users').set(SA).send(o);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/**
 * Seed an active MIS layout with 4 columns:
 *   task_number  → TASK_FIELD  (always visible)
 *   case_number  → CASE_FIELD  (always visible)
 *   bill_amount  → RATE_AMOUNT (billing.view only)
 *   commission   → COMMISSION_AMOUNT (billing.view only)
 *
 * is_active defaults to TRUE in the DB so no explicit activation is needed.
 */
async function seedMisLayout(clientId: number, productId: number): Promise<void> {
  const res = await request(app)
    .post('/api/v2/report-layouts')
    .set(SA)
    .send({
      clientId,
      productId,
      kind: 'MIS',
      name: 'Test MIS Layout',
      columns: [
        {
          columnKey: 'task_number',
          headerLabel: 'Task No.',
          sourceType: 'TASK_FIELD',
          sourceRef: 'task_number',
          dataType: 'TEXT',
          displayOrder: 0,
        },
        {
          columnKey: 'case_number',
          headerLabel: 'Case No.',
          sourceType: 'CASE_FIELD',
          sourceRef: 'case_number',
          dataType: 'TEXT',
          displayOrder: 1,
        },
        {
          columnKey: 'bill_amount',
          headerLabel: 'Bill Amount',
          sourceType: 'RATE_AMOUNT',
          dataType: 'NUMBER',
          displayOrder: 2,
        },
        {
          columnKey: 'commission',
          headerLabel: 'Commission',
          sourceType: 'COMMISSION_AMOUNT',
          dataType: 'NUMBER',
          displayOrder: 3,
        },
      ],
    });
  expect(res.status).toBe(201);
}

async function seedCompletedTask(
  ctx: { clientId: number; productId: number; unitId: number },
  fa: string,
  name: string,
): Promise<{ caseId: string; caseNumber: string; taskId: string }> {
  const created = seeded<{ id: string; caseNumber: string }>(
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
  const taskId = tasks[0]!.id;
  expect(
    (
      await request(app)
        .post(`/api/v2/cases/${created.id}/tasks/${taskId}/assign`)
        .set(SA)
        .send({ assignedTo: fa, visitType: 'FIELD', distanceBand: 'LOCAL', billCount: 1, version: 1 })
    ).status,
  ).toBe(200);
  expect(
    (await request(app).post(`/api/v2/verification-tasks/${taskId}/start`).set(hdr('FIELD_AGENT', fa)))
      .status,
  ).toBe(200);
  // ADR-0047: the device /complete transitions the task to SUBMITTED (field done, commission frozen),
  // NOT COMPLETED — office-complete is a separate step. The MIS read-model includes SUBMITTED tasks
  // (mirrors the billing read-model), so this submitted task appears in the MIS below.
  expect(
    (await request(app).post(`/api/v2/verification-tasks/${taskId}/complete`).set(hdr('FIELD_AGENT', fa)))
      .status,
  ).toBe(200);
  return { caseId: created.id, caseNumber: created.caseNumber, taskId };
}

describe.skipIf(!RUN)('MIS API (ADR-0037)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
      'report_layout_columns',
      'report_layouts',
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
      'users',
    );
  });

  it('1. billing.view actor (SUPER_ADMIN) gets 4 columns including money; row carries the amount values', async () => {
    // SA has grantsAll=true → canViewBilling=true and hierarchy=ALL → no scope predicate,
    // so scope never blocks the query. This test validates the "billing.view sees money" path.
    const ctx = await seedCpvUnit('FULL');
    const fa = await createUser({ username: 'mis_fa1', name: 'MIS FA1', role: 'FIELD_AGENT' });
    seeded(
      await request(app).post('/api/v2/rates').set(SA).send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        verificationUnitId: ctx.unitId,
        rateType: 'LOCAL',
        amount: 100,
      }),
    );
    seeded(
      await request(app)
        .post('/api/v2/commission-rates')
        .set(SA)
        .send({ userId: fa, rateType: 'LOCAL', amount: 30 }),
    );
    await seedMisLayout(ctx.clientId, ctx.productId);
    const task = await seedCompletedTask(ctx, fa, 'FULL APP');

    const res = await request(app)
      .get(`/api/v2/mis/rows?clientId=${ctx.clientId}&productId=${ctx.productId}`)
      .set(SA);
    expect(res.status).toBe(200);
    expect(res.body.columns).toHaveLength(4);
    const colKeys = (res.body.columns as { key: string }[]).map((c) => c.key);
    expect(colKeys).toContain('bill_amount');
    expect(colKeys).toContain('commission');
    expect(res.body.totalCount).toBe(1);
    expect(res.body.rows).toHaveLength(1);
    const row = res.body.rows[0] as Record<string, unknown>;
    expect(row['task_number']).toBe(`${task.caseNumber}-1`);
    expect(row['case_number']).toBe(task.caseNumber);
    expect(Number(row['bill_amount'])).toBe(100);
    expect(Number(row['commission'])).toBe(30);
  });

  it('2. non-billing.view actor (TEAM_LEADER) gets only 2 columns; money absent from rows', async () => {
    // Create a real TEAM_LEADER user in the DB. TEAM_LEADER has page.mis (migration 0081)
    // but NOT billing.view → money columns must be stripped.
    // TL uses DIRECT_TEAM hierarchy: getScopedUserIds returns [tlId] + any direct reports.
    // We assign the task to a FIELD_AGENT who reports to tlId (or use tlId as assignee directly is
    // not possible since only FIELD_AGENT can be assigned tasks). Instead, create a FIELD_AGENT who
    // reports to tlId so the TL's scope includes them via DIRECT_TEAM.
    // Actually simpler: assign the task to a FA whose reports_to = tlId — TL's DIRECT_TEAM scope
    // then includes FA via "reports_to = tlId" and the EXISTS predicate matches.
    const ctx = await seedCpvUnit('NOFIN');
    const tlId = await createUser({ username: 'mis_tl2', name: 'MIS TL2', role: 'TEAM_LEADER' });
    // Create FA with reports_to = tlId so they're in TL's direct team
    const faRes = await request(app)
      .post('/api/v2/users')
      .set(SA)
      .send({ username: 'mis_fa2', name: 'MIS FA2', role: 'FIELD_AGENT', reportsTo: tlId });
    expect(faRes.status).toBe(201);
    const fa = faRes.body.id as string;
    seeded(
      await request(app).post('/api/v2/rates').set(SA).send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        verificationUnitId: ctx.unitId,
        rateType: 'LOCAL',
        amount: 100,
      }),
    );
    await seedMisLayout(ctx.clientId, ctx.productId);
    // Create case + task with SA; assign task to FA (who is in TL's DIRECT_TEAM via reports_to)
    await seedCompletedTask(ctx, fa, 'NOFIN APP');

    const tlHdr = hdr('TEAM_LEADER', tlId);
    const res = await request(app)
      .get(`/api/v2/mis/rows?clientId=${ctx.clientId}&productId=${ctx.productId}`)
      .set(tlHdr);
    expect(res.status).toBe(200);
    expect(res.body.columns).toHaveLength(2);
    const colKeys = (res.body.columns as { key: string }[]).map((c) => c.key);
    expect(colKeys).not.toContain('bill_amount');
    expect(colKeys).not.toContain('commission');
    expect(colKeys).toContain('task_number');
    expect(colKeys).toContain('case_number');
    expect(res.body.totalCount).toBe(1);
    const row = res.body.rows[0] as Record<string, unknown>;
    expect(row['bill_amount']).toBeUndefined();
    expect(row['commission']).toBeUndefined();
  });

  it('3. no active MIS layout → { columns: [], rows: [], totalCount: 0 } (HTTP 200)', async () => {
    const ctx = await seedCpvUnit('NOLAYOUT');
    const res = await request(app)
      .get(`/api/v2/mis/rows?clientId=${ctx.clientId}&productId=${ctx.productId}`)
      .set(SA);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ columns: [], rows: [], totalCount: 0 });
  });

  it('4. out-of-scope actor → totalCount 0, not 403', async () => {
    const ctx = await seedCpvUnit('SCOPE');
    const fa = await createUser({ username: 'mis_fa3', name: 'MIS FA3', role: 'FIELD_AGENT' });
    await seedMisLayout(ctx.clientId, ctx.productId);
    await seedCompletedTask(ctx, fa, 'SCOPE APP');

    // A TEAM_LEADER with a userId not in the users table → getScopedUserIds returns [] →
    // scope predicate = cs.created_by = ANY(ARRAY[]::uuid[]) = FALSE → totalCount=0.
    const outsiderTlId = '00000000-0000-0000-0000-000000000099';
    const res = await request(app)
      .get(`/api/v2/mis/rows?clientId=${ctx.clientId}&productId=${ctx.productId}`)
      .set({ 'x-test-auth': `TEAM_LEADER:${outsiderTlId}` });
    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(0);
  });

  it('5. completedFrom/completedTo filters rows by task completion date', async () => {
    const ctx = await seedCpvUnit('DATE');
    const fa = await createUser({ username: 'mis_fa5', name: 'MIS FA5', role: 'FIELD_AGENT' });
    await seedMisLayout(ctx.clientId, ctx.productId);
    await seedCompletedTask(ctx, fa, 'DATE APP');

    // completedFrom in the future → 0 rows
    const res1 = await request(app)
      .get(
        `/api/v2/mis/rows?clientId=${ctx.clientId}&productId=${ctx.productId}&completedFrom=${encodeURIComponent(FUTURE)}`,
      )
      .set(SA);
    expect(res1.status).toBe(200);
    expect(res1.body.totalCount).toBe(0);

    // completedTo 48 hours ago → 0 rows
    const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const res2 = await request(app)
      .get(
        `/api/v2/mis/rows?clientId=${ctx.clientId}&productId=${ctx.productId}&completedTo=${encodeURIComponent(twoDaysAgo)}`,
      )
      .set(SA);
    expect(res2.status).toBe(200);
    expect(res2.body.totalCount).toBe(0);

    // No filter → 1 row
    const res3 = await request(app)
      .get(`/api/v2/mis/rows?clientId=${ctx.clientId}&productId=${ctx.productId}`)
      .set(SA);
    expect(res3.status).toBe(200);
    expect(res3.body.totalCount).toBe(1);
  });

  it('6. export endpoint (CSV) for billing.view actor returns a file', async () => {
    // SA has grantsAll → billing.view → 4 columns including money; hierarchy=ALL → no scope filter.
    const ctx = await seedCpvUnit('EXPORT');
    const fa = await createUser({ username: 'mis_fa6', name: 'MIS FA6', role: 'FIELD_AGENT' });
    seeded(
      await request(app).post('/api/v2/rates').set(SA).send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        verificationUnitId: ctx.unitId,
        rateType: 'LOCAL',
        amount: 100,
      }),
    );
    await seedMisLayout(ctx.clientId, ctx.productId);
    await seedCompletedTask(ctx, fa, 'EXPORT APP');

    const res = await request(app)
      .get(`/api/v2/mis/export?clientId=${ctx.clientId}&productId=${ctx.productId}&format=csv&mode=all`)
      .set(SA);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
  });

  it('7. FIELD_AGENT (no page.mis) → 403', async () => {
    const ctx = await seedCpvUnit('FA403');
    const fa = await createUser({ username: 'mis_fa7', name: 'MIS FA7', role: 'FIELD_AGENT' });
    const res = await request(app)
      .get(`/api/v2/mis/rows?clientId=${ctx.clientId}&productId=${ctx.productId}`)
      .set(hdr('FIELD_AGENT', fa));
    expect(res.status).toBe(403);
  });
});
