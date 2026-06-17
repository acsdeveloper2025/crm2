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
const SA = authHeaderForRole('SUPER_ADMIN');
const TL = authHeaderForRole('TEAM_LEADER'); // NO data_entry.manage
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const BC = '9876543210';

function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

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

// Data entry is per CASE (ADR-0037) — a case (with applicants) is all that's needed; documents/tasks
// are not a prerequisite for keying the case's MIS fields.
async function seedCase(ctx: { clientId: number; productId: number }): Promise<string> {
  const created = seeded<{ id: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        backendContactNumber: BC,
        applicants: [{ name: 'DE APP' }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      }),
  );
  return created.id;
}

// A DATA_ENTRY layout column (operator-keyed). Source-type is unused by the data-entry flow (it keys
// by column_key); COMPUTED is the least-wrong until a MANUAL source type is added (carry).
const deCol = (key: string, required: boolean) => ({
  columnKey: key,
  headerLabel: key.toUpperCase(),
  sourceType: 'COMPUTED',
  sourceRef: key,
  dataType: 'TEXT',
  isRequired: required,
});

async function seedDataEntryLayout(ctx: {
  clientId: number;
  productId: number;
}): Promise<{ id: number; version: number }> {
  return seeded<{ id: number; version: number }>(
    await request(app)
      .post('/api/v2/report-layouts')
      .set(SA)
      .send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        kind: 'DATA_ENTRY',
        name: 'DE form',
        columns: [deCol('sampler_name', true), deCol('remark2', false)],
      }),
  );
}

