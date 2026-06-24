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
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const BC = '9876543210';

function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

async function seedCpv(
  tag: string,
): Promise<{ clientId: number; productId: number; unitId: number; unitCode: string }> {
  const unitCode = `U_${tag}`;
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
      .send(verificationUnitFactory({ code: unitCode })),
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
  return { clientId, productId, unitId, unitCode };
}

/** Seed a case + one task; return {caseId, taskId}. */
async function seedCaseWithTask(ctx: {
  clientId: number;
  productId: number;
  unitId: number;
}): Promise<{ caseId: string; taskId: string }> {
  const caseId = seeded<{ id: string }>(
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId: ctx.clientId,
        productId: ctx.productId,
        backendContactNumber: BC,
        applicants: [{ name: 'RAJESH KUMAR', pan: 'ABCDE1234F' }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      }),
  ).id;
  const applicantId = seeded<{ applicants: { id: string }[] }>(
    await request(app).get(`/api/v2/cases/${caseId}`).set(SA),
  ).applicants[0]!.id;
  seeded(
    await request(app)
      .post(`/api/v2/cases/${caseId}/tasks`)
      .set(SA)
      .send({
        tasks: [{ verificationUnitId: ctx.unitId, applicantId, address: '12 MG ROAD', trigger: 'NEW' }],
      }),
  );
  const [task] = (await db!.pool.query('SELECT id FROM case_tasks WHERE case_id = $1', [caseId])).rows;
  return { caseId, taskId: (task as { id: string }).id };
}

const frCol = (columnKey: string, sourceRef: string) => ({
  columnKey,
  headerLabel: columnKey,
  sourceType: 'FORM_DATA_PATH',
  sourceRef,
  dataType: 'TEXT',
});

async function createUser(username: string, role: string): Promise<string> {
  const res = await request(app).post('/api/v2/users').set(SA).send({ username, name: username, role });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });
const assignTo = (caseId: string, taskId: string, fa: string) =>
  request(app)
    .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
    .set(SA)
    .send({ assignedTo: fa, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1, version: 1 });

