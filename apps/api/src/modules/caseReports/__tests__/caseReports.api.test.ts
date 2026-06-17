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
import { setStorage, type StorageProvider } from '../../../platform/storage/index.js';
import { awaitAllJobs } from '../../../platform/jobs/index.js';
import { closePdfBrowser } from '../../../platform/pdf/index.js';

/** Fake object store so attachment URL signing works without MinIO/S3. */
const fakeStorage: StorageProvider = {
  put: (key) => Promise.resolve({ key }),
  get: () => Promise.resolve(Buffer.from('')),
  signedUrl: (key) => Promise.resolve(`https://signed.example/${key}`),
  remove: () => Promise.resolve(),
};

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const SA_UID = '00000000-0000-0000-0000-000000000001';
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

describe.skipIf(!RUN)('case-report preview API (ADR-0041 S5 slice 1)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
    setStorage(fakeStorage);
  });
  afterAll(async () => {
    await closePdfBrowser();
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
      'case_attachments',
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

  it('assembles a CaseReportContext: case head + applicants + per-task narrative + photos + totals', async () => {
    const ctx = await seedCpv('PV');
    const { caseId, taskId } = await seedCaseWithTask(ctx);

    // device-submitted form data on the task
    await db!.pool.query('UPDATE case_tasks SET form_data = $1::jsonb WHERE id = $2', [
      JSON.stringify({
        [ctx.unitCode]: { formData: { area: 'BTM LAYOUT' }, verificationOutcome: 'POSITIVE' },
      }),
      taskId,
    ]);

    // a FIELD_REPORT template so per-task narrative renders (otherwise narrative=null is also valid)
    seeded(
      await request(app)
        .post('/api/v2/report-layouts')
        .set(SA)
        .send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          kind: 'FIELD_REPORT',
          name: 'Per-task',
          verificationType: ctx.unitCode,
          templateBody: 'Visited {{addr}} for {{applicant}} in {{loc}}.',
          columns: [
            {
              columnKey: 'loc',
              headerLabel: 'loc',
              sourceType: 'FORM_DATA_PATH',
              sourceRef: `${ctx.unitCode}.formData.area`,
              dataType: 'TEXT',
            },
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

    // two FIELD_PHOTOs on the task — one with a frozen address, one without
    await db!.pool.query(
      `INSERT INTO case_attachments
         (case_id, task_id, kind, photo_type, original_name, mime_type, file_size,
          storage_key, sha256, geo_location, reverse_geocoded_address, uploaded_by, created_at)
       VALUES ($1, $2, 'FIELD_PHOTO', 'RESIDENCE_FRONT', 'a.jpg', 'image/jpeg', 10,
               'k/a.jpg', repeat('a', 64), $3::jsonb, 'MG Road, Bengaluru', $5::uuid, now()),
              ($1, $2, 'FIELD_PHOTO', 'RESIDENCE_BACK',  'b.jpg', 'image/jpeg', 10,
               'k/b.jpg', repeat('b', 64), $4::jsonb, NULL,                 $5::uuid, now())`,
      [
        caseId,
        taskId,
        JSON.stringify({ latitude: 12.97, longitude: 77.59, accuracy: 8, timestamp: '2026-06-17T10:00:00Z' }),
        JSON.stringify({ latitude: 12.98, longitude: 77.6, accuracy: 12, timestamp: '2026-06-17T10:05:00Z' }),
        SA_UID,
      ],
    );

    const res = await request(app).get(`/api/v2/cases/${caseId}/report/preview`).set(SA);
    expect(res.status).toBe(200);

    // case head
    expect(res.body.case.caseNumber).toBeDefined();
    expect(res.body.case.customerName).toBe('RAJESH KUMAR');
    expect(res.body.case.panNumber).toBe('ABCDE1234F');
    expect(res.body.case.status).toBeDefined();
    expect(res.body.case.verificationOutcome).toBeNull(); // not finalized

    // single-layer result invariant: response carries verificationOutcome (the OFFICIAL column),
    // no FE-only or task_backend_reviews field
    expect(res.body.case).not.toHaveProperty('feVerdict');

    // client/product
    expect(res.body.client.id).toBe(ctx.clientId);
    expect(res.body.product.id).toBe(ctx.productId);

    // applicants
    expect(res.body.applicants).toHaveLength(1);
    expect(res.body.applicants[0].isPrimary).toBe(true);

    // per-task: outcome null (no result yet), narrative rendered, sections present, photos grouped
    expect(res.body.tasks).toHaveLength(1);
    const task = res.body.tasks[0];
    expect(task.id).toBe(taskId);
    expect(task.verificationType).toBe(ctx.unitCode);
    expect(task.narrative).toBe('Visited 12 MG ROAD for RAJESH KUMAR in BTM LAYOUT.');
    expect(task.sections[0].fields).toEqual([
      { label: 'Area', value: 'BTM LAYOUT' },
      { label: 'Verification Outcome', value: 'POSITIVE' },
    ]);
    expect(task.photos).toHaveLength(2);
    const [p1, p2] = task.photos;
    expect(p1.photoType).toBe('RESIDENCE_FRONT');
    expect(p1.url).toBe('https://signed.example/k/a.jpg');
    expect(p1.reverseGeocodedAddress).toBe('MG Road, Bengaluru');
    expect(p1.latitude).toBe(12.97);
    expect(p1.captureTime).toBe('2026-06-17T10:00:00Z');
    expect(p2.reverseGeocodedAddress).toBeNull(); // not yet resolved — renderer would resolve-on-demand

    // totals
    expect(res.body.totals).toEqual({
      totalTasks: 1,
      completedTasks: 0,
      positiveTasks: 0,
      negativeTasks: 0,
      referTasks: 0,
      fraudTasks: 0,
      photoCount: 2,
    });

    // generation block
    expect(res.body.generation.generatedById).toBeTruthy();
    expect(res.body.generation.generatedAt).toBeTruthy();

    // layout = null (no CASE_REPORT layout configured yet → renderer will fall back to built-in default)
    expect(res.body.layout).toBeNull();
  });

  it('surfaces the active CASE_REPORT layout pointer when one is configured', async () => {
    const ctx = await seedCpv('LAY');
    const { caseId } = await seedCaseWithTask(ctx);
    // Insert a CASE_REPORT layout directly (Slice 3 wires the Designer; Slice 1 just needs the read).
    await db!.pool.query(
      `INSERT INTO report_layouts
         (client_id, product_id, kind, name, template_body, page_size, page_orientation,
          is_active, version, created_by, updated_by)
       VALUES ($1, $2, 'CASE_REPORT', 'Default Client Report', '<html>X</html>', 'A4', 'portrait',
               true, 1, NULL, NULL)`,
      [ctx.clientId, ctx.productId],
    );

    const res = await request(app).get(`/api/v2/cases/${caseId}/report/preview`).set(SA);
    expect(res.status).toBe(200);
    expect(res.body.layout).toMatchObject({
      name: 'Default Client Report',
      pageSize: 'A4',
      pageOrientation: 'portrait',
      version: 1,
    });
  });

  it('non-uuid → 400; absent case → 404 (IDOR-safe scope guard)', async () => {
    expect((await request(app).get('/api/v2/cases/not-a-uuid/report/preview').set(SA)).status).toBe(400);
    expect(
      (await request(app).get('/api/v2/cases/00000000-0000-0000-0000-0000000000ff/report/preview').set(SA))
        .status,
    ).toBe(404);
  });

  it('report.html renders text/html with the case content + output-encodes a malicious applicant name', async () => {
    const ctx = await seedCpv('HTML');
    const { caseId } = await seedCaseWithTask(ctx);
    // Poison the applicant name with an XSS payload (the device/office could submit this).
    await db!.pool.query(`UPDATE case_applicants SET name = $1 WHERE case_id = $2`, [
      '<script>alert(1)</script>',
      caseId,
    ]);

    const res = await request(app).get(`/api/v2/cases/${caseId}/report.html`).set(SA);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<!doctype html>');
    expect(res.text).toContain('Verifications'); // built-in default rendered
    // Security BLOCK-level: the payload is escaped, no live <script> in the output.
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('report.html renders the active CASE_REPORT layout body (admin template) end-to-end', async () => {
    const ctx = await seedCpv('CRLAY');
    const { caseId } = await seedCaseWithTask(ctx);
    await db!.pool.query(
      `INSERT INTO report_layouts
         (client_id, product_id, kind, name, template_body, page_size, page_orientation,
          is_active, version, created_by, updated_by)
       VALUES ($1, $2, 'CASE_REPORT', 'Custom', $3, 'A4', 'portrait', true, 1, NULL, NULL)`,
      [
        ctx.clientId,
        ctx.productId,
        '<main data-tpl="custom"><h1>{{client.name}}</h1>{{case.caseNumber}}</main>',
      ],
    );

    const res = await request(app).get(`/api/v2/cases/${caseId}/report.html`).set(SA);
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-tpl="custom"'); // the admin body rendered, not the built-in default
    expect(res.text).not.toContain('<!doctype html>'); // built-in default's marker is absent
    expect(res.text).toContain('CASE-'); // case number interpolated + escaped
  });

  it('report.html 400 on bad UUID; 404 on unknown case', async () => {
    expect((await request(app).get('/api/v2/cases/not-a-uuid/report.html').set(SA)).status).toBe(400);
    expect(
      (await request(app).get('/api/v2/cases/00000000-0000-0000-0000-0000000000ff/report.html').set(SA))
        .status,
    ).toBe(404);
  });

  it('POST /report enqueues a CASE_REPORT job → runs → SUCCEEDED with a downloadable PDF artifact', async () => {
    const ctx = await seedCpv('PDF');
    const { caseId } = await seedCaseWithTask(ctx);

    // 202 + PENDING JobView
    const enq = await request(app).post(`/api/v2/cases/${caseId}/report`).set(SA);
    expect(enq.status).toBe(202);
    expect(enq.body.type).toBe('CASE_REPORT');
    expect(enq.body.status).toBe('PENDING');
    const jobId = enq.body.id as string;

    // The in-process worker runs the real Puppeteer render (no Valkey in tests).
    await awaitAllJobs();

    // Job reaches SUCCEEDED with an artifact pointer.
    const job = await request(app).get(`/api/v2/jobs/${jobId}`).set(SA);
    expect(job.status).toBe(200);
    expect(job.body.status).toBe('SUCCEEDED');
    expect(job.body.result.storageKey).toMatch(/^case-reports\/.+\.pdf$/);
    expect(job.body.result.filename).toMatch(/^report-CASE-.+\.pdf$/);

    // Download = the shared presigned-URL path (jobs.resultUrl), reused for free.
    const dl = await request(app).get(`/api/v2/jobs/${jobId}/result-url`).set(SA);
    expect(dl.status).toBe(200);
    expect(dl.body.url).toContain(job.body.result.storageKey);
    expect(dl.body.filename).toBe(job.body.result.filename);
  });

  it('POST /report?format=docx → runs → SUCCEEDED with a downloadable .docx artifact', async () => {
    const ctx = await seedCpv('DOCX');
    const { caseId } = await seedCaseWithTask(ctx);

    const enq = await request(app).post(`/api/v2/cases/${caseId}/report?format=docx`).set(SA);
    expect(enq.status).toBe(202);
    expect(enq.body.type).toBe('CASE_REPORT');
    const jobId = enq.body.id as string;

    await awaitAllJobs();

    const job = await request(app).get(`/api/v2/jobs/${jobId}`).set(SA);
    expect(job.status).toBe(200);
    expect(job.body.status).toBe('SUCCEEDED');
    expect(job.body.result.storageKey).toMatch(/^case-reports\/.+\.docx$/);
    expect(job.body.result.filename).toMatch(/^report-CASE-.+\.docx$/);
    expect(job.body.result.format).toBe('docx');
  });

  it('POST /report?format=xlsx → runs → SUCCEEDED with a downloadable .xlsx artifact', async () => {
    const ctx = await seedCpv('XLSX');
    const { caseId } = await seedCaseWithTask(ctx);

    const enq = await request(app).post(`/api/v2/cases/${caseId}/report?format=xlsx`).set(SA);
    expect(enq.status).toBe(202);
    const jobId = enq.body.id as string;

    await awaitAllJobs();

    const job = await request(app).get(`/api/v2/jobs/${jobId}`).set(SA);
    expect(job.status).toBe(200);
    expect(job.body.status).toBe('SUCCEEDED');
    expect(job.body.result.storageKey).toMatch(/^case-reports\/.+\.xlsx$/);
    expect(job.body.result.filename).toMatch(/^report-CASE-.+\.xlsx$/);
    expect(job.body.result.format).toBe('xlsx');
  });

  it('POST /report 400 on bad UUID / bad format; 404 on unknown/out-of-scope case (IDOR-safe)', async () => {
    expect((await request(app).post('/api/v2/cases/not-a-uuid/report').set(SA)).status).toBe(400);
    const ctx = await seedCpv('FMT');
    const { caseId } = await seedCaseWithTask(ctx);
    expect((await request(app).post(`/api/v2/cases/${caseId}/report?format=exe`).set(SA)).status).toBe(400);
    expect(
      (await request(app).post('/api/v2/cases/00000000-0000-0000-0000-0000000000ff/report').set(SA)).status,
    ).toBe(404);
  });
});
