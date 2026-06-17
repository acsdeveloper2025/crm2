import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import {
  createTestDb,
  clientFactory,
  productFactory,
  verificationUnitFactory,
  authHeaderForRole,
} from '@crm2/test-utils';
import type { DashboardStats } from '@crm2/sdk';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BC = '9876543210';
// A day ago — CPV seeded with this effective_from is already-effective, so the immediate
// `effective_from <= now()` enablement gate can't race the clock (see seedCpvUnit).
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });

function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed write failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

async function createUser(o: { username: string; name: string; role: string }): Promise<string> {
  const res = await request(app).post('/api/v2/users').set(SA).send(o);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function seedCpvUnit(tag: string): Promise<{ clientId: number; productId: number; unitId: number }> {
  const clientId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send(clientFactory({ code: `DC_${tag}` })),
  ).id;
  const productId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/products')
      .set(SA)
      .send(productFactory({ code: `DP_${tag}` })),
  ).id;
  const unitId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: `DU_${tag}` })),
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

/** A case with one task assigned to `assigneeId` for the given pool (status ASSIGNED). */
async function seedAssignedTask(
  ctx: { clientId: number; productId: number; unitId: number },
  assigneeId: string,
  visitType: 'FIELD' | 'OFFICE' = 'FIELD',
): Promise<void> {
  const created = seeded<{ id: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        backendContactNumber: BC,
        applicants: [{ name: 'Dashboard Applicant', mobile: '9000054321' }],
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
      .send({ tasks: [{ verificationUnitId: ctx.unitId, applicantId, address: '7 FC Road' }] }),
  );
  const assigned = await request(app)
    .post(`/api/v2/cases/${created.id}/tasks/${tasks[0]!.id}/assign`)
    .set(SA)
    .send({ assignedTo: assigneeId, visitType, billCount: 1, version: 1 });
  expect(assigned.status).toBe(200);
}

describe.skipIf(!RUN)('Dashboard overview (ADR-0029)', () => {
  let agentId: string;
  let tlId: string;
  let kycId: string;

  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
    agentId = await createUser({ username: 'dash_agent', name: 'Dash Field Agent', role: 'FIELD_AGENT' });
    tlId = await createUser({ username: 'dash_tl', name: 'Dash Team Leader', role: 'TEAM_LEADER' });
    kycId = await createUser({ username: 'dash_kyc', name: 'Dash KYC Verifier', role: 'KYC_VERIFIER' });
    const ctx = await seedCpvUnit('DASH');
    await seedAssignedTask(ctx, agentId); // FIELD task → field agent
    await seedAssignedTask(ctx, kycId, 'OFFICE'); // OFFICE task → KYC verifier
  });
  afterAll(async () => {
    await db!.end();
  });

  it('SUPER_ADMIN (hierarchy ALL, empty scope predicate) sees the assigned task in the counter bar', async () => {
    const res = await request(app).get('/api/v2/dashboard/stats').set(SA);
    expect(res.status).toBe(200);
    const s = res.body as DashboardStats;
    expect(s.assigned).toBeGreaterThanOrEqual(1);
    expect(s.assignedToday).toBeGreaterThanOrEqual(1);
    // freshly assigned → "fresh" aging bucket, not overdue
    expect(s.agingFresh).toBeGreaterThanOrEqual(1);
    expect(s.overdue).toBe(0);
    expect(s.completed).toBe(0);
  });

  it('returns the full truthful shape (every counter present, no fabricated activity field)', async () => {
    const res = await request(app).get('/api/v2/dashboard/stats').set(SA);
    const s = res.body as DashboardStats;
    for (const k of [
      'bucket',
      'assigned',
      'inProgress',
      'awaitingCompletion',
      'completed',
      'revoked',
      'outOfTat',
      'assignedToday',
      'completedToday',
      'completedYesterday',
      'completed7d',
      'overdue',
      'agingFresh',
      'aging1d',
      'aging2d',
      'aging3dPlus',
    ]) {
      expect(typeof (s as unknown as Record<string, unknown>)[k], k).toBe('number');
    }
    expect('oldestUnassignedAt' in s).toBe(true);
  });

  it('hierarchy scope: a TEAM_LEADER with no reports sees an all-zero board (IDOR-safe)', async () => {
    const res = await request(app).get('/api/v2/dashboard/stats').set(hdr('TEAM_LEADER', tlId));
    expect(res.status).toBe(200);
    const s = res.body as DashboardStats;
    expect(s.assigned).toBe(0);
    expect(s.assignedToday).toBe(0);
    expect(s.agingFresh).toBe(0);
  });

  it('RBAC: FIELD_AGENT has no page.dashboard → 403', async () => {
    const res = await request(app).get('/api/v2/dashboard/stats').set(hdr('FIELD_AGENT', agentId));
    expect(res.status).toBe(403);
  });

  // ── Slice 3: office queue (KYC_VERIFIER) ──

  it('KYC_VERIFIER sees their own OFFICE task (office-scoped queue), not the field work', async () => {
    const res = await request(app).get('/api/v2/dashboard/stats').set(hdr('KYC_VERIFIER', kycId));
    expect(res.status).toBe(200);
    const s = res.body as DashboardStats;
    // Their one assigned OFFICE task shows; the FIELD agent's task is out of their SELF-scope.
    expect(s.assigned).toBe(1);
    expect(s.assignedToday).toBe(1);
  });

  // ── Slice 4: portfolio rollup (page.dashboard — scoped per role, not billing-gated) ──

  it('SUPER_ADMIN portfolio returns client × product rollup with truthful counts', async () => {
    const res = await request(app).get('/api/v2/dashboard/portfolio').set(SA);
    expect(res.status).toBe(200);
    const rows = res.body as { clientName: string; productName: string; total: number }[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const seededRow = rows.find((r) => r.total >= 1);
    expect(seededRow).toBeDefined();
  });

  it('RBAC: portfolio is a dashboard view (page.dashboard) — every web role gets it (scoped); FIELD_AGENT 403', async () => {
    // The portfolio is part of the dashboard and self-scopes in the repo (resolveScope), so every
    // page.dashboard role sees its OWN slice. Only FIELD_AGENT (no page.dashboard) is forbidden.
    expect((await request(app).get('/api/v2/dashboard/portfolio').set(hdr('TEAM_LEADER', tlId))).status).toBe(
      200,
    );
    expect(
      (await request(app).get('/api/v2/dashboard/portfolio').set(hdr('BACKEND_USER', tlId))).status,
    ).toBe(200);
    expect(
      (await request(app).get('/api/v2/dashboard/portfolio').set(hdr('KYC_VERIFIER', kycId))).status,
    ).toBe(200);
    expect(
      (await request(app).get('/api/v2/dashboard/portfolio').set(hdr('FIELD_AGENT', agentId))).status,
    ).toBe(403);
  });
});