describe.skipIf(!RUN)('field-report API (ADR-0039)', () => {
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
      'case_tasks',
      'case_applicants',
      'cases',
      'client_product_verification_units',
      'client_products',
      'verification_units',
      'clients',
      'products',
      'users', // CASCADE clears the test users + their assignments/scope (the task-grain scope test seeds these)
    );
  });

  it('renders the active FIELD_REPORT for a task against its form_data + context', async () => {
    const ctx = await seedCpv('FR');
    const { caseId, taskId } = await seedCaseWithTask(ctx);
    // Inject a device form blob on the task. NOTE: the engine walks WHATEVER top-level key the
    // template's FORM_DATA_PATH refs (it's path-faithful). On a REAL device the top-level key is the
    // lowercase form SLUG (e.g. `residence`); the verification_type that SELECTS the template is the
    // unit CODE (e.g. RESIDENCE) — two independent things. Here we key the blob by the synthetic unit
    // code and author the template's paths to match, which exercises the path-walk end to end.
    await db!.pool.query('UPDATE case_tasks SET form_data = $1::jsonb WHERE id = $2', [
      JSON.stringify({
        [ctx.unitCode]: { formData: { area: 'BTM LAYOUT' }, verificationOutcome: 'POSITIVE' },
      }),
      taskId,
    ]);
    // a FIELD_REPORT layout keyed by the unit code
    seeded(
      await request(app)
        .post('/api/v2/report-layouts')
        .set(SA)
        .send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          kind: 'FIELD_REPORT',
          name: 'Residence Report',
          verificationType: ctx.unitCode,
          // NB: variable keys must NOT collide with a helper name (e.g. `area` is a helper) — use `loc`.
          templateBody:
            'Visited {{addr}} for {{applicant}}. Area: {{loc}}.{{#eq outcome "POSITIVE"}} Marked positive.{{/eq}}',
          columns: [
            frCol('loc', `${ctx.unitCode}.formData.area`),
            frCol('outcome', `${ctx.unitCode}.verificationOutcome`),
            {
              columnKey: 'addr',
              headerLabel: 'addr',
              sourceType: 'TASK_FIELD',
              sourceRef: 'address',
              dataType: 'TEXT',
            },
            {
              columnKey: 'applicant',
              headerLabel: 'applicant',
              sourceType: 'APPLICANT_FIELD',
              sourceRef: 'name',
              dataType: 'TEXT',
            },
          ],
        }),
    );

    const res = await request(app).get(`/api/v2/cases/${caseId}/tasks/${taskId}/field-report`).set(SA);
    expect(res.status).toBe(200);
    expect(res.body.verificationType).toBe(ctx.unitCode);
    expect(res.body.layoutName).toBe('RESIDENCE REPORT'); // entity name uppercased on store/return (ADR-0058)
    expect(res.body.narrative).toBe(
      'Visited 12 MG ROAD for RAJESH KUMAR. Area: BTM LAYOUT. Marked positive.',
    );
    // combined view (R1): raw submitted fields come back sectioned, alongside the narrative
    expect(res.body.sections).toHaveLength(1);
    expect(res.body.sections[0].fields).toEqual([
      { label: 'Area', value: 'BTM LAYOUT' },
      { label: 'Verification Outcome', value: 'POSITIVE' },
    ]);
  });

  it('no FIELD_REPORT configured → 200 with narrative null', async () => {
    const ctx = await seedCpv('NOFR');
    const { caseId, taskId } = await seedCaseWithTask(ctx);
    const res = await request(app).get(`/api/v2/cases/${caseId}/tasks/${taskId}/field-report`).set(SA);
    expect(res.status).toBe(200);
    expect(res.body.narrative).toBeNull();
    expect(res.body.layoutId).toBeNull();
    expect(res.body.sections).toEqual([]); // no form_data submitted yet
    expect(res.body.verificationType).toBe(ctx.unitCode);
  });

  it('non-uuid → 400; absent task → 404 (scope-guarded via taskScopePredicate)', async () => {
    const ctx = await seedCpv('GUARD');
    const { caseId } = await seedCaseWithTask(ctx);
    expect(
      (await request(app).get(`/api/v2/cases/${caseId}/tasks/not-a-uuid/field-report`).set(SA)).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get(`/api/v2/cases/${caseId}/tasks/00000000-0000-0000-0000-0000000000ff/field-report`)
          .set(SA)
      ).status,
    ).toBe(404);
    // a task whose case_id ≠ the path case → 404 (cross-case isolation)
    const other = await seedCaseWithTask(await seedCpv('GUARD2'));
    expect(
      (await request(app).get(`/api/v2/cases/${caseId}/tasks/${other.taskId}/field-report`).set(SA)).status,
    ).toBe(404);
  });

  it('is TASK-grain, not case-grain: a co-assigned sibling field agent cannot read another task’s report (A2026-0623-09)', async () => {
    // One case, two tasks on two units, each assigned to a DIFFERENT field agent. fa1 (assigned the
    // sibling taskA) must NOT be able to read taskB's PII form_data just by sharing the case.
    const clientId = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'C_TG' })),
    ).id;
    const productId = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/products')
        .set(SA)
        .send(productFactory({ code: 'P_TG' })),
    ).id;
    const unitA = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'U_TGA' })),
    ).id;
    const unitB = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'U_TGB' })),
    ).id;
    const cpId = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/client-products')
        .set(SA)
        .send({ clientId, productId, effectiveFrom: PAST }),
    ).id;
    for (const verificationUnitId of [unitA, unitB])
      seeded(
        await request(app)
          .post('/api/v2/cpv-units')
          .set(SA)
          .send({ clientProductId: cpId, verificationUnitId, effectiveFrom: PAST }),
      );
    const caseId = seeded<{ id: string }>(
      await request(app)
        .post('/api/v2/cases')
        .set(SA)
        .send({
          clientId,
          productId,
          backendContactNumber: BC,
          applicants: [{ name: 'RAJESH KUMAR', pan: 'ABCDE1234F' }],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        }),
    ).id;
    const applicantId = seeded<{ applicants: { id: string }[] }>(
      await request(app).get(`/api/v2/cases/${caseId}`).set(SA),
    ).applicants[0]!.id;
    seeded(
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks`)
        .set(SA)
        .send({
          tasks: [
            { verificationUnitId: unitA, applicantId, address: '12 MG ROAD', trigger: 'NEW' },
            { verificationUnitId: unitB, applicantId, address: '34 BRIGADE RD', trigger: 'NEW' },
          ],
        }),
    );
    const rows = (
      await db!.pool.query<{ id: string; verification_unit_id: number }>(
        'SELECT id, verification_unit_id FROM case_tasks WHERE case_id = $1',
        [caseId],
      )
    ).rows;
    const taskA = rows.find((r) => r.verification_unit_id === unitA)!.id;
    const taskB = rows.find((r) => r.verification_unit_id === unitB)!.id;
    const fa1 = await createUser('fr_tg1', 'FIELD_AGENT');
    const fa2 = await createUser('fr_tg2', 'FIELD_AGENT');
    expect((await assignTo(caseId, taskA, fa1)).status).toBe(200);
    expect((await assignTo(caseId, taskB, fa2)).status).toBe(200);
    // taskB carries the verifier's PII form_data
    await db!.pool.query('UPDATE case_tasks SET form_data = $1::jsonb WHERE id = $2', [
      JSON.stringify({ U_TGB: { formData: { area: 'SECRET AREA' }, verificationOutcome: 'POSITIVE' } }),
      taskB,
    ]);

    // fa1 holds the SIBLING task (taskA) — must be denied taskB's report (task-grain, IDOR-safe 404)
    const leak = await request(app)
      .get(`/api/v2/cases/${caseId}/tasks/${taskB}/field-report`)
      .set(hdr('FIELD_AGENT', fa1));
    expect(leak.status).toBe(404);
    // fa2 is the actual assignee of taskB → allowed
    const own = await request(app)
      .get(`/api/v2/cases/${caseId}/tasks/${taskB}/field-report`)
      .set(hdr('FIELD_AGENT', fa2));
    expect(own.status).toBe(200);
    // admin (ALL scope) reads any task's report
    expect(
      (await request(app).get(`/api/v2/cases/${caseId}/tasks/${taskB}/field-report`).set(SA)).status,
    ).toBe(200);
  });
});