describe.skipIf(!RUN)('data-entry API (ADR-0037 slice 3)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
      'case_data_entries',
      'report_layout_columns',
      'report_layouts',
      'case_tasks',
      'case_applicants',
      'cases',
      'client_product_verification_units',
      'client_products',
      'verification_units',
      'clients',
      'products',
    );
  });

  it('GET returns the active DATA_ENTRY layout + null entry; save keys values; required enforced; OCC on update', async () => {
    const ctx = await seedCpv('DE');
    const caseId = await seedCase(ctx);
    await seedDataEntryLayout(ctx);

    const get1 = await request(app).get(`/api/v2/data-entry/cases/${caseId}`).set(SA);
    expect(get1.status).toBe(200);
    expect(get1.body.layout.kind).toBe('DATA_ENTRY');
    expect(get1.body.layout.columns).toHaveLength(2);
    expect(get1.body.entry).toBeNull();

    // missing the required column → 400
    const bad = await request(app)
      .put(`/api/v2/data-entry/cases/${caseId}`)
      .set(SA)
      .send({ data: { remark2: 'x' } });
    expect(bad.status).toBe(400);

    // valid save → entry v1; unknown keys dropped
    const ok = await request(app)
      .put(`/api/v2/data-entry/cases/${caseId}`)
      .set(SA)
      .send({ data: { sampler_name: 'RAVI', remark2: 'fine', bogus: 'drop me' } });
    expect(ok.status).toBe(200);
    expect(ok.body.entry.version).toBe(1);
    expect(ok.body.entry.data).toEqual({ sampler_name: 'RAVI', remark2: 'fine' });

    // re-save without version → 400 VERSION_REQUIRED; stale version → 409; correct version → v2
    expect(
      (
        await request(app)
          .put(`/api/v2/data-entry/cases/${caseId}`)
          .set(SA)
          .send({ data: { sampler_name: 'X' } })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .put(`/api/v2/data-entry/cases/${caseId}`)
          .set(SA)
          .send({ data: { sampler_name: 'X' }, version: 99 })
      ).status,
    ).toBe(409);
    const v2 = await request(app)
      .put(`/api/v2/data-entry/cases/${caseId}`)
      .set(SA)
      .send({ data: { sampler_name: 'MEENA' }, version: 1 });
    expect(v2.status).toBe(200);
    expect(v2.body.entry.version).toBe(2);
    expect(v2.body.entry.data.sampler_name).toBe('MEENA');
  });

  it('a layout with keyed data is immutable-once-used: columns 409, rename OK', async () => {
    const ctx = await seedCpv('IMM');
    const caseId = await seedCase(ctx);
    const layout = await seedDataEntryLayout(ctx);
    await request(app)
      .put(`/api/v2/data-entry/cases/${caseId}`)
      .set(SA)
      .send({ data: { sampler_name: 'RAVI' } });

    // changing columns now → 409 REPORT_LAYOUT_IN_USE
    const cols = await request(app)
      .put(`/api/v2/report-layouts/${layout.id}`)
      .set(SA)
      .send({ version: layout.version, columns: [deCol('sampler_name', true)] });
    expect(cols.status).toBe(409);
    expect(cols.body.error).toBe('REPORT_LAYOUT_IN_USE');
    // rename-only is still allowed
    expect(
      (
        await request(app)
          .put(`/api/v2/report-layouts/${layout.id}`)
          .set(SA)
          .send({ name: 'DE v2', version: layout.version })
      ).status,
    ).toBe(200);
  });

  it('no DATA_ENTRY layout configured → 400; gating + scope', async () => {
    const ctx = await seedCpv('GATE');
    const caseId = await seedCase(ctx);
    // no layout yet → GET 200 with layout null; save → 400 NOT_CONFIGURED
    const get = await request(app).get(`/api/v2/data-entry/cases/${caseId}`).set(SA);
    expect(get.status).toBe(200);
    expect(get.body.layout).toBeNull();
    const save = await request(app).put(`/api/v2/data-entry/cases/${caseId}`).set(SA).send({ data: {} });
    expect(save.status).toBe(400);
    expect(save.body.error).toBe('DATA_ENTRY_LAYOUT_NOT_CONFIGURED');

    // RBAC: TEAM_LEADER lacks data_entry.manage → 403
    expect((await request(app).get(`/api/v2/data-entry/cases/${caseId}`).set(TL)).status).toBe(403);
    // absent / non-uuid task
    expect(
      (await request(app).get('/api/v2/data-entry/cases/00000000-0000-0000-0000-0000000000ff').set(SA))
        .status,
    ).toBe(404);
    expect((await request(app).get('/api/v2/data-entry/cases/not-a-uuid').set(SA)).status).toBe(400);
    // the PUT branch is scope-guarded the same way (absent/out-of-scope → 404, IDOR-safe)
    expect(
      (
        await request(app)
          .put('/api/v2/data-entry/cases/00000000-0000-0000-0000-0000000000ff')
          .set(SA)
          .send({ data: {} })
      ).status,
    ).toBe(404);
  });

  it('pickup: derived bank + docs, computed TAT, keyed save, OCC, gating + scope', async () => {
    const ctx = await seedCpv('PU');
    const caseId = await seedCase(ctx);
    // add a task so pickupForDocuments resolves to the verification-unit name
    const applicantId = seeded<{ applicants: { id: string }[] }>(
      await request(app).get(`/api/v2/cases/${caseId}`).set(SA),
    ).applicants[0]!.id;
    seeded(
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks`)
        .set(SA)
        .send({
          tasks: [{ verificationUnitId: ctx.unitId, applicantId, address: '12 MG ROAD', trigger: 'x' }],
        }),
    );

    // GET → derived bank + docs, no pickup row yet, TAT null
    const get1 = await request(app).get(`/api/v2/data-entry/cases/${caseId}/pickup`).set(SA);
    expect(get1.status).toBe(200);
    expect(typeof get1.body.bankName).toBe('string');
    expect(get1.body.bankName.length).toBeGreaterThan(0);
    expect(get1.body.pickupForDocuments.length).toBeGreaterThan(0);
    expect(get1.body.pickup).toBeNull();
    expect(get1.body.timeOfVerificationDays).toBeNull();

    // save → row v1, sampler kept, TAT computed (2 days)
    const ok = await request(app).put(`/api/v2/data-entry/cases/${caseId}/pickup`).set(SA).send({
      pickupDate: '2024-02-22T00:00:00.000Z',
      reportedDate: '2024-02-24T00:00:00.000Z',
      pickupTrigger: 'NA',
      samplerName: 'OFFICE SAMPLER',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.pickup.version).toBe(1);
    expect(ok.body.pickup.samplerName).toBe('OFFICE SAMPLER');
    expect(ok.body.timeOfVerificationDays).toBe(2);

    // OCC: no version → 400; stale → 409; correct → v2
    expect(
      (
        await request(app)
          .put(`/api/v2/data-entry/cases/${caseId}/pickup`)
          .set(SA)
          .send({ pickupTrigger: 'X' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .put(`/api/v2/data-entry/cases/${caseId}/pickup`)
          .set(SA)
          .send({ pickupTrigger: 'X', version: 99 })
      ).status,
    ).toBe(409);
    const v2 = await request(app)
      .put(`/api/v2/data-entry/cases/${caseId}/pickup`)
      .set(SA)
      .send({ pickupTrigger: 'WALK-IN', version: 1 });
    expect(v2.status).toBe(200);
    expect(v2.body.pickup.version).toBe(2);
    expect(v2.body.pickup.pickupTrigger).toBe('WALK-IN');

    // RBAC + scope (both verbs 404-as-absent, IDOR-safe)
    expect((await request(app).get(`/api/v2/data-entry/cases/${caseId}/pickup`).set(TL)).status).toBe(403);
    expect(
      (await request(app).get('/api/v2/data-entry/cases/00000000-0000-0000-0000-0000000000ff/pickup').set(SA))
        .status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .put('/api/v2/data-entry/cases/00000000-0000-0000-0000-0000000000ff/pickup')
          .set(SA)
          .send({ pickupTrigger: 'X' })
      ).status,
    ).toBe(404);
  });
});
