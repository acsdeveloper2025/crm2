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
      .send(clientFactory({ code: `FC_${tag}` })),
  ).id;
  const productId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/products')
      .set(SA)
      .send(productFactory({ code: `FP_${tag}` })),
  ).id;
  const unitId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: `FU_${tag}` })),
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

/** A case with one unlocated task (no territory gate → assignable to any FIELD agent). */
async function seedAssignedTask(
  ctx: { clientId: number; productId: number; unitId: number },
  agentId: string,
): Promise<void> {
  const created = seeded<{ id: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        backendContactNumber: BC,
        applicants: [{ name: 'Field Roster Applicant', mobile: '9000012345' }],
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
      .send({ tasks: [{ verificationUnitId: ctx.unitId, applicantId, address: '12 MG Road' }] }),
  );
  const taskId = tasks[0]!.id;
  const assigned = await request(app)
    .post(`/api/v2/cases/${created.id}/tasks/${taskId}/assign`)
    .set(SA)
    .send({ assignedTo: agentId, visitType: 'FIELD', billCount: 1, version: 1 });
  expect(assigned.status).toBe(200);
}

describe.skipIf(!RUN)('Field Monitoring console (ADR-0026)', () => {
  let agentId: string;
  let tlId: string;

  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
    agentId = await createUser({ username: 'fm_agent', name: 'FM Field Agent', role: 'FIELD_AGENT' });
    tlId = await createUser({ username: 'fm_tl', name: 'FM Team Leader', role: 'TEAM_LEADER' });
    const ctx = await seedCpvUnit('ROSTER');
    await seedAssignedTask(ctx, agentId);
  });
  afterAll(async () => {
    await db!.end();
  });

  it('SUPER_ADMIN sees the field agent with its open workload', async () => {
    const res = await request(app).get('/api/v2/field-monitoring/agents?limit=100').set(SA);
    expect(res.status).toBe(200);
    const row = res.body.items.find((a: { id: string }) => a.id === agentId);
    expect(row).toBeDefined();
    expect(row.openTasks).toBeGreaterThanOrEqual(1);
    expect(row.lastActivityAt).not.toBeNull();
    expect(row.lastLat).toBeNull(); // no GPS producer yet (forward-prep)
    expect(row.territoryPincodes).toBe(0);
  });

  it('stats reflect the scoped population', async () => {
    const res = await request(app).get('/api/v2/field-monitoring/stats').set(SA);
    expect(res.status).toBe(200);
    expect(res.body.agents).toBeGreaterThanOrEqual(1);
    expect(res.body.openTasks).toBeGreaterThanOrEqual(1);
    expect(res.body.withOpenWork).toBeGreaterThanOrEqual(1);
  });

  it('hierarchy scope: a TEAM_LEADER with no reports sees ZERO field agents', async () => {
    const res = await request(app)
      .get('/api/v2/field-monitoring/agents?limit=100')
      .set(hdr('TEAM_LEADER', tlId));
    expect(res.status).toBe(200);
    expect(res.body.items.some((a: { id: string }) => a.id === agentId)).toBe(false);
    const stats = await request(app).get('/api/v2/field-monitoring/stats').set(hdr('TEAM_LEADER', tlId));
    expect(stats.body.agents).toBe(0);
  });

  it('RBAC: a role without page.field_monitoring is forbidden', async () => {
    const res = await request(app).get('/api/v2/field-monitoring/agents').set(hdr('FIELD_AGENT', agentId));
    expect(res.status).toBe(403);
  });

  it('export returns a spreadsheet of the roster', async () => {
    const res = await request(app).get('/api/v2/field-monitoring/export?format=csv&mode=all').set(SA);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Agent');
  });

  // ── Request location ping (ADR-0027 phase 2) ──

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it('request-location returns a requestId; tokensTargeted reflects registered tokens', async () => {
    // No device token yet → socket-only ping (push is a disabled no-op without a service account).
    const r1 = await request(app).post(`/api/v2/field-monitoring/agents/${agentId}/request-location`).set(SA);
    expect(r1.status).toBe(200);
    expect(r1.body.requestId).toMatch(UUID);
    expect(r1.body.tokensTargeted).toBe(0);

    // The device registers its FCM token (own user) → next ping targets it.
    const reg = await request(app)
      .post('/api/v2/auth/notifications/register')
      .set(hdr('FIELD_AGENT', agentId))
      .send({ pushToken: 'fcm-token-abc', platform: 'ANDROID', deviceId: 'dev-1' });
    expect(reg.status).toBe(200);
    expect(reg.body).toMatchObject({ platform: 'ANDROID', isActive: true });

    const r2 = await request(app).post(`/api/v2/field-monitoring/agents/${agentId}/request-location`).set(SA);
    expect(r2.body.tokensTargeted).toBe(1);
  });

  it('request-location is scope-guarded (out-of-scope TEAM_LEADER → 404, IDOR-safe)', async () => {
    const res = await request(app)
      .post(`/api/v2/field-monitoring/agents/${agentId}/request-location`)
      .set(hdr('TEAM_LEADER', tlId));
    expect(res.status).toBe(404);
  });

  it('request-location rejects a malformed agent id with 404', async () => {
    const res = await request(app)
      .post('/api/v2/field-monitoring/agents/not-a-uuid/request-location')
      .set(SA);
    expect(res.status).toBe(404);
  });

  it('request-location requires page.field_monitoring (FIELD_AGENT → 403)', async () => {
    const res = await request(app)
      .post(`/api/v2/field-monitoring/agents/${agentId}/request-location`)
      .set(hdr('FIELD_AGENT', agentId));
    expect(res.status).toBe(403);
  });
});
