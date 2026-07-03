import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
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
import { setGeocoder } from '../../../platform/geocode/index.js';
import { setStaticMapProvider } from '../../../platform/staticmap/index.js';
import { enqueueReverseGeocode, awaitAllReverseGeocodeJobs } from '../../../platform/geocode/queue.js';
import { caseRepository } from '../repository.js';
import { geocodeRepository } from '../../geocode/repository.js';
import { geocodeService } from '../../geocode/service.js';
import { invalidateRoleCache } from '../../../platform/access/index.js';

/** Fake object store (ADR-0021 seam) so attachment tests run with no MinIO/S3. */
const fakeStorage: StorageProvider = {
  put: (key) => Promise.resolve({ key }),
  get: () => Promise.resolve(Buffer.from('')),
  signedUrl: (key) => Promise.resolve(`https://signed.example/${key}`),
  remove: () => Promise.resolve(),
};
const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('mock pdf body')]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const FA = authHeaderForRole('FIELD_AGENT'); // has case.view, NOT case.create
// A day ago — CPV seeded with this effective_from is already-effective, so the immediate
// `effective_from <= now()` enablement gate can't race the clock (see seedCpv).
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
/** Auth header impersonating a specific created user (role + real uuid) — for scope-sensitive paths. */
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });
const BC = '9876543210'; // backend_contact_number — required on create (ADR-0023)
const ADDR = '12 MG ROAD'; // per-task dispatch address (ADR-0023)

/** Add one task to a case (ADR-0023 shape): targets the case's primary applicant. */
async function addTaskFor(caseId: string, unitId: number): Promise<request.Response> {
  const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
  const applicantId = detail.body.applicants[0].id as string;
  return request(app)
    .post(`/api/v2/cases/${caseId}/tasks`)
    .set(SA)
    .send({ tasks: [{ verificationUnitId: unitId, applicantId, address: ADDR }] });
}

/** Attach one office reference document (kind defaults to OFFICE_REF) to a task — a KYC_DOCUMENT unit
 *  requires >=1 document before completion (A2026-0623-16). Creates its own uploader (the test-auth SA
 *  is synthesized, not a `users` row, so uploaded_by needs a real FK target); a monotonic counter keeps
 *  the uploader username unique even when the same task is doc'd twice (seedCaseWithTask + a helper). */
let docUploaderSeq = 0;
async function attachDoc(caseId: string, taskId: string): Promise<void> {
  docUploaderSeq += 1;
  const u = await db!.pool.query<{ id: string }>(
    `INSERT INTO users (id, username, name, role)
     VALUES (gen_random_uuid(), $1, 'Doc Uploader', 'BACKEND_USER')
     RETURNING id`,
    [`doc_up_${docUploaderSeq}`],
  );
  await db!.pool.query(
    `INSERT INTO case_attachments (case_id, task_id, original_name, mime_type, file_size, storage_key, sha256, uploaded_by)
     VALUES ($1, $2, 'doc.pdf', 'application/pdf', 10, $3, 'sha', $4)`,
    [caseId, taskId, `k/${taskId}_${docUploaderSeq}.pdf`, u.rows[0]!.id],
  );
}

interface Ctx {
  clientId: number;
  productId: number;
  enabledUnitId: number;
  disabledUnitId: number;
}

/** Unwrap a seed write, failing LOUDLY with the upstream status+body. Root-cause fix for the
 *  ledger'd flake: a failed seed (load-induced 5xx) used to surface downstream as a mystery
 *  `tasks[0] undefined` instead of the real upstream error. */
function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed write failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

/** Seed a client+product with one CPV-enabled unit and one un-enabled unit. */
async function seedCpv(
  tag: string,
  opts: { workerRole?: 'FIELD_AGENT' | 'KYC_VERIFIER' } = {},
): Promise<Ctx> {
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
  // The enabled unit can be FIELD_AGENT (default) or KYC_VERIFIER — desk-flow tests need a KYC unit so
  // an OFFICE assignment passes the visitType↔worker_role binding (A2026-0623-05).
  const enabledUnitId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(
        verificationUnitFactory({
          code: `UE_${tag}`,
          ...(opts.workerRole ? { workerRole: opts.workerRole } : {}),
        }),
      ),
  ).id;
  const disabledUnitId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: `UD_${tag}` })),
  ).id;
  // Seed CPV already-effective (a day ago) so the immediate `effective_from <= now()` enablement
  // gate (allUnitsEnabled) can't race the clock — defaulting to now() intermittently 400s
  // UNIT_NOT_ENABLED. Test-only; production semantics unchanged.
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
      .send({ clientProductId: cpId, verificationUnitId: enabledUnitId, effectiveFrom: PAST }),
  );
  return { clientId, productId, enabledUnitId, disabledUnitId };
}

describe.skipIf(!RUN)('cases API', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
      'case_attachments',
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
      'locations',
    );
  });

  it('creates a case (201) with a generated case number, status NEW, primary + co-applicants', async () => {
    const { clientId, productId } = await seedCpv('A');
    const res = await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId,
        productId,
        backendContactNumber: BC,
        applicants: [
          { name: 'RAMESH KUMAR', mobile: '9876543210', pan: 'ABCDE1234F' },
          { name: 'SUNITA KUMAR', mobile: '9876500000' },
        ],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      });
    expect(res.status).toBe(201);
    expect(res.body.caseNumber).toMatch(/^CASE-\d{6}$/);
    expect(res.body.status).toBe('NEW');
    expect(res.body.dedupeDecision).toBe('NO_DUPLICATES_FOUND');

    expect(res.body.backendContactNumber).toBe(BC);

    const detail = await request(app).get(`/api/v2/cases/${res.body.id}`).set(SA);
    expect(detail.body.applicantCount).toBe(2);
    expect(detail.body.primaryName).toBe('RAMESH KUMAR');
    expect(detail.body.applicants.find((a: { isPrimary: boolean }) => a.isPrimary).name).toBe('RAMESH KUMAR');
    // every applicant carries a generated calling code (dispatched per task; ADR-0023)
    for (const a of detail.body.applicants as { callingCode: string }[]) {
      expect(a.callingCode).toMatch(/^CC-/);
    }
  });

  // ── column filters (DATAGRID_STANDARD §6/§7) — restricted to cs/pa (the lean COUNT's FROM) ──
  it('f_primaryName (text, on the count-joined pa), f_caseNumber and f_status filter + echo', async () => {
    const { clientId, productId } = await seedCpv('FLT');
    const c1 = (
      await request(app)
        .post('/api/v2/cases')
        .set(SA)
        .send({
          clientId,
          productId,
          backendContactNumber: BC,
          applicants: [{ name: 'ALPHA PERSON' }],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        })
    ).body;
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId,
        productId,
        backendContactNumber: BC,
        applicants: [{ name: 'BETA PERSON' }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      });

    const byName = await request(app).get('/api/v2/cases?f_primaryName=alpha').set(SA);
    expect(byName.body.items.map((c: { primaryName: string }) => c.primaryName)).toEqual(['ALPHA PERSON']);
    expect(byName.body.totalCount).toBe(1); // pa.name filter applied in the lean COUNT too (no divergence)
    expect(byName.body.filters.f_primaryName).toBe('alpha');

    const byNum = await request(app).get(`/api/v2/cases?f_caseNumber=${c1.caseNumber}`).set(SA);
    expect(byNum.body.items.map((c: { caseNumber: string }) => c.caseNumber)).toEqual([c1.caseNumber]);

    expect((await request(app).get('/api/v2/cases?f_status=NEW').set(SA)).body.totalCount).toBe(2);
    expect((await request(app).get('/api/v2/cases?f_status=CANCELLED').set(SA)).body.totalCount).toBe(0);
  });

  it('filters the cases list by productId (navbar selector domain filter, ADR-0066)', async () => {
    const a = await seedCpv('PFA');
    const b = await seedCpv('PFB');
    const mk = (clientId: number, productId: number, name: string) =>
      request(app)
        .post('/api/v2/cases')
        .set(SA)
        .send({
          clientId,
          productId,
          backendContactNumber: BC,
          applicants: [{ name }],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        });
    expect((await mk(a.clientId, a.productId, 'CASE A')).status).toBe(201);
    expect((await mk(b.clientId, b.productId, 'CASE B')).status).toBe(201);

    expect((await request(app).get('/api/v2/cases').set(SA)).body.totalCount).toBe(2);
    const fa = await request(app).get(`/api/v2/cases?productId=${a.productId}`).set(SA);
    expect(fa.body.totalCount).toBe(1);
    expect(fa.body.filters.productId).toBe(a.productId);
    expect((await request(app).get(`/api/v2/cases?productId=${b.productId}`).set(SA)).body.totalCount).toBe(
      1,
    );
  });

  it('create requires a dedupe decision (400) and a rationale when CREATE_NEW despite dups (400)', async () => {
    const { clientId, productId } = await seedCpv('F');
    const noDecision = await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({ clientId, productId, backendContactNumber: BC, applicants: [{ name: 'NO DEC' }] });
    expect(noDecision.status).toBe(400);

    const createNewNoRationale = await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId,
        productId,
        backendContactNumber: BC,
        applicants: [{ name: 'DUP' }],
        dedupeDecision: 'CREATE_NEW',
      });
    expect(createNewNoRationale.status).toBe(400);

    const ok = await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId,
        productId,
        backendContactNumber: BC,
        applicants: [{ name: 'DUP' }],
        dedupeDecision: 'CREATE_NEW',
        dedupeRationale: 'Different loan, same applicant — genuinely new case.',
        dedupeMatches: ['CASE-000001', 'CASE-000002'],
      });
    expect(ok.status).toBe(201);
    expect(ok.body.dedupeDecision).toBe('CREATE_NEW');
    expect(ok.body.dedupeRationale).toContain('DIFFERENT LOAN');
    // the matched case numbers are recorded with the rationale + surface on the detail
    expect(ok.body.dedupeMatchedCaseNumbers).toEqual(['CASE-000001', 'CASE-000002']);
    const detail = await request(app).get(`/api/v2/cases/${ok.body.id}`).set(SA);
    expect(detail.body.dedupeMatchedCaseNumbers).toEqual(['CASE-000001', 'CASE-000002']);
  });

  it('dedupe matches exactly on PAN / mobile / name (OR) across ALL applicants; advisory', async () => {
    const { clientId, productId } = await seedCpv('B');
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId,
        productId,
        backendContactNumber: BC,
        applicants: [
          { name: 'SITA DEVI', mobile: '9000000001', pan: 'PANXX1234X' },
          { name: 'CO APP', mobile: '9000000002' },
        ],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      });

    const byPan = await request(app).post('/api/v2/cases/dedupe').set(SA).send({ pan: 'panxx1234x' });
    expect(byPan.status).toBe(200);
    expect(byPan.body).toHaveLength(1);
    expect(byPan.body[0].matchType).toContain('PAN');

    const byName = await request(app).post('/api/v2/cases/dedupe').set(SA).send({ name: 'sita devi' });
    expect(byName.body[0].matchType).toContain('NAME');

    // a co-applicant's mobile also matches (dedupe spans all applicants)
    const byCoMobile = await request(app).post('/api/v2/cases/dedupe').set(SA).send({ mobile: '9000000002' });
    expect(byCoMobile.body).toHaveLength(1);
    expect(byCoMobile.body[0].matchType).toContain('MOBILE');

    const none = await request(app).post('/api/v2/cases/dedupe').set(SA).send({ mobile: '9999999999' });
    expect(none.body).toHaveLength(0);
  });

  it('dedupe with no criteria → 400 VALIDATION', async () => {
    const res = await request(app).post('/api/v2/cases/dedupe').set(SA).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION');
  });

  it('captures companyName on create and the in-create gate matches on COMPANY (case-insensitive)', async () => {
    const { clientId, productId } = await seedCpv('CO');
    await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId,
        productId,
        backendContactNumber: BC,
        applicants: [
          { name: 'ACME OWNER', mobile: '9000000010', pan: 'COMPX1234X', companyName: 'Acme Industries' },
        ],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      });
    // captured → returned on case detail (every CaseApplicant SELECT includes company_name)
    const caseId = (await request(app).get('/api/v2/cases').set(SA)).body.items[0].id as string;
    const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
    expect(detail.body.applicants[0].companyName).toBe('ACME INDUSTRIES');
    // the in-create dedupe gate matches on company (case-insensitive)
    const gate = await request(app).post('/api/v2/cases/dedupe').set(SA).send({ company: 'acme industries' });
    expect(gate.body).toHaveLength(1);
    expect(gate.body[0].matchType).toContain('COMPANY');
    expect(gate.body[0].companyName).toBe('ACME INDUSTRIES');
  });

  // ── Standalone Dedupe Check page (dedupe.view) ──
  describe('GET /cases/dedupe-search', () => {
    const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });
    const seedApplicant = async (
      tag: string,
      applicant: { name: string; mobile?: string; pan?: string; companyName?: string },
    ): Promise<void> => {
      const { clientId, productId } = await seedCpv(tag);
      seeded(
        await request(app)
          .post('/api/v2/cases')
          .set(SA)
          .send({
            clientId,
            productId,
            backendContactNumber: BC,
            applicants: [applicant],
            dedupeDecision: 'NO_DUPLICATES_FOUND',
          }),
      );
    };

    it('returns the pagination envelope of matches; identifiers incl. company; ≥1 required (400)', async () => {
      await seedApplicant('DS', {
        name: 'RAVI KUMAR',
        mobile: '9000000020',
        pan: 'DSRCH1234X',
        companyName: 'Globex',
      });
      const res = await request(app).get('/api/v2/cases/dedupe-search?pan=dsrch1234x').set(SA);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.totalCount).toBe(1);
      expect(res.body.pageSize).toBe(25); // §4 envelope, default page size
      expect(res.body.items[0].matchType).toContain('PAN');
      expect(res.body.items[0].companyName).toBe('GLOBEX');
      // company is a first-class identifier here too
      const byCompany = await request(app).get('/api/v2/cases/dedupe-search?company=globex').set(SA);
      expect(byCompany.body.items[0].matchType).toContain('COMPANY');
      // no identifier → 400
      expect((await request(app).get('/api/v2/cases/dedupe-search').set(SA)).status).toBe(400);
    });

    it('is gated by dedupe.view: SA/BACKEND_USER 200, FIELD_AGENT/KYC_VERIFIER 403, unauth 401', async () => {
      const url = '/api/v2/cases/dedupe-search?name=anyone';
      expect((await request(app).get(url).set(SA)).status).toBe(200);
      expect((await request(app).get(url).set(authHeaderForRole('BACKEND_USER'))).status).toBe(200);
      expect((await request(app).get(url).set(authHeaderForRole('FIELD_AGENT'))).status).toBe(403);
      expect((await request(app).get(url).set(authHeaderForRole('KYC_VERIFIER'))).status).toBe(403);
      expect((await request(app).get(url)).status).toBe(401);
    });

    it('finds a match OUTSIDE the actor case scope — cross-scope by design (the perm is the gate)', async () => {
      await seedApplicant('XS', { name: 'HIDDEN PERSON', mobile: '9000000030', pan: 'XSCOP1234X' });
      // a BACKEND_USER (hierarchy SELF) who created nothing sees no cases in the scoped list…
      const be = await createUser({ username: 'be_dd_xs', name: 'BE XS', role: 'BACKEND_USER' });
      expect((await request(app).get('/api/v2/cases').set(hdr('BACKEND_USER', be))).body.items).toHaveLength(
        0,
      );
      // …yet dedupe-search still surfaces the duplicate (no scope predicate).
      const dd = await request(app)
        .get('/api/v2/cases/dedupe-search?pan=xscop1234x')
        .set(hdr('BACKEND_USER', be));
      expect(dd.body.items).toHaveLength(1);
    });

    it('exports the matches as CSV (dedupe.view, same gate as the view — BUSINESS_LOGIC-02); a role without it → 403', async () => {
      await seedApplicant('EX', {
        name: 'EXPORT ME',
        mobile: '9000000040',
        pan: 'EXPOR1234X',
        companyName: 'Initech',
      });
      const csv = await request(app)
        .get('/api/v2/cases/dedupe-search/export?format=csv&mode=all&pan=expor1234x')
        .set(SA);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text.split('\r\n')[0]).toBe(
        'Case,Applicant,Company,Mobile,PAN,Status,Client,Created,Matched On',
      );
      expect(csv.text).toContain('EXPORT ME');
      expect(csv.text).toContain('INITECH');
      // export needs dedupe.view — FIELD_AGENT lacks it
      expect((await request(app).get('/api/v2/cases/dedupe-search/export?pan=x').set(FA)).status).toBe(403);
    });
  });

  // ── Main cases-list export (IE-DEFER-3c / H-B3) ──
  describe('GET /cases/export', () => {
    it('exports the cases list as CSV with the DataGrid headers (data.export)', async () => {
      const { clientId, productId } = await seedCpv('CEX');
      await createCase(clientId, productId, 'EXPORT ALPHA');
      const csv = await request(app).get('/api/v2/cases/export?format=csv&mode=all').set(SA);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.headers['content-disposition']).toContain('attachment; filename="cases-');
      expect(csv.text.split('\r\n')[0]).toBe('Case No,Customer,Client,Product,Tasks,Status,Created');
      expect(csv.text).toContain('EXPORT ALPHA');
    });

    it('defaults to xlsx and exports the current page window (mode=current)', async () => {
      const { clientId, productId } = await seedCpv('CEXX');
      await createCase(clientId, productId, 'XLSX PERSON');
      const xlsx = await request(app).get('/api/v2/cases/export').set(SA); // defaults: xlsx + current
      expect(xlsx.status).toBe(200);
      expect(xlsx.headers['content-type']).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(xlsx.headers['content-disposition']).toContain('.xlsx"');
    });

    it('is gated by data.export: FIELD_AGENT/KYC_VERIFIER (case.view, no data.export) → 403, unauth → 401', async () => {
      const url = '/api/v2/cases/export?format=csv&mode=all';
      expect((await request(app).get(url).set(SA)).status).toBe(200);
      expect((await request(app).get(url).set(authHeaderForRole('BACKEND_USER'))).status).toBe(200);
      expect((await request(app).get(url).set(authHeaderForRole('FIELD_AGENT'))).status).toBe(403);
      expect((await request(app).get(url).set(authHeaderForRole('KYC_VERIFIER'))).status).toBe(403);
      expect((await request(app).get(url)).status).toBe(401);
    });

    it('respects the actor case scope — a SELF-scoped user only exports cases in their hierarchy', async () => {
      const { clientId, productId } = await seedCpv('CEXS');
      await createCase(clientId, productId, 'OUT OF SCOPE CASE'); // created by SA, owned by SA
      // a BACKEND_USER (hierarchy SELF) holds data.export but created nothing → no in-scope cases
      const be = await createUser({ username: 'be_cex_scope', name: 'BE SCOPE', role: 'BACKEND_USER' });
      // the scoped list is empty for this user…
      expect((await request(app).get('/api/v2/cases').set(hdr('BACKEND_USER', be))).body.items).toHaveLength(
        0,
      );
      // …and the export inherits that scope — the out-of-scope case is NOT in the file (the header row
      // is always present, but there are no data rows).
      const csv = await request(app)
        .get('/api/v2/cases/export?format=csv&mode=all')
        .set(hdr('BACKEND_USER', be));
      expect(csv.status).toBe(200);
      expect(csv.text).not.toContain('OUT OF SCOPE CASE');
      expect(csv.text.split('\r\n').filter(Boolean)).toHaveLength(1); // header only, no data rows
    });
  });

  it('lists CPV-enabled units and rejects an un-enabled unit on add (400 UNIT_NOT_ENABLED)', async () => {
    const ctx = await seedCpv('C');
    const avail = await request(app)
      .get(`/api/v2/cases/available-units?clientId=${ctx.clientId}&productId=${ctx.productId}`)
      .set(SA);
    expect(avail.status).toBe(200);
    expect(avail.body.map((u: { verificationUnitId: number }) => u.verificationUnitId)).toEqual([
      ctx.enabledUnitId,
    ]);

    const caseId = (
      await request(app)
        .post('/api/v2/cases')
        .set(SA)
        .send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          backendContactNumber: BC,
          applicants: [{ name: 'X' }],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        })
    ).body.id as string;

    const bad = await addTaskFor(caseId, ctx.disabledUnitId);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('UNIT_NOT_ENABLED');
  });

  it('adds per-task specs (applicant + address + numbered) and moves the case to IN_PROGRESS', async () => {
    const ctx = await seedCpv('D');
    const caseId = (
      await request(app)
        .post('/api/v2/cases')
        .set(SA)
        .send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          backendContactNumber: BC,
          applicants: [{ name: 'Y' }],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        })
    ).body.id as string;
    const applicantId = (await request(app).get(`/api/v2/cases/${caseId}`).set(SA)).body.applicants[0]
      .id as string;

    const add = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks`)
      .set(SA)
      .send({
        tasks: [
          {
            verificationUnitId: ctx.enabledUnitId,
            applicantId,
            address: '1 FIRST ST',
            trigger: 'VERIFY RESI',
            priority: 'HIGH',
          },
          { verificationUnitId: ctx.enabledUnitId, applicantId, address: '2 SECOND ST' },
        ],
      });
    expect(add.status).toBe(201);
    expect(add.body).toHaveLength(2);
    // dispatch fields persisted + numbered case_number-<seq>
    expect(add.body[0].applicantId).toBe(applicantId);
    expect(add.body[0].address).toBe('1 FIRST ST');
    expect(add.body[0].trigger).toBe('VERIFY RESI');
    expect(add.body[0].priority).toBe('HIGH');
    expect(add.body[1].priority).toBe('MEDIUM'); // default
    expect(add.body.map((t: { taskNumber: string }) => t.taskNumber)).toEqual([
      expect.stringMatching(/-1$/),
      expect.stringMatching(/-2$/),
    ]);

    const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
    expect(detail.body.status).toBe('IN_PROGRESS');
    expect(detail.body.tasks).toHaveLength(2);
    expect(detail.body.taskCount).toBe(2);
  });

  it('rejects a task targeting an applicant from another case (400 INVALID_APPLICANT)', async () => {
    const ctx = await seedCpv('IA');
    const mk = async (n: string): Promise<string> =>
      (
        await request(app)
          .post('/api/v2/cases')
          .set(SA)
          .send({
            clientId: ctx.clientId,
            productId: ctx.productId,
            backendContactNumber: BC,
            applicants: [{ name: n }],
            dedupeDecision: 'NO_DUPLICATES_FOUND',
          })
      ).body.id as string;
    const caseA = await mk('CASE A APP');
    const caseB = await mk('CASE B APP');
    const otherApplicant = (await request(app).get(`/api/v2/cases/${caseB}`).set(SA)).body.applicants[0]
      .id as string;
    const res = await request(app)
      .post(`/api/v2/cases/${caseA}/tasks`)
      .set(SA)
      .send({
        tasks: [{ verificationUnitId: ctx.enabledUnitId, applicantId: otherApplicant, address: ADDR }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_APPLICANT');
  });

  it('FIELD_AGENT can view/dedupe but cannot create (403); unauth is 401', async () => {
    const { clientId, productId } = await seedCpv('E');
    expect((await request(app).get('/api/v2/cases').set(FA)).status).toBe(200);
    expect((await request(app).post('/api/v2/cases/dedupe').set(FA).send({ pan: 'X1234' })).status).toBe(200);
    const create = await request(app)
      .post('/api/v2/cases')
      .set(FA)
      .send({
        clientId,
        productId,
        backendContactNumber: BC,
        applicants: [{ name: 'Z' }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      });
    expect(create.status).toBe(403);
    expect((await request(app).get('/api/v2/cases')).status).toBe(401);
  });

  // ── DataGrid server-pagination contract (PAGINATION_AND_LOADING_STANDARDS §1/§4) ──
  async function createCase(clientId: number, productId: number, name: string): Promise<void> {
    const res = await request(app)
      .post('/api/v2/cases')
      .set(SA)
      .send({
        clientId,
        productId,
        backendContactNumber: BC,
        applicants: [{ name }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      });
    expect(res.status).toBe(201);
  }

  it('lists cases as a paginated envelope (totals + default sort newest-first)', async () => {
    const { clientId, productId } = await seedCpv('LIST');
    await createCase(clientId, productId, 'ALPHA APPLICANT');
    await createCase(clientId, productId, 'BETA APPLICANT');
    const list = await request(app).get('/api/v2/cases').set(SA);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.totalCount).toBe(2);
    expect(list.body.sort).toEqual({ sortBy: 'createdAt', sortOrder: 'desc' });
  });

  it('paginates and server-sorts by caseNumber asc', async () => {
    const { clientId, productId } = await seedCpv('PAGE');
    await createCase(clientId, productId, 'A');
    await createCase(clientId, productId, 'B');
    await createCase(clientId, productId, 'C');
    const p1 = await request(app).get('/api/v2/cases?limit=2&page=1&sortBy=caseNumber&sortOrder=asc').set(SA);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.totalCount).toBe(3);
    expect(p1.body.totalPages).toBe(2);
    expect(p1.body.items[0].caseNumber < p1.body.items[1].caseNumber).toBe(true);
    const p2 = await request(app).get('/api/v2/cases?limit=2&page=2&sortBy=caseNumber&sortOrder=asc').set(SA);
    expect(p2.body.items).toHaveLength(1);
  });

  it('global search filters by customer name or case number and echoes the filter', async () => {
    const { clientId, productId } = await seedCpv('SRCH');
    await createCase(clientId, productId, 'FINDME KUMAR');
    await createCase(clientId, productId, 'OTHER PERSON');
    const res = await request(app).get('/api/v2/cases?search=FINDME').set(SA);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].primaryName).toBe('FINDME KUMAR');
    expect(res.body.filters.search).toBe('FINDME');
  });

  it('rejects limit > 500 with 400 LIMIT_TOO_LARGE (gate 41)', async () => {
    const res = await request(app).get('/api/v2/cases?limit=501').set(SA);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LIMIT_TOO_LARGE');
  });

  it('unknown sortBy falls back to the default sort (no SQL injection surface)', async () => {
    const { clientId, productId } = await seedCpv('INJ');
    await createCase(clientId, productId, 'X');
    const res = await request(app).get('/api/v2/cases?sortBy=case_number;DROP TABLE cases').set(SA);
    expect(res.status).toBe(200);
    expect(res.body.sort.sortBy).toBe('createdAt'); // default, not the injection string
  });

  // ── Task assignment (ADR-0015 step 1) ──────────────────────────────────────
  async function createUser(o: {
    username: string;
    name: string;
    role: string;
    reportsTo?: string;
    effectiveFrom?: string;
  }): Promise<string> {
    const res = await request(app).post('/api/v2/users').set(SA).send(o);
    expect(res.status).toBe(201);
    const id = res.body.id as string;
    // ADR-0073: OFFICE assignment is now gated by a per-unit grant. Make a test KYC verifier universally
    // OFFICE-eligible (grant every active unit — incl FIELD units, since ADR-0070 decoupled visit type from
    // the unit) so pre-existing desk-flow assertions hold. The gate itself is covered by
    // userKycUnits.api.test.ts. Idempotent.
    if (o.role === 'KYC_VERIFIER')
      await db!.pool.query(
        `INSERT INTO user_kyc_unit_access (user_id, verification_unit_id)
         SELECT $1, vu.id FROM verification_units vu WHERE vu.is_active
         ON CONFLICT DO NOTHING`,
        [id],
      );
    return id;
  }

  async function seedCaseWithTask(
    tag: string,
    opts: { workerRole?: 'FIELD_AGENT' | 'KYC_VERIFIER'; withDoc?: boolean } = {},
  ): Promise<{ caseId: string; taskId: string }> {
    const ctx = await seedCpv(tag, opts.workerRole ? { workerRole: opts.workerRole } : {});
    const caseId = seeded<{ id: string }>(
      await request(app)
        .post('/api/v2/cases')
        .set(SA)
        .send({
          clientId: ctx.clientId,
          productId: ctx.productId,
          backendContactNumber: BC,
          applicants: [{ name: `ASSIGN ${tag}` }],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        }),
    ).id;
    const tasks = seeded<{ id: string }[]>(await addTaskFor(caseId, ctx.enabledUnitId));
    const task = tasks[0];
    if (!task) throw new Error(`seedCaseWithTask(${tag}): add-tasks returned no rows`);
    // KYC desk tasks require document evidence before completion (A2026-0623-16).
    if (opts.withDoc) await attachDoc(caseId, task.id);
    return { caseId, taskId: task.id };
  }

  // ── unified KYC document fields (ADR-0085, mig 0110) ───────────────────────
  describe('unified KYC document fields on add-tasks (ADR-0085)', () => {
    it('persists number/holder/details (uppercased) and returns them on the task view; omitted → null', async () => {
      const ctx = await seedCpv('DOC1', { workerRole: 'KYC_VERIFIER' });
      const caseId = seeded<{ id: string }>(
        await request(app)
          .post('/api/v2/cases')
          .set(SA)
          .send({
            clientId: ctx.clientId,
            productId: ctx.productId,
            backendContactNumber: BC,
            applicants: [{ name: 'DOC ONE' }],
            dedupeDecision: 'NO_DUPLICATES_FOUND',
          }),
      ).id;
      const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
      const applicantId = detail.body.applicants[0].id as string;
      const res = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks`)
        .set(SA)
        .send({
          tasks: [
            {
              verificationUnitId: ctx.enabledUnitId,
              applicantId,
              documentNumber: 'ab12cd3456',
              documentHolderName: 'rahul sharma',
              documentDetails: { 'Bank name': 'hdfc bank', 'Account type': 'savings' },
            },
            { verificationUnitId: ctx.enabledUnitId, applicantId },
          ],
        });
      expect(res.status).toBe(201);
      const [withDoc, bare] = res.body as Array<{
        documentNumber: string | null;
        documentHolderName: string | null;
        documentDetails: Record<string, string> | null;
      }>;
      // ADR-0058 store-uppercase applies to the number, holder, and BOTH sides of each detail.
      expect(withDoc!.documentNumber).toBe('AB12CD3456');
      expect(withDoc!.documentHolderName).toBe('RAHUL SHARMA');
      expect(withDoc!.documentDetails).toEqual({ 'BANK NAME': 'HDFC BANK', 'ACCOUNT TYPE': 'SAVINGS' });
      expect(bare!.documentNumber).toBeNull();
      expect(bare!.documentHolderName).toBeNull();
      expect(bare!.documentDetails).toBeNull();
    });

    it('rejects >12 details and blank labels → 400', async () => {
      const { caseId } = await seedCaseWithTask('DOC2', { workerRole: 'KYC_VERIFIER' });
      const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
      const applicantId = detail.body.applicants[0].id as string;
      const unitId = detail.body.tasks[0].verificationUnitId as number;
      const tooMany = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`K${i}`, 'V']));
      for (const documentDetails of [tooMany, { '   ': 'BLANK LABEL' }]) {
        const res = await request(app)
          .post(`/api/v2/cases/${caseId}/tasks`)
          .set(SA)
          .send({ tasks: [{ verificationUnitId: unitId, applicantId, documentDetails }] });
        expect(res.status).toBe(400);
      }
    });
  });

  // ── case-create RBAC + portfolio scope (ADR-0065; audit SR-1..6) ───────────
  describe('case-create RBAC + portfolio scope (ADR-0065)', () => {
    async function assignScope(userId: string, dimension: string, entityIds: number[]): Promise<void> {
      const r = await request(app)
        .post(`/api/v2/users/${userId}/scope-assignments`)
        .set(SA)
        .send({ dimension, entityIds });
      expect(r.status).toBe(200);
    }
    /** A BACKEND_USER scoped to exactly (clientId, productId). BOTH are required: CLIENT is EXPAND but
     *  PRODUCT is a RESTRICT cap (mig 0049), so a missing product assignment caps creation to nothing. */
    async function backendScoped(tag: string, clientId: number, productId: number): Promise<string> {
      const be = await createUser({ username: `be_sc_${tag}`, name: 'BE SCOPE', role: 'BACKEND_USER' });
      await assignScope(be, 'CLIENT', [clientId]);
      await assignScope(be, 'PRODUCT', [productId]);
      return be;
    }
    const newCase = (clientId: number, productId: number, name: string) => ({
      clientId,
      productId,
      backendContactNumber: BC,
      applicants: [{ name }],
      dedupeDecision: 'NO_DUPLICATES_FOUND' as const,
    });

    it('BACKEND_USER creates a case for its assigned client+product (case.create now granted)', async () => {
      const { clientId, productId } = await seedCpv('SCOK');
      const be = await backendScoped('ok', clientId, productId);
      const res = await request(app)
        .post('/api/v2/cases')
        .set(hdr('BACKEND_USER', be))
        .send(newCase(clientId, productId, 'IN SCOPE'));
      expect(res.status).toBe(201);
    });

    it('BACKEND_USER cannot create a case for a client outside its portfolio (400 CLIENT_OUT_OF_SCOPE)', async () => {
      const inScope = await seedCpv('SCIN');
      const out = await seedCpv('SCOUT');
      const be = await backendScoped('cl', inScope.clientId, inScope.productId);
      const res = await request(app)
        .post('/api/v2/cases')
        .set(hdr('BACKEND_USER', be))
        .send(newCase(out.clientId, out.productId, 'OUT'));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('CLIENT_OUT_OF_SCOPE');
    });

    it('BACKEND_USER cannot create for an out-of-portfolio product (400 PRODUCT_OUT_OF_SCOPE)', async () => {
      const a = await seedCpv('PRA');
      const b = await seedCpv('PRB');
      const be = await backendScoped('pr', a.clientId, a.productId);
      const res = await request(app)
        .post('/api/v2/cases')
        .set(hdr('BACKEND_USER', be))
        .send(newCase(a.clientId, b.productId, 'OUTPROD'));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('PRODUCT_OUT_OF_SCOPE');
    });

    it('BACKEND_USER cannot add tasks to a case outside its scope (404)', async () => {
      const inScope = await seedCpv('TKIN');
      const out = await seedCpv('TKOUT');
      const be = await backendScoped('tk', inScope.clientId, inScope.productId);
      const caseId = seeded<{ id: string }>(
        await request(app)
          .post('/api/v2/cases')
          .set(SA)
          .send(newCase(out.clientId, out.productId, 'OUTCASE')),
      ).id;
      const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
      const applicantId = detail.body.applicants[0].id as string;
      const res = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks`)
        .set(hdr('BACKEND_USER', be))
        .send({ tasks: [{ verificationUnitId: out.enabledUnitId, applicantId, address: ADDR }] });
      expect(res.status).toBe(404);
    });

    it('BACKEND_USER cannot add an applicant to a case outside its scope (404)', async () => {
      const inScope = await seedCpv('APIN');
      const out = await seedCpv('APOUT');
      const be = await backendScoped('ap', inScope.clientId, inScope.productId);
      const caseId = seeded<{ id: string }>(
        await request(app)
          .post('/api/v2/cases')
          .set(SA)
          .send(newCase(out.clientId, out.productId, 'OUTCASE2')),
      ).id;
      const res = await request(app)
        .post(`/api/v2/cases/${caseId}/applicants`)
        .set(hdr('BACKEND_USER', be))
        .send({ name: 'NEW CO' });
      expect(res.status).toBe(404);
    });

    it('available-units rejects an out-of-portfolio client (400)', async () => {
      const inScope = await seedCpv('AUIN');
      const out = await seedCpv('AUOUT');
      const be = await backendScoped('au', inScope.clientId, inScope.productId);
      const r = await request(app)
        .get(`/api/v2/cases/available-units?clientId=${out.clientId}&productId=${out.productId}`)
        .set(hdr('BACKEND_USER', be));
      expect(r.status).toBe(400);
    });

    it('TEAM_LEADER can also create a case (case.create granted; unscoped by dimension)', async () => {
      const { clientId, productId } = await seedCpv('TLOK');
      const tl = await createUser({ username: 'tl_create', name: 'TEAM LEAD', role: 'TEAM_LEADER' });
      const res = await request(app)
        .post('/api/v2/cases')
        .set(hdr('TEAM_LEADER', tl))
        .send(newCase(clientId, productId, 'TL CASE'));
      expect(res.status).toBe(201);
    });
  });

  it('assigns a task to an executive (status ASSIGNED + visit/distance/bill + assignee name)', async () => {
    const { caseId, taskId } = await seedCaseWithTask('AS1');
    const agent = await createUser({ username: 'fa_as1', name: 'FIELD ONE', role: 'FIELD_AGENT' });

    const res = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
      .set(SA)
      .send({ assignedTo: agent, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 2, version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ASSIGNED');
    expect(res.body.assignedTo).toBe(agent);
    expect(res.body.assignedToName).toBe('FIELD ONE');
    expect(res.body.visitType).toBe('FIELD');
    expect(res.body.fieldRateType).toBe('LOCAL');
    expect(res.body.billCount).toBe(2);
    expect(res.body.assignedAt).toBeTruthy();

    const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
    expect(detail.body.tasks[0].status).toBe('ASSIGNED');
    expect(detail.body.tasks[0].assignedToName).toBe('FIELD ONE');

    // Producer (ADR-0027): the assignee receives a CASE_ASSIGNED notification (the type the field app
    // keys on to auto-pull the new task), with the human caseNumber in the payload for the list label.
    const feed = await request(app)
      .get('/api/v2/notifications')
      .set({ 'x-test-auth': `FIELD_AGENT:${agent}` });
    expect(feed.status).toBe(200);
    expect(feed.body.items[0]).toMatchObject({
      type: 'CASE_ASSIGNED',
      actionType: 'OPEN_TASK',
      payload: { taskId, caseNumber: expect.stringMatching(/^CASE-/) },
    });
  });

  it('ADR-0055: rejects in-place reassign of a live ASSIGNED task and has no unassign route', async () => {
    const { caseId, taskId } = await seedCaseWithTask('AS2');
    const a1 = await createUser({ username: 'fa_as2a', name: 'AGENT A', role: 'FIELD_AGENT' });
    const a2 = await createUser({ username: 'kyc_as2b', name: 'OFFICE B', role: 'KYC_VERIFIER' });

    // Initial assignment of a PENDING task is allowed.
    const assign = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
      .set(SA)
      .send({ assignedTo: a1, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1, version: 1 });
    expect(assign.status).toBe(200);
    expect(assign.body.assignedTo).toBe(a1);

    // ADR-0055: a live ASSIGNED task is never re-pointed in place — 409 TASK_NOT_ASSIGNABLE.
    // The office must Revoke (mandatory reason) then reassign-after-revoke (ADR-0033).
    const reassign = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
      .set(SA)
      .send({ assignedTo: a2, visitType: 'OFFICE', fieldRateType: 'OGL', billCount: 1, version: 2 });
    expect(reassign.status).toBe(409);
    expect(reassign.body.error).toBe('TASK_NOT_ASSIGNABLE');

    // ADR-0055: the unassign route is removed — there is no silent ASSIGNED → PENDING.
    const unassign = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/unassign`)
      .set(SA)
      .send({ version: 2 });
    expect(unassign.status).toBe(404);

    // The task stays ASSIGNED to the original agent (no partial move).
    const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
    expect(detail.body.tasks[0].status).toBe('ASSIGNED');
    expect(detail.body.tasks[0].assignedTo).toBe(a1);
  });

  it('rejects an assignee outside the eligible pool (400 INVALID_ASSIGNEE)', async () => {
    const { caseId, taskId } = await seedCaseWithTask('AS3');
    const backend = await createUser({ username: 'be_as3', name: 'BACKEND', role: 'BACKEND_USER' });
    const res = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
      .set(SA)
      .send({ assignedTo: backend, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1, version: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ASSIGNEE');
  });

  it('cannot assign a terminal task (409 TASK_NOT_ASSIGNABLE)', async () => {
    const { caseId, taskId } = await seedCaseWithTask('AS4');
    const agent = await createUser({ username: 'fa_as4', name: 'FIELD FOUR', role: 'FIELD_AGENT' });

    await db!.pool.query(`UPDATE case_tasks SET status = 'COMPLETED' WHERE id = $1`, [taskId]);
    const res = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
      .set(SA)
      .send({ assignedTo: agent, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1, version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TASK_NOT_ASSIGNABLE');
  });

  it('a backend user finalizes an assigned desk task → COMPLETED with the official result + remark (ADR-0025)', async () => {
    const { caseId, taskId } = await seedCaseWithTask('CP1', { workerRole: 'KYC_VERIFIER', withDoc: true });
    const verifier = await createUser({ username: 'kyc_cp1', name: 'DESK V', role: 'KYC_VERIFIER' });
    const be = await createUser({ username: 'be_cp1', name: 'BACKEND BOB', role: 'BACKEND_USER' });
    // a desk (OFFICE) task assigned to the desk pool user (version 1 → 2)
    expect(
      (
        await request(app)
          .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
          .set(SA)
          .send({ assignedTo: verifier, visitType: 'OFFICE', billCount: 1, version: 1 })
      ).status,
    ).toBe(200);
    // the back-office checker holds the case's client+product portfolio → in scope to finalize.
    // (BACKEND_USER scope is CLIENT EXPAND capped by PRODUCT RESTRICT, so a full portfolio is needed.)
    const { client_id, product_id } = (
      await db!.pool.query<{ client_id: number; product_id: number }>(
        `SELECT client_id, product_id FROM cases WHERE id = $1`,
        [caseId],
      )
    ).rows[0]!;
    await request(app)
      .post(`/api/v2/users/${be}/scope-assignments`)
      .set(SA)
      .send({ dimension: 'CLIENT', entityIds: [client_id] });
    await request(app)
      .post(`/api/v2/users/${be}/scope-assignments`)
      .set(SA)
      .send({ dimension: 'PRODUCT', entityIds: [product_id] });

    const res = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/complete`)
      .set(hdr('BACKEND_USER', be))
      .send({ result: 'POSITIVE', remark: 'Verified against the issuer', version: 2 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.verificationOutcome).toBe('POSITIVE');
    expect(res.body.remark).toBe('VERIFIED AGAINST THE ISSUER'); // ADR-0058 OD-1: remark stored UPPERCASE
    expect(res.body.completedByName).toBe('BACKEND BOB'); // completed_by resolves to the user name
    expect(res.body.completedAt).toBeTruthy();
    expect(res.body.version).toBe(3); // OCC bumped

    const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
    expect(detail.body.tasks[0].verificationOutcome).toBe('POSITIVE');
    expect(detail.body.tasks[0].status).toBe('COMPLETED');
  });

  it('A2026-0623-16: a KYC task cannot be completed with zero documents (required_attachments enforced)', async () => {
    // A KYC_DOCUMENT unit carries required_attachments [{type:DOCUMENT,min:1}]; completing with no
    // document evidence must be rejected. FIELD_VISIT units (required_attachments []) are unaffected.
    const clientId = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'C_KD' })),
    ).id;
    const productId = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/products')
        .set(SA)
        .send(productFactory({ code: 'P_KD' })),
    ).id;
    const kycUnit = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'U_KD', workerRole: 'KYC_VERIFIER' })),
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
        .send({ clientProductId: cpId, verificationUnitId: kycUnit, effectiveFrom: PAST }),
    );
    const caseId = seeded<{ id: string }>(
      await request(app)
        .post('/api/v2/cases')
        .set(SA)
        .send({
          clientId,
          productId,
          backendContactNumber: BC,
          applicants: [{ name: 'KYC DOC' }],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        }),
    ).id;
    const taskId = seeded<{ id: string }[]>(await addTaskFor(caseId, kycUnit))[0]!.id;
    const verifier = await createUser({ username: 'kyc_kd', name: 'DESK KD', role: 'KYC_VERIFIER' });
    expect(
      (
        await request(app)
          .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
          .set(SA)
          .send({ assignedTo: verifier, visitType: 'OFFICE', billCount: 1, version: 1 })
      ).status,
    ).toBe(200);

    // complete with ZERO documents → rejected, task stays ASSIGNED
    const noDocs = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/complete`)
      .set(SA)
      .send({ result: 'POSITIVE', remark: 'no docs attached', version: 2 });
    expect(noDocs.status).toBe(400);
    expect(noDocs.body.error).toBe('DOCUMENTS_REQUIRED');
    expect(
      (await db!.pool.query<{ status: string }>(`SELECT status FROM case_tasks WHERE id = $1`, [taskId]))
        .rows[0]!.status,
    ).toBe('ASSIGNED');

    // attach one office document → completion now succeeds (kind defaults to OFFICE_REF)
    await db!.pool.query(
      `INSERT INTO case_attachments (case_id, task_id, original_name, mime_type, file_size, storage_key, sha256, uploaded_by)
       VALUES ($1, $2, 'pan.pdf', 'application/pdf', 10, 'k/pan.pdf', 'sha', $3)`,
      [caseId, taskId, verifier],
    );
    const ok = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/complete`)
      .set(SA)
      .send({ result: 'POSITIVE', remark: 'document verified', version: 2 });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('COMPLETED');
  });

  it('ADR-0070: the verification unit no longer constrains a task’s visitType (kind binding retired)', async () => {
    const clientId = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'C_VTK' })),
    ).id;
    const productId = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/products')
        .set(SA)
        .send(productFactory({ code: 'P_VTK' })),
    ).id;
    const fieldUnit = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'U_VTKF' })),
    ).id; // FIELD_VISIT (factory default)
    const kycUnit = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'U_VTKK', workerRole: 'KYC_VERIFIER' })),
    ).id;
    const cpId = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/client-products')
        .set(SA)
        .send({ clientId, productId, effectiveFrom: PAST }),
    ).id;
    for (const verificationUnitId of [fieldUnit, kycUnit])
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
          applicants: [{ name: 'VTK APP' }],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        }),
    ).id;
    const applicantId = seeded<{ applicants: { id: string }[] }>(
      await request(app).get(`/api/v2/cases/${caseId}`).set(SA),
    ).applicants[0]!.id;

    // CREATE: a field-classified unit accepts an OFFICE visitType — the retired unit↔visitType binding
    // (A2026-0623-05) would have 400'd this; visitType is now the operator's free choice of which pool works it.
    const offOnFieldUnit = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks`)
      .set(SA)
      .send({ tasks: [{ verificationUnitId: fieldUnit, applicantId, visitType: 'OFFICE' }] });
    expect(offOnFieldUnit.status).toBe(201);

    // ASSIGN: visitType picks the pool, NOT the unit — a field unit's task assigned OFFICE goes to a KYC
    // verifier (the OFFICE pool) and succeeds; previously this was a VISIT_TYPE_UNIT_MISMATCH 400.
    await addTaskFor(caseId, fieldUnit);
    const fieldTask = (
      await db!.pool.query<{ id: string }>(
        `SELECT id FROM case_tasks WHERE case_id = $1 AND verification_unit_id = $2 AND status = 'PENDING'
         ORDER BY id LIMIT 1`,
        [caseId, fieldUnit],
      )
    ).rows[0]!.id;
    const kyc = await createUser({ username: 'kyc_vtk', name: 'DESK VTK', role: 'KYC_VERIFIER' });
    const assigned = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${fieldTask}/assign`)
      .set(SA)
      .send({ assignedTo: kyc, visitType: 'OFFICE', fieldRateType: 'LOCAL', billCount: 1, version: 1 });
    expect(assigned.status).toBe(200);
  });

  it('finalize guards: read-only verifier 403, out-of-scope 404, remark required 400, stale + terminal 409', async () => {
    const { caseId, taskId } = await seedCaseWithTask('CP2', { workerRole: 'KYC_VERIFIER', withDoc: true });
    const desk = await createUser({ username: 'kyc_cp2_desk', name: 'DESK V2', role: 'KYC_VERIFIER' });
    const verifier = await createUser({ username: 'kyc_cp2', name: 'RO V2', role: 'KYC_VERIFIER' });
    const outsider = await createUser({ username: 'be_cp2_out', name: 'BE OUT', role: 'BACKEND_USER' });
    expect(
      (
        await request(app)
          .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
          .set(SA)
          .send({ assignedTo: desk, visitType: 'OFFICE', billCount: 1, version: 1 })
      ).status,
    ).toBe(200);
    const url = `/api/v2/cases/${caseId}/tasks/${taskId}/complete`;
    // the read-only verifier lacks field_review.complete → 403 (cannot record the result)
    expect(
      (
        await request(app)
          .post(url)
          .set(hdr('KYC_VERIFIER', verifier))
          .send({ result: 'POSITIVE', remark: 'x', version: 2 })
      ).status,
    ).toBe(403);
    // a backend user outside the case's scope → 404 (indistinguishable from missing; IDOR-safe)
    expect(
      (
        await request(app)
          .post(url)
          .set(hdr('BACKEND_USER', outsider))
          .send({ result: 'POSITIVE', remark: 'x', version: 2 })
      ).status,
    ).toBe(404);
    // remark is mandatory
    expect(
      (await request(app).post(url).set(SA).send({ result: 'POSITIVE', remark: '', version: 2 })).status,
    ).toBe(400);
    // wrong version → 409 stale
    expect(
      (await request(app).post(url).set(SA).send({ result: 'POSITIVE', remark: 'ok', version: 1 })).status,
    ).toBe(409);
    // finalize, then a second finalize on the now-terminal task → 409 INVALID_TRANSITION
    expect(
      (await request(app).post(url).set(SA).send({ result: 'NEGATIVE', remark: 'done', version: 2 })).status,
    ).toBe(200);
    const again = await request(app)
      .post(url)
      .set(SA)
      .send({ result: 'POSITIVE', remark: 'again', version: 3 });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('INVALID_TRANSITION');
  });

  it('completion stamps the immutable elapsed minutes (assigned→completed) and derives the completed-in TAT band (ADR-0044)', async () => {
    const { caseId, taskId } = await seedCaseWithTask('TATBAND', {
      workerRole: 'KYC_VERIFIER',
      withDoc: true,
    });
    const verifier = await createUser({ username: 'kyc_tatband', name: 'DESK TAT', role: 'KYC_VERIFIER' });
    // assign (version 1 → 2) so the task carries an assigned_at clock start
    expect(
      (
        await request(app)
          .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
          .set(SA)
          .send({ assignedTo: verifier, visitType: 'OFFICE', billCount: 1, version: 1 })
      ).status,
    ).toBe(200);
    // backdate the clock start ~5h so the measured elapsed lands in the 6h band
    await db!.pool.query(`UPDATE case_tasks SET assigned_at = now() - interval '5 hours' WHERE id = $1`, [
      taskId,
    ]);

    const res = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/complete`)
      .set(SA)
      .send({ result: 'POSITIVE', remark: 'done within band', version: 2 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
    // immutable elapsed minutes assigned→completed (~300 = 5h, server clock)
    expect(res.body.completedElapsedMinutes).toBeGreaterThan(290);
    expect(res.body.completedElapsedMinutes).toBeLessThan(320);
    // smallest active band >= ceil(elapsed_minutes / 60) = 5h → 6h band
    expect(res.body.completedTatBand).toBe(6);

    // surfaced on the tasks pipeline read-model too
    const pipe = await request(app).get(`/api/v2/tasks`).set(SA);
    const row = (pipe.body.items as { id: string; completedTatBand: number | null }[]).find(
      (t) => t.id === taskId,
    );
    expect(row?.completedTatBand).toBe(6);
  });

  describe('case finalize + rollup (ADR-0032)', () => {
    // Grant a BACKEND_USER the case's client+product portfolio so it is in case scope.
    async function grantPortfolio(userId: string, caseId: string): Promise<void> {
      const { client_id, product_id } = (
        await db!.pool.query<{ client_id: number; product_id: number }>(
          `SELECT client_id, product_id FROM cases WHERE id = $1`,
          [caseId],
        )
      ).rows[0]!;
      await request(app)
        .post(`/api/v2/users/${userId}/scope-assignments`)
        .set(SA)
        .send({ dimension: 'CLIENT', entityIds: [client_id] });
      await request(app)
        .post(`/api/v2/users/${userId}/scope-assignments`)
        .set(SA)
        .send({ dimension: 'PRODUCT', entityIds: [product_id] });
    }

    // Drive the case's single task ASSIGNED → COMPLETED so the rollup parks the case in
    // AWAITING_COMPLETION. OFFICE pool ⇒ a KYC verifier (office exec) holds the task; SA
    // (field_review.complete via grants_all) records the per-task result — the office exec relays
    // only, it does not complete (ADR-0050). Returns the case's current OCC version (from the API).
    async function driveToAwaitingCompletion(caseId: string, taskId: string, tag: string): Promise<number> {
      const verifier = await createUser({
        username: `kyc_drv_${tag.toLowerCase()}`,
        name: `DESK ${tag}`,
        role: 'KYC_VERIFIER',
      });
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(SA)
        .send({ assignedTo: verifier, visitType: 'OFFICE', billCount: 1, version: 1 });
      await attachDoc(caseId, taskId); // KYC desk task needs document evidence to complete (A2026-0623-16)
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/complete`)
        .set(SA)
        .send({ result: 'POSITIVE', remark: 'desk check', version: 2 });
      const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
      expect(detail.body.status).toBe('AWAITING_COMPLETION'); // rollup: all tasks COMPLETED
      return detail.body.version as number;
    }

    it('rollup parks the case in AWAITING_COMPLETION; a backend user finalizes → COMPLETED with the ONE final verdict (distinct from the per-task result)', async () => {
      const { caseId, taskId } = await seedCaseWithTask('FIN1', {
        workerRole: 'KYC_VERIFIER',
        withDoc: true,
      });
      const be = await createUser({ username: 'be_fin1', name: 'FINAL FRED', role: 'BACKEND_USER' });
      await grantPortfolio(be, caseId);

      // a freshly-seeded case (one task) is IN_PROGRESS, not yet finalizable
      const before = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
      expect(before.body.status).toBe('IN_PROGRESS');
      expect(before.body.verificationOutcome).toBeNull();

      const version = await driveToAwaitingCompletion(caseId, taskId, 'FIN1');

      // the office records the ONE final case verdict (NEGATIVE) — deliberately DIFFERENT from the
      // per-task office result (POSITIVE) to prove they are separate columns (ADR-0032 D3).
      const fin = await request(app)
        .post(`/api/v2/cases/${caseId}/finalize`)
        .set(hdr('BACKEND_USER', be))
        .send({ result: 'NEGATIVE', remark: 'final call from the desk', version });
      expect(fin.status).toBe(200);
      expect(fin.body.status).toBe('COMPLETED');
      expect(fin.body.verificationOutcome).toBe('NEGATIVE'); // the case verdict
      expect(fin.body.resultRemark).toBe('FINAL CALL FROM THE DESK'); // ADR-0058 OD-1 uppercase
      expect(fin.body.completedByName).toBe('FINAL FRED');
      expect(fin.body.completedAt).toBeTruthy();
      expect(fin.body.tasks[0].verificationOutcome).toBe('POSITIVE'); // per-task result preserved
      expect(fin.body.tasks[0].status).toBe('COMPLETED');
    });

    it('finalize guards: not-AWAITING 409, verifier 403, out-of-scope 404, stale 409, blank remark 400, double-finalize 409', async () => {
      const { caseId, taskId } = await seedCaseWithTask('FIN2', {
        workerRole: 'KYC_VERIFIER',
        withDoc: true,
      });
      const verifier = await createUser({ username: 'kyc_fin2', name: 'DESK V', role: 'KYC_VERIFIER' });
      const outsider = await createUser({ username: 'be_fin2_out', name: 'BE OUT', role: 'BACKEND_USER' });
      const url = `/api/v2/cases/${caseId}/finalize`;

      // the case is IN_PROGRESS (its task is not complete) → not finalizable
      const early = await request(app)
        .post(url)
        .set(SA)
        .send({ result: 'POSITIVE', remark: 'ok', version: 1 });
      expect(early.status).toBe(409);
      expect(early.body.error).toBe('INVALID_TRANSITION');

      const version = await driveToAwaitingCompletion(caseId, taskId, 'FIN2');

      // read-only verifier lacks case.finalize → 403 (before any scope/state check)
      expect(
        (
          await request(app)
            .post(url)
            .set(hdr('KYC_VERIFIER', verifier))
            .send({ result: 'POSITIVE', remark: 'ok', version })
        ).status,
      ).toBe(403);
      // a backend user outside the case's scope → 404 (IDOR-safe, indistinguishable from missing)
      expect(
        (
          await request(app)
            .post(url)
            .set(hdr('BACKEND_USER', outsider))
            .send({ result: 'POSITIVE', remark: 'ok', version })
        ).status,
      ).toBe(404);
      // stale version → 409
      expect(
        (
          await request(app)
            .post(url)
            .set(SA)
            .send({ result: 'POSITIVE', remark: 'ok', version: version - 1 })
        ).status,
      ).toBe(409);
      // remark is mandatory (owner 2026-07-01): blank remark → 400, before any state mutation
      expect(
        (await request(app).post(url).set(SA).send({ result: 'POSITIVE', remark: '', version })).status,
      ).toBe(400);
      // happy finalize → 200; a second finalize on the now-COMPLETED case → 409 INVALID_TRANSITION
      expect(
        (await request(app).post(url).set(SA).send({ result: 'POSITIVE', remark: 'final verdict', version }))
          .status,
      ).toBe(200);
      const again = await request(app)
        .post(url)
        .set(SA)
        .send({ result: 'POSITIVE', remark: 'again', version: version + 1 });
      expect(again.status).toBe(409);
      expect(again.body.error).toBe('INVALID_TRANSITION');
    });

    it('a revisit-style new active task re-opens a COMPLETED case → IN_PROGRESS and invalidates the verdict', async () => {
      // built inline (not via seedCaseWithTask) so we keep ctx.enabledUnitId to add a second task.
      // KYC unit so the desk (OFFICE) drive passes the visitType↔kind binding (A2026-0623-05).
      const ctx = await seedCpv('FIN3', { workerRole: 'KYC_VERIFIER' });
      const caseId = seeded<{ id: string }>(
        await request(app)
          .post('/api/v2/cases')
          .set(SA)
          .send({
            clientId: ctx.clientId,
            productId: ctx.productId,
            backendContactNumber: BC,
            applicants: [{ name: 'REVISIT FIN3' }],
            dedupeDecision: 'NO_DUPLICATES_FOUND',
          }),
      ).id;
      const taskId = seeded<{ id: string }[]>(await addTaskFor(caseId, ctx.enabledUnitId))[0]!.id;

      const version = await driveToAwaitingCompletion(caseId, taskId, 'FIN3');
      expect(
        (
          await request(app)
            .post(`/api/v2/cases/${caseId}/finalize`)
            .set(SA)
            .send({ result: 'POSITIVE', remark: 'done', version })
        ).status,
      ).toBe(200);

      // add another task (stands in for a revisit/recheck) → the rollup re-opens the case
      const add = await addTaskFor(caseId, ctx.enabledUnitId);
      expect(add.status).toBe(201);
      const reopened = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
      expect(reopened.body.status).toBe('IN_PROGRESS'); // re-opened
      expect(reopened.body.verificationOutcome).toBeNull(); // verdict invalidated (anti-staleness)
    });

    it('office records the per-task result on a device-COMPLETED task (D3) — status unchanged; non-COMPLETED → 409, verifier 403', async () => {
      const { caseId, taskId } = await seedCaseWithTask('RES', { workerRole: 'KYC_VERIFIER', withDoc: true });
      const be = await createUser({ username: 'be_res', name: 'RES BE', role: 'BACKEND_USER' });
      const verifier = await createUser({ username: 'kyc_res', name: 'RES V', role: 'KYC_VERIFIER' });
      await grantPortfolio(be, caseId);
      // simulate a field-completed task: COMPLETED with NO result (the device records none)
      await db!.pool.query(
        `UPDATE case_tasks SET status = 'COMPLETED', completed_at = now(), version = version + 1 WHERE id = $1`,
        [taskId],
      );
      const url = `/api/v2/cases/${caseId}/tasks/${taskId}/result`;
      const version = (await request(app).get(`/api/v2/cases/${caseId}`).set(SA)).body.tasks[0]
        .version as number;
      // read-only verifier lacks field_review.complete → 403
      expect(
        (
          await request(app)
            .post(url)
            .set(hdr('KYC_VERIFIER', verifier))
            .send({ result: 'POSITIVE', version })
        ).status,
      ).toBe(403);
      // the office records the per-task result; status stays COMPLETED
      const res = await request(app)
        .post(url)
        .set(hdr('BACKEND_USER', be))
        .send({ result: 'REFER', remark: 'docs partial', version });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.verificationOutcome).toBe('REFER');
      expect(res.body.remark).toBe('DOCS PARTIAL'); // ADR-0058 OD-1 uppercase
      expect(res.body.completedByName).toBe('RES BE');
      // a not-yet-COMPLETED task → 409 (use complete, not result)
      const fresh = await seedCaseWithTask('RES2');
      const v2 = (await request(app).get(`/api/v2/cases/${fresh.caseId}`).set(SA)).body.tasks[0]
        .version as number;
      expect(
        (
          await request(app)
            .post(`/api/v2/cases/${fresh.caseId}/tasks/${fresh.taskId}/result`)
            .set(SA)
            .send({ result: 'POSITIVE', version: v2 })
        ).status,
      ).toBe(409);
    });

    it('ADR-0050: a MANAGER can close (complete) a desk task — granted field_review.complete (owner 2026-06-20)', async () => {
      const { caseId, taskId } = await seedCaseWithTask('MGRC', {
        workerRole: 'KYC_VERIFIER',
        withDoc: true,
      });
      const manager = await createUser({ username: 'mgr_mgrc', name: 'MGR C', role: 'MANAGER' });
      // the office exec reports to the manager → the case is in the manager's SUBTREE scope.
      const officeExec = await createUser({
        username: 'kyc_mgrc',
        name: 'OFFICE EXEC',
        role: 'KYC_VERIFIER',
        reportsTo: manager,
      });
      // the desk task is assigned to the office exec (the OFFICE pool); the office exec relays only.
      expect(
        (
          await request(app)
            .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
            .set(SA)
            .send({ assignedTo: officeExec, visitType: 'OFFICE', billCount: 1, version: 1 })
        ).status,
      ).toBe(200);
      // a MANAGER (NOT the assignee) records the result + closes — permission + scope, not ownership.
      const res = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/complete`)
        .set(hdr('MANAGER', manager))
        .send({ result: 'POSITIVE', remark: 'manager closed', version: 2 });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('COMPLETED');
    });
  });

  describe('office task intervention: revisit + reassign-after-revoke (ADR-0033, slice 3)', () => {
    // Drive the case's task ASSIGNED(OFFICE)→COMPLETED, then finalize the case → a settled COMPLETED
    // task on a COMPLETED (finalized) case (the precondition for a revisit).
    async function settle(caseId: string, taskId: string, tag: string): Promise<void> {
      const verifier = await createUser({
        username: `kyc_iv_${tag.toLowerCase()}`,
        name: `DESK ${tag}`,
        role: 'KYC_VERIFIER',
      });
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(SA)
        .send({ assignedTo: verifier, visitType: 'OFFICE', billCount: 1, version: 1 });
      await attachDoc(caseId, taskId); // KYC desk task needs document evidence to complete (A2026-0623-16)
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/complete`)
        .set(SA)
        .send({ result: 'POSITIVE', remark: 'desk', version: 2 });
      const v = (await request(app).get(`/api/v2/cases/${caseId}`).set(SA)).body.version as number;
      const fin = await request(app)
        .post(`/api/v2/cases/${caseId}/finalize`)
        .set(SA)
        .send({ result: 'POSITIVE', remark: 'final', version: v });
      expect(fin.status).toBe(200);
      expect(fin.body.status).toBe('COMPLETED');
    }

    it('REVISIT a COMPLETED task → a NEW billed task (lineage) re-opens the case + invalidates the verdict; parent untouched', async () => {
      const { caseId, taskId } = await seedCaseWithTask('RV1', { workerRole: 'KYC_VERIFIER', withDoc: true });
      // ADR-0085: lineage tasks carry the document fields over from the parent (test seam — the
      // seeding helper predates the fields).
      await db!.pool.query(
        `UPDATE case_tasks SET document_number = 'DOC-RV1', document_details = '{"BANK NAME":"HDFC"}' WHERE id = $1`,
        [taskId],
      );
      await settle(caseId, taskId, 'RV1');

      const res = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/revisit`)
        .set(SA)
        .send({ reason: 'client wants more detail' });
      expect(res.status).toBe(201);
      expect(res.body.taskOrigin).toBe('REVISIT');
      expect(res.body.parentTaskId).toBe(taskId);
      expect(res.body.status).toBe('PENDING'); // born PENDING → office dispatches it next
      expect(res.body.id).not.toBe(taskId);

      const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
      expect(detail.body.status).toBe('IN_PROGRESS'); // re-opened
      expect(detail.body.verificationOutcome).toBeNull(); // verdict invalidated (anti-staleness)
      expect(detail.body.tasks).toHaveLength(2);
      const child = detail.body.tasks.find((t: { id: string }) => t.id === res.body.id);
      const parent = detail.body.tasks.find((t: { id: string }) => t.id === taskId);
      // the new task clones the parent's CPV + applicant; the parent stays COMPLETED (never re-opened
      // in place — mobile landmine #2: a delivered task is never re-activated).
      expect(child.verificationUnitId).toBe(parent.verificationUnitId);
      expect(child.applicantId).toBe(parent.applicantId);
      // ADR-0085: the revisit clone keeps the verification subject (document fields).
      expect(child.documentNumber).toBe('DOC-RV1');
      expect(child.documentDetails).toEqual({ 'BANK NAME': 'HDFC' });
      expect(parent.status).toBe('COMPLETED');
      expect(parent.taskOrigin).toBe('ORIGINAL');
    });

    it('revisit guards: live parent → 409; REVOKED parent → 409 (use reassign); a 2nd open revisit → 409; verifier 403; out-of-scope 404', async () => {
      const { caseId, taskId } = await seedCaseWithTask('RG1'); // task is PENDING (live)
      const url = `/api/v2/cases/${caseId}/tasks/${taskId}/revisit`;

      // a live (PENDING) parent is not revisitable → 409
      expect((await request(app).post(url).set(SA).send({})).body.error).toBe('INVALID_TRANSITION');

      // a REVOKED parent → 409 (reassign-after-revoke handles that path, not revisit)
      await db!.pool.query(`UPDATE case_tasks SET status = 'REVOKED' WHERE id = $1`, [taskId]);
      expect((await request(app).post(url).set(SA).send({})).body.error).toBe('INVALID_TRANSITION');

      // back to COMPLETED → revisit ok; a SECOND open revisit of the same parent → 409
      await db!.pool.query(`UPDATE case_tasks SET status = 'COMPLETED' WHERE id = $1`, [taskId]);
      expect((await request(app).post(url).set(SA).send({})).status).toBe(201);
      const dup = await request(app).post(url).set(SA).send({});
      expect(dup.status).toBe(409);
      expect(dup.body.error).toBe('ACTIVE_REVISIT_EXISTS');

      // read-only verifier lacks task.rework → 403; a fresh manager is out of the case scope → 404
      const verifier = await createUser({ username: 'kyc_rg1', name: 'V', role: 'KYC_VERIFIER' });
      expect((await request(app).post(url).set(hdr('KYC_VERIFIER', verifier)).send({})).status).toBe(403);
      const outsider = await createUser({ username: 'mgr_rg1_out', name: 'MGR OUT', role: 'MANAGER' });
      expect((await request(app).post(url).set(hdr('MANAGER', outsider)).send({})).status).toBe(404);
    });

    it('REASSIGN-AFTER-REVOKE → a replacement task (new ASSIGNED row, lineage, parent origin) for a REVOKED task; original stays REVOKED', async () => {
      const { caseId, taskId } = await seedCaseWithTask('RA1');
      const v1 = await createUser({ username: 'kyc_ra1a', name: 'DESK A', role: 'KYC_VERIFIER' });
      const v2 = await createUser({ username: 'kyc_ra1b', name: 'DESK B', role: 'KYC_VERIFIER' });
      // assign then simulate a field revoke (device path) → REVOKED
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(SA)
        .send({ assignedTo: v1, visitType: 'OFFICE', billCount: 1, version: 1 });
      await db!.pool.query(
        `UPDATE case_tasks SET status = 'REVOKED', remark = 'field revoked' WHERE id = $1`,
        [taskId],
      );

      const res = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/reassign`)
        .set(SA)
        .send({ assignedTo: v2, visitType: 'OFFICE', billCount: 1, reason: 'redispatch' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ASSIGNED');
      expect(res.body.assignedTo).toBe(v2);
      expect(res.body.parentTaskId).toBe(taskId);
      expect(res.body.taskOrigin).toBe('ORIGINAL'); // keeps the parent's origin (no extra bill)
      expect(res.body.id).not.toBe(taskId);

      const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
      expect(detail.body.status).toBe('IN_PROGRESS'); // the new ASSIGNED task re-opens the case
      const original = detail.body.tasks.find((t: { id: string }) => t.id === taskId);
      expect(original.status).toBe('REVOKED'); // the revoked row is never re-activated
    });

    it('reassign guards: non-REVOKED parent → 409; ineligible assignee → 400; verifier 403; out-of-scope 404', async () => {
      const { caseId, taskId } = await seedCaseWithTask('RA2');
      const url = `/api/v2/cases/${caseId}/tasks/${taskId}/reassign`;
      const desk = await createUser({ username: 'kyc_ra2', name: 'DESK', role: 'KYC_VERIFIER' });
      const body = { assignedTo: desk, visitType: 'OFFICE', billCount: 1 };

      // the task is PENDING (not REVOKED) → 409
      expect((await request(app).post(url).set(SA).send(body)).body.error).toBe('INVALID_TRANSITION');

      await db!.pool.query(`UPDATE case_tasks SET status = 'REVOKED' WHERE id = $1`, [taskId]);

      // a BACKEND_USER is not in the OFFICE pool (ADR-0050: desk pool = KYC_VERIFIER) → 400 INVALID_ASSIGNEE
      const notDesk = await createUser({ username: 'be_ra2', name: 'BE', role: 'BACKEND_USER' });
      const bad = await request(app)
        .post(url)
        .set(SA)
        .send({ assignedTo: notDesk, visitType: 'OFFICE', billCount: 1 });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe('INVALID_ASSIGNEE');

      // read-only verifier lacks task.rework → 403; a fresh manager out of scope → 404
      const verifier = await createUser({ username: 'kyc_ra2v', name: 'V', role: 'KYC_VERIFIER' });
      expect((await request(app).post(url).set(hdr('KYC_VERIFIER', verifier)).send(body)).status).toBe(403);
      const outsider = await createUser({ username: 'mgr_ra2_out', name: 'MGR OUT', role: 'MANAGER' });
      expect((await request(app).post(url).set(hdr('MANAGER', outsider)).send(body)).status).toBe(404);
    });

    it('verdict history (ADR-0033): every finalize recorded who/when/what, newest first (before/after a revisit); out-of-scope → 404', async () => {
      const { caseId, taskId } = await seedCaseWithTask('VH1', { workerRole: 'KYC_VERIFIER', withDoc: true });
      await settle(caseId, taskId, 'VH1'); // finalize #1 → POSITIVE

      // revisit re-opens the case; drive the new child to COMPLETED, then re-finalize with a NEW verdict
      const child = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/revisit`)
        .set(SA)
        .send({});
      const childId = child.body.id as string;
      const verifier = await createUser({ username: 'kyc_vh1b', name: 'DESK VH1B', role: 'KYC_VERIFIER' });
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${childId}/assign`)
        .set(SA)
        .send({ assignedTo: verifier, visitType: 'OFFICE', billCount: 1, version: 1 });
      await attachDoc(caseId, childId); // KYC revisit child needs document evidence to complete (A2026-0623-16)
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${childId}/complete`)
        .set(SA)
        .send({ result: 'POSITIVE', remark: 'redone', version: 2 });
      // finalize #2 by a REAL backend user (granted the case portfolio) so the actor name resolves.
      const be = await createUser({ username: 'be_vh1', name: 'FINAL VH1', role: 'BACKEND_USER' });
      const { client_id, product_id } = (
        await db!.pool.query<{ client_id: number; product_id: number }>(
          `SELECT client_id, product_id FROM cases WHERE id = $1`,
          [caseId],
        )
      ).rows[0]!;
      await request(app)
        .post(`/api/v2/users/${be}/scope-assignments`)
        .set(SA)
        .send({ dimension: 'CLIENT', entityIds: [client_id] });
      await request(app)
        .post(`/api/v2/users/${be}/scope-assignments`)
        .set(SA)
        .send({ dimension: 'PRODUCT', entityIds: [product_id] });
      const v = (await request(app).get(`/api/v2/cases/${caseId}`).set(SA)).body.version as number;
      await request(app)
        .post(`/api/v2/cases/${caseId}/finalize`)
        .set(hdr('BACKEND_USER', be))
        .send({ result: 'NEGATIVE', remark: 'changed after revisit', version: v });

      const hist = await request(app).get(`/api/v2/cases/${caseId}/verdict-history`).set(SA);
      expect(hist.status).toBe(200);
      expect(hist.body).toHaveLength(2);
      expect(hist.body[0].result).toBe('NEGATIVE'); // newest first
      expect(hist.body[0].remark).toBe('CHANGED AFTER REVISIT'); // ADR-0058 OD-1 uppercase
      expect(hist.body[0].actorName).toBe('FINAL VH1'); // the office user who finalized resolves
      expect(hist.body[0].at).toBeTruthy();
      expect(hist.body[1].result).toBe('POSITIVE'); // the original verdict, preserved in history

      // out-of-scope backend user → 404 (IDOR-safe)
      const outsider = await createUser({ username: 'be_vh1_out', name: 'BE OUT', role: 'BACKEND_USER' });
      expect(
        (await request(app).get(`/api/v2/cases/${caseId}/verdict-history`).set(hdr('BACKEND_USER', outsider)))
          .status,
      ).toBe(404);
    });

    it('two CONCURRENT revisits of one COMPLETED parent → exactly one 201, one 409 (active-revisit unique backstop, no double-bill)', async () => {
      const { caseId, taskId } = await seedCaseWithTask('VHR', { workerRole: 'KYC_VERIFIER', withDoc: true });
      await settle(caseId, taskId, 'VHR');
      const url = `/api/v2/cases/${caseId}/tasks/${taskId}/revisit`;
      // fired together: both may pass the service pre-check (read 0). Exactly one INSERT commits; the
      // loser hits a 23505 — either the active-revisit partial-unique index OR the task_number UNIQUE
      // (both children share the same computed seq) — both surface 409 and BOTH prevent the double
      // billable child. The invariant that matters: exactly one revisit child, never two.
      const [a, b] = await Promise.all([
        request(app).post(url).set(SA).send({}),
        request(app).post(url).set(SA).send({}),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const failed = a.status === 409 ? a : b;
      expect(['ACTIVE_REVISIT_EXISTS', 'TASK_NUMBER_CONFLICT']).toContain(failed.body.error);
      const tasks = (await request(app).get(`/api/v2/cases/${caseId}`).set(SA)).body.tasks as {
        taskOrigin: string;
      }[];
      expect(tasks.filter((t) => t.taskOrigin === 'REVISIT')).toHaveLength(1); // never double-billed
    });

    it('backend revoke (ADR-0033, v1 parity): a LIVE task → REVOKED + reason; COMPLETED → 409; reason 400; verifier 403; out-of-scope 404; idempotent', async () => {
      const { caseId, taskId } = await seedCaseWithTask('BRV');
      const agent = await createUser({ username: 'fa_brv', name: 'FA', role: 'FIELD_AGENT' });
      // make the task LIVE (ASSIGNED) directly — this test exercises revoke, not assignment eligibility
      await db!.pool.query(
        `UPDATE case_tasks SET status = 'ASSIGNED', assigned_to = $1::uuid, version = version + 1 WHERE id = $2`,
        [agent, taskId],
      );
      const url = `/api/v2/cases/${caseId}/tasks/${taskId}/revoke`;

      expect((await request(app).post(url).set(SA).send({})).status).toBe(400); // reason required
      const verifier = await createUser({ username: 'kyc_brv', name: 'V', role: 'KYC_VERIFIER' });
      expect(
        (await request(app).post(url).set(hdr('KYC_VERIFIER', verifier)).send({ reason: 'x' })).status,
      ).toBe(403); // read-only verifier lacks task.revoke
      const outsider = await createUser({ username: 'mgr_brv_out', name: 'MGR OUT', role: 'MANAGER' });
      expect((await request(app).post(url).set(hdr('MANAGER', outsider)).send({ reason: 'x' })).status).toBe(
        404,
      ); // MANAGER holds task.revoke but is out of the case's scope → 404 (IDOR-safe)

      const ok = await request(app).post(url).set(SA).send({ reason: 'gate closed' });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('REVOKED');
      expect(ok.body.remark).toBe('GATE CLOSED'); // ADR-0058 OD-1 uppercase (revoke reason → remark)
      // idempotent re-revoke → 200 (already REVOKED)
      expect((await request(app).post(url).set(SA).send({ reason: 'again' })).status).toBe(200);

      // a COMPLETED task CANNOT be revoked (it is reworked via revisit) → 409
      const done = await seedCaseWithTask('BRV2', { workerRole: 'KYC_VERIFIER', withDoc: true });
      await settle(done.caseId, done.taskId, 'BRV2');
      const blocked = await request(app)
        .post(`/api/v2/cases/${done.caseId}/tasks/${done.taskId}/revoke`)
        .set(SA)
        .send({ reason: 'too late' });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toBe('INVALID_TRANSITION');
    });

    it('ADR-0027: office revoke notifies the (old) field assignee (TASK_REVOKED, device wipes the task)', async () => {
      const { caseId, taskId } = await seedCaseWithTask('RVN');
      const agent = await createUser({ username: 'fa_rvn', name: 'FA RVN', role: 'FIELD_AGENT' });
      await db!.pool.query(
        `UPDATE case_tasks SET status = 'ASSIGNED', assigned_to = $1::uuid, version = version + 1 WHERE id = $2`,
        [agent, taskId],
      );
      const ok = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/revoke`)
        .set(SA)
        .send({ reason: 'reassigning' });
      expect(ok.status).toBe(200);
      const feed = await request(app)
        .get('/api/v2/notifications')
        .set({ 'x-test-auth': `FIELD_AGENT:${agent}` });
      expect(feed.status).toBe(200);
      expect(feed.body.items[0]).toMatchObject({
        type: 'TASK_REVOKED',
        actionType: 'OPEN_TASK',
        payload: { taskId, caseNumber: expect.stringMatching(/^CASE-/) },
      });
    });
  });

  describe('reference attachments (B2)', () => {
    beforeAll(() => setStorage(fakeStorage));
    afterAll(() => setStorage(null));

    const upload = (
      caseId: string,
      bytes: Buffer,
      name: string,
      taskId?: string,
      auth: Record<string, string> = SA,
    ) =>
      request(app)
        .post(`/api/v2/cases/${caseId}/attachments${taskId ? `?taskId=${taskId}` : ''}`)
        .set(auth)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', encodeURIComponent(name))
        .send(bytes);

    it('uploads case- and task-level docs, lists them, signs a URL, and soft-deletes', async () => {
      const { caseId, taskId } = await seedCaseWithTask('AT1');
      const a1 = await upload(caseId, PDF_BYTES, 'reference.pdf');
      expect(a1.status).toBe(201);
      expect(a1.body.taskId).toBeNull(); // case-level
      expect(a1.body.originalName).toBe('reference.pdf');
      expect(a1.body.mimeType).toBe('application/pdf'); // sniffed, not the declared content-type
      const a2 = await upload(caseId, PNG_BYTES, 'kyc-doc.png', taskId);
      expect(a2.status).toBe(201);
      expect(a2.body.taskId).toBe(taskId); // task-level

      const list = await request(app).get(`/api/v2/cases/${caseId}/attachments`).set(SA);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(2);

      const url = await request(app).get(`/api/v2/cases/${caseId}/attachments/${a1.body.id}/url`).set(SA);
      expect(url.status).toBe(200);
      expect(url.body.url).toContain('https://signed.example/attachments/');

      const del = await request(app).delete(`/api/v2/cases/${caseId}/attachments/${a1.body.id}`).set(SA);
      expect(del.status).toBe(200);
      const after = await request(app).get(`/api/v2/cases/${caseId}/attachments`).set(SA);
      expect(after.body).toHaveLength(1); // soft-deleted one gone
    });

    it('rejects an unsupported file type by magic bytes, not the declared name → 400', async () => {
      const { caseId } = await seedCaseWithTask('AT2');
      const bad = await upload(caseId, Buffer.from('GIF89a definitely not a pdf'), 'evil.pdf');
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('ADR-0085: the KYC verifier has NO case-page attachment access (case.view removed); the office does', async () => {
      const { caseId, taskId } = await seedCaseWithTask('AT3', { workerRole: 'KYC_VERIFIER' });
      const verifier = await createUser({ username: 'kyc_at3', name: 'DESK A', role: 'KYC_VERIFIER' });
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(SA)
        .send({ assignedTo: verifier, visitType: 'OFFICE', billCount: 1, version: 1 });
      const att = await upload(caseId, PDF_BYTES, 'kyc.pdf', taskId);
      expect(att.status).toBe(201);

      // ADR-0085 (mig 0111): the verifier no longer holds case.view → the CASE attachment endpoints
      // 403 at the authorize gate. His OWN-task attachment access moved to /api/v2/kyc-tasks/:id/
      // attachments (covered by kycTasks.api.test.ts). No case.create either → upload also 403.
      const V = hdr('KYC_VERIFIER', verifier);
      expect((await request(app).get(`/api/v2/cases/${caseId}/attachments`).set(V)).status).toBe(403);
      expect(
        (await request(app).get(`/api/v2/cases/${caseId}/attachments/${att.body.id}/url`).set(V)).status,
      ).toBe(403);
      expect((await upload(caseId, PDF_BYTES, 'x.pdf', taskId, V)).status).toBe(403);

      // the office (SA, case.view) still reads the task's reference document
      const saList = await request(app).get(`/api/v2/cases/${caseId}/attachments`).set(SA);
      expect(saList.status).toBe(200);
      expect(saList.body).toHaveLength(1);
    });

    it('IDOR (A2026-0623-06): an out-of-scope actor cannot sign a URL for, or delete, a case-level attachment', async () => {
      // A case-level (task_id NULL) doc — e.g. a KYC PAN/Aadhaar — was the gap: attachmentForAccess's
      // task-leg is satisfied by `task_id IS NULL` alone, so /url + DELETE skipped the case-scope guard.
      const { caseId } = await seedCaseWithTask('AT4');
      const a1 = await upload(caseId, PDF_BYTES, 'pan-card.pdf');
      expect(a1.status).toBe(201);
      expect(a1.body.taskId).toBeNull(); // case-level

      // read IDOR: a case.view holder on NO case must not sign a URL to the pii_sensitive doc. Uses a
      // FIELD_AGENT (still holds case.view; SELF-scoped) — the KYC verifier now has NO case.view at
      // all (ADR-0085, mig 0111), so it can't exercise the scope guard here (it 403s at the gate).
      const reader = await createUser({ username: 'fa_at4_out', name: 'OUT R', role: 'FIELD_AGENT' });
      expect(
        (
          await request(app)
            .get(`/api/v2/cases/${caseId}/attachments/${a1.body.id}/url`)
            .set(hdr('FIELD_AGENT', reader))
        ).status,
      ).toBe(404);

      // delete IDOR: a manager not on the case (has case.create, but out of scope) must not delete it
      const deleter = await createUser({ username: 'mgr_at4_out', name: 'OUT D', role: 'MANAGER' });
      expect(
        (
          await request(app)
            .delete(`/api/v2/cases/${caseId}/attachments/${a1.body.id}`)
            .set(hdr('MANAGER', deleter))
        ).status,
      ).toBe(404);

      // the doc survived the blocked delete + an in-scope admin can still sign it
      expect(
        (await request(app).get(`/api/v2/cases/${caseId}/attachments/${a1.body.id}/url`).set(SA)).status,
      ).toBe(200);
    });
  });

  it('assignable-users is hierarchy-scoped: SA=all, MANAGER=subtree, TEAM_LEADER=direct reports', async () => {
    const { caseId } = await seedCaseWithTask('AS5');
    const mgr = await createUser({ username: 'mgr_as5', name: 'MANAGER M', role: 'MANAGER' });
    const tl = await createUser({
      username: 'tl_as5',
      name: 'LEADER L',
      role: 'TEAM_LEADER',
      reportsTo: mgr,
    });
    const faUnderTl = await createUser({
      username: 'fa_under_tl',
      name: 'UNDER TL',
      role: 'FIELD_AGENT',
      reportsTo: tl,
    });
    const faOutside = await createUser({ username: 'fa_outside', name: 'OUTSIDE', role: 'FIELD_AGENT' });

    const asSa = await request(app).get(`/api/v2/cases/${caseId}/assignable-users`).set(SA);
    expect(asSa.status).toBe(200);
    const saIds = asSa.body.map((u: { id: string }) => u.id);
    expect(saIds).toContain(faUnderTl);
    expect(saIds).toContain(faOutside);

    const asMgr = await request(app)
      .get(`/api/v2/cases/${caseId}/assignable-users`)
      .set(authHeaderForRole('MANAGER', mgr));
    const mgrIds = asMgr.body.map((u: { id: string }) => u.id);
    expect(mgrIds).toContain(faUnderTl); // mgr → tl → fa (recursive subtree)
    expect(mgrIds).not.toContain(faOutside);

    const asTl = await request(app)
      .get(`/api/v2/cases/${caseId}/assignable-users`)
      .set(authHeaderForRole('TEAM_LEADER', tl));
    const tlIds = asTl.body.map((u: { id: string }) => u.id);
    expect(tlIds).toEqual([faUnderTl]); // direct reports only
  });

  it('a future-dated CPV unit enablement is excluded from available-units (ADR-0017)', async () => {
    const ctx = await seedCpv('EF');
    const cpId = (await request(app).get(`/api/v2/client-products?clientId=${ctx.clientId}`).set(SA)).body
      .items[0].id as number;
    const futureUnitId = (
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'U_EF_FUT' }))
    ).body.id as number;
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    await request(app)
      .post('/api/v2/cpv-units')
      .set(SA)
      .send({ clientProductId: cpId, verificationUnitId: futureUnitId, effectiveFrom: future });

    const avail = await request(app)
      .get(`/api/v2/cases/available-units?clientId=${ctx.clientId}&productId=${ctx.productId}`)
      .set(SA);
    const ids = avail.body.map((u: { verificationUnitId: number }) => u.verificationUnitId);
    expect(ids).toContain(ctx.enabledUnitId);
    expect(ids).not.toContain(futureUnitId);
  });

  it('a future-dated (scheduled) executive is excluded from assignable-users (ADR-0017)', async () => {
    const { caseId } = await seedCaseWithTask('AS7');
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const usable = await createUser({ username: 'fa_usable', name: 'USABLE FA', role: 'FIELD_AGENT' });
    const scheduled = await createUser({
      username: 'fa_sched',
      name: 'SCHED FA',
      role: 'FIELD_AGENT',
      effectiveFrom: future,
    });
    const res = await request(app).get(`/api/v2/cases/${caseId}/assignable-users`).set(SA);
    expect(res.status).toBe(200);
    const ids = res.body.map((u: { id: string }) => u.id);
    expect(ids).toContain(usable);
    expect(ids).not.toContain(scheduled);
  });

  it('FIELD_AGENT lacks case.assign (403 on assign + assignable-users); unauth 401', async () => {
    const { caseId, taskId } = await seedCaseWithTask('AS6');
    const agent = await createUser({ username: 'fa_as6', name: 'FIELD SIX', role: 'FIELD_AGENT' });
    expect((await request(app).get(`/api/v2/cases/${caseId}/assignable-users`).set(FA)).status).toBe(403);
    const assign = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
      .set(FA)
      .send({ assignedTo: agent, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1, version: 1 });
    expect(assign.status).toBe(403);
    expect((await request(app).get(`/api/v2/cases/${caseId}/assignable-users`)).status).toBe(401);
  });

  // ── Assignment hardening (Pipeline slice 2): OCC + history + per-task eligibility ──
  describe('assignment OCC + history + eligibility', () => {
    const hdr2 = (role: string, id: string): Record<string, string> => ({
      'x-test-auth': `${role}:${id}`,
    });

    it('assign without version → 400 VERSION_REQUIRED; stale version → 409 STALE_UPDATE + current', async () => {
      const { caseId, taskId } = await seedCaseWithTask('OCC1');
      const agent = await createUser({ username: 'fa_occ1', name: 'OCC FA', role: 'FIELD_AGENT' });
      const body = { assignedTo: agent, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1 };

      const noVersion = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(SA)
        .send(body);
      expect(noVersion.status).toBe(400);
      expect(noVersion.body.error).toBe('VERSION_REQUIRED');

      // ADR-0055: a live ASSIGNED task can no longer be re-assigned, so OCC staleness is exercised on the
      // still-PENDING task — a wrong version (the row is at version 1) misses the OCC guard, returns fresh.
      const stale = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(SA)
        .send({ ...body, version: 99 });
      expect(stale.status).toBe(409);
      expect(stale.body.error).toBe('STALE_UPDATE');
      expect(stale.body.current.version).toBe(1);

      // the correct version assigns the PENDING task
      expect(
        (
          await request(app)
            .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
            .set(SA)
            .send({ ...body, version: 1 })
        ).status,
      ).toBe(200);
    });

    it('writes the append-only ASSIGNED history event (immutable)', async () => {
      const { caseId, taskId } = await seedCaseWithTask('HIST');
      const a1 = await createUser({ username: 'fa_h1', name: 'HIST A', role: 'FIELD_AGENT' });
      const post = (path: string, body: object) =>
        request(app).post(`/api/v2/cases/${caseId}/tasks/${taskId}/${path}`).set(SA).send(body);
      const attrs = { visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1 };
      // ADR-0055: assign records ASSIGNED. The in-place REASSIGNED and UNASSIGNED history events are gone
      // with the removed in-place reassign / unassign — an agent change now goes Revoke → reassign-after-
      // revoke (covered by the reassign-after-revoke + sync purge tests).
      expect((await post('assign', { ...attrs, assignedTo: a1, version: 1 })).status).toBe(200);

      const { rows } = await db!.pool.query<{
        action: string;
        assigned_to: string | null;
        previous_assigned_to: string | null;
      }>(
        `SELECT action, assigned_to, previous_assigned_to
         FROM task_assignment_history WHERE task_id = $1 ORDER BY id`,
        [taskId],
      );
      expect(rows.map((r) => r.action)).toEqual(['ASSIGNED']);
      expect(rows[0]).toMatchObject({ assigned_to: a1, previous_assigned_to: null });
      // append-only: the immutability trigger blocks UPDATE/DELETE
      await expect(
        db!.pool.query(`DELETE FROM task_assignment_history WHERE task_id = $1`, [taskId]),
      ).rejects.toThrow(/append-only/);
    });

    it('visit-type pool boundary (ADR-0024): a KYC_VERIFIER is not in the FIELD pool (400 INVALID_ASSIGNEE)', async () => {
      const { caseId, taskId } = await seedCaseWithTask('WR');
      const kyc = await createUser({ username: 'kyc_wr', name: 'KYC WR', role: 'KYC_VERIFIER' });
      // The operator picks FIELD → pool is FIELD_AGENT only; a KYC verifier is rejected. (Under OFFICE
      // the same user WOULD be eligible — the pool follows the visit type, not the unit's worker_role.)
      const res = await request(app).post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`).set(SA).send({
        assignedTo: kyc,
        visitType: 'FIELD',
        fieldRateType: 'LOCAL',
        billCount: 1,
        version: 1,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_ASSIGNEE');
    });

    it('territory eligibility on a LOCATED task (ADR-0024): FA outside the pincode rejected; inside, assigned', async () => {
      const ctx = await seedCpv('TE');
      const pin = (
        await db!.pool.query<{ id: number }>(
          `INSERT INTO locations (pincode, area, city, state, country)
           VALUES ('560003', 'Malleswaram', 'Bengaluru', 'Karnataka', 'India') RETURNING id`,
        )
      ).rows[0]!.id;
      const caseId = seeded<{ id: string }>(
        await request(app)
          .post('/api/v2/cases')
          .set(SA)
          .send({
            clientId: ctx.clientId,
            productId: ctx.productId,
            backendContactNumber: BC,
            applicants: [{ name: 'TE APP' }],
            dedupeDecision: 'NO_DUPLICATES_FOUND',
            pincodeId: pin,
          }),
      ).id;
      // ADR-0024: territory is matched against the TASK's own location, so the task carries it.
      const applicantId = (await request(app).get(`/api/v2/cases/${caseId}`).set(SA)).body.applicants[0]
        .id as string;
      const tasks = seeded<{ id: string }[]>(
        await request(app)
          .post(`/api/v2/cases/${caseId}/tasks`)
          .set(SA)
          .send({
            tasks: [
              {
                verificationUnitId: ctx.enabledUnitId,
                applicantId,
                address: ADDR,
                pincodeId: pin,
                areaId: pin,
              },
            ],
          }),
      );
      const taskId = tasks[0]!.id;
      const fa = await createUser({ username: 'fa_te', name: 'TE FA', role: 'FIELD_AGENT' });
      const body = { assignedTo: fa, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1, version: 1 };

      // The task is located → the FIELD agent must COVER that pincode/area; with zero assignments
      // they are excluded (fail-closed).
      const out = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(SA)
        .send(body);
      expect(out.status).toBe(400);
      expect(out.body.error).toBe('INVALID_ASSIGNEE');

      seeded(
        await request(app)
          .post(`/api/v2/users/${fa}/scope-assignments`)
          .set(SA)
          .send({ dimension: 'PINCODE', entityIds: [pin] }),
      );
      const ok = await request(app).post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`).set(SA).send(body);
      expect(ok.status).toBe(200);

      // ?taskId narrows assignable-users the same way: only the covering agent appears
      const pool = await request(app)
        .get(`/api/v2/cases/${caseId}/assignable-users?taskId=${taskId}`)
        .set(SA);
      const poolIds = pool.body.map((u: { id: string }) => u.id);
      expect(poolIds).toContain(fa);
    });

    it('assignment writes are scope-guarded: an out-of-scope TEAM_LEADER gets 404 (IDOR-safe)', async () => {
      const { caseId, taskId } = await seedCaseWithTask('SG');
      const tl = await createUser({ username: 'tl_sg', name: 'SG TL', role: 'TEAM_LEADER' });
      const fa = await createUser({ username: 'fa_sg', name: 'SG FA', role: 'FIELD_AGENT', reportsTo: tl });
      // the case (created by SA, task unassigned) is OUTSIDE the TL's scope → write = 404
      const res = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(hdr2('TEAM_LEADER', tl))
        .send({ assignedTo: fa, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1, version: 1 });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('TASK_NOT_FOUND');
    });
  });

  // ── ADR-0024: Field/Office assignment pool + assign-at-create + rate type ──
  describe('visit-type pool + rate type (ADR-0024)', () => {
    const ids = (rows: Array<{ id: string }>): string[] => rows.map((u) => u.id);
    async function locatedCase(tag: string): Promise<{
      ctx: Ctx;
      loc: number;
      caseId: string;
      applicantId: string;
    }> {
      const ctx = await seedCpv(tag);
      const loc = (
        await db!.pool.query<{ id: number }>(
          `INSERT INTO locations (pincode, area, city, state, country)
           VALUES ('641001', 'RS Puram ${tag}', 'Coimbatore', 'Tamil Nadu', 'India') RETURNING id`,
        )
      ).rows[0]!.id;
      const caseId = seeded<{ id: string }>(
        await request(app)
          .post('/api/v2/cases')
          .set(SA)
          .send({
            clientId: ctx.clientId,
            productId: ctx.productId,
            backendContactNumber: BC,
            applicants: [{ name: `${tag} APP` }],
            dedupeDecision: 'NO_DUPLICATES_FOUND',
            pincodeId: loc,
          }),
      ).id;
      const applicantId = (await request(app).get(`/api/v2/cases/${caseId}`).set(SA)).body.applicants[0]
        .id as string;
      return { ctx, loc, caseId, applicantId };
    }

    it('eligible-assignees: FIELD needs the territory; OFFICE returns the desk pool', async () => {
      const { ctx, loc, caseId } = await locatedCase('PEF');
      const fa = await createUser({ username: 'fa_pef', name: 'PEF FA', role: 'FIELD_AGENT' });
      const desk = await createUser({ username: 'kyc_pef', name: 'PEF DESK', role: 'KYC_VERIFIER' });
      const fieldUrl = `/api/v2/cases/${caseId}/eligible-assignees?visitType=FIELD&areaId=${loc}&pincodeId=${loc}`;

      // FIELD: the agent does not yet cover the location → excluded (fail-closed).
      expect(ids((await request(app).get(fieldUrl).set(SA)).body)).not.toContain(fa);
      seeded(
        await request(app)
          .post(`/api/v2/users/${fa}/scope-assignments`)
          .set(SA)
          .send({ dimension: 'AREA', entityIds: [loc] }),
      );
      const field = await request(app).get(fieldUrl).set(SA);
      expect(field.status).toBe(200);
      expect(ids(field.body)).toContain(fa);
      expect(ids(field.body)).not.toContain(desk); // wrong pool for FIELD

      // OFFICE: the desk pool granted this unit (ADR-0073), no territory needed; field agents excluded.
      const office = await request(app)
        .get(
          `/api/v2/cases/${caseId}/eligible-assignees?visitType=OFFICE&verificationUnitId=${ctx.enabledUnitId}`,
        )
        .set(SA);
      expect(office.status).toBe(200);
      expect(ids(office.body)).toContain(desk);
      expect(ids(office.body)).not.toContain(fa);
    });

    it('eligible-assignees (ADR-0078): a SELF-hierarchy case.assign holder sees territory-covering agents outside their org tree', async () => {
      const { loc, caseId } = await locatedCase('OOH');
      const fa = await createUser({ username: 'fa_ooh', name: 'OOH FA', role: 'FIELD_AGENT' });
      // the agent covers the territory but reports to no one (not in any backend operator's subtree)
      seeded(
        await request(app)
          .post(`/api/v2/users/${fa}/scope-assignments`)
          .set(SA)
          .send({ dimension: 'AREA', entityIds: [loc] }),
      );
      // A SELF-hierarchy operator who nonetheless holds case.assign — the prod scenario where a backend
      // role was granted assignment. Pre-ADR-0078 the org-hierarchy cap collapsed the pool to the operator
      // alone (empty for field work); now the territory IS the access control, so the agent appears.
      await db!.pool.query(
        `INSERT INTO roles (code, name, hierarchy_mode) VALUES ('BE_ASSIGNER', 'Backend Assigner', 'SELF')
         ON CONFLICT (code) DO NOTHING`,
      );
      await db!.pool.query(
        `INSERT INTO role_permissions (role_code, permission_code) VALUES
           ('BE_ASSIGNER', 'case.assign'), ('BE_ASSIGNER', 'case.view')
         ON CONFLICT (role_code, permission_code) DO NOTHING`,
      );
      invalidateRoleCache();
      const url = `/api/v2/cases/${caseId}/eligible-assignees?visitType=FIELD&areaId=${loc}&pincodeId=${loc}`;
      const res = await request(app)
        .get(url)
        .set({ 'x-test-auth': 'BE_ASSIGNER:22222222-2222-2222-2222-222222222222' });
      expect(res.status).toBe(200);
      expect(ids(res.body)).toContain(fa);
    });

    it('assign-at-create: eligible assignee → ASSIGNED + history; ineligible → 400', async () => {
      const { ctx, loc, caseId, applicantId } = await locatedCase('AAC');
      const fa = await createUser({ username: 'fa_aac', name: 'AAC FA', role: 'FIELD_AGENT' });
      const spec = {
        verificationUnitId: ctx.enabledUnitId,
        applicantId,
        address: ADDR,
        visitType: 'FIELD',
        fieldRateType: 'LOCAL', // ADR-0050: FIELD assignment requires a field-rate-type
        pincodeId: loc,
        areaId: loc,
        assigneeId: fa,
      };

      // No territory yet → the chosen assignee is ineligible → the whole add is rejected.
      const bad = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks`)
        .set(SA)
        .send({ tasks: [spec] });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe('INVALID_ASSIGNEE');

      seeded(
        await request(app)
          .post(`/api/v2/users/${fa}/scope-assignments`)
          .set(SA)
          .send({ dimension: 'AREA', entityIds: [loc] }),
      );
      const ok = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks`)
        .set(SA)
        .send({ tasks: [spec] });
      expect(ok.status).toBe(201);
      const mine = (
        ok.body as Array<{ id: string; assignedTo: string; status: string; visitType: string }>
      ).find((t) => t.assignedTo === fa);
      expect(mine?.status).toBe('ASSIGNED');
      expect(mine?.visitType).toBe('FIELD');
      const hist = await db!.pool.query<{ action: string; assigned_to: string }>(
        `SELECT action, assigned_to FROM task_assignment_history WHERE task_id = $1`,
        [mine!.id],
      );
      expect(hist.rows).toEqual([{ action: 'ASSIGNED', assigned_to: fa }]);

      // ADR-0027 (CASE-000018 regression): assign-at-create must notify the assignee too — previously
      // only the later assignTask path fired CASE_ASSIGNED, so a field agent assigned on the New Case
      // page got no notification/push and the device never auto-pulled the task.
      const feed = await request(app)
        .get('/api/v2/notifications')
        .set({ 'x-test-auth': `FIELD_AGENT:${fa}` });
      expect(feed.status).toBe(200);
      expect(feed.body.items[0]).toMatchObject({
        type: 'CASE_ASSIGNED',
        actionType: 'OPEN_TASK',
        payload: { taskId: mine!.id, caseNumber: expect.stringMatching(/^CASE-/) },
      });
    });

    it('rate type resolves from rate management — most specific location wins', async () => {
      const { ctx, loc, caseId, applicantId } = await locatedCase('RT');
      // a location-specific LOCAL rate + a default (location-less) OGL rate → the specific one wins.
      await db!.pool.query(
        `INSERT INTO rates (client_id, product_id, verification_unit_id, location_id, rate_type_id, amount)
         VALUES ($1, $2, $3, NULL, (SELECT id FROM rate_types WHERE code = 'OGL'), 250),
                ($1, $2, $3, $4, (SELECT id FROM rate_types WHERE code = 'LOCAL'), 100)`,
        [ctx.clientId, ctx.productId, ctx.enabledUnitId, loc],
      );
      const add = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks`)
        .set(SA)
        .send({
          tasks: [
            {
              verificationUnitId: ctx.enabledUnitId,
              applicantId,
              address: ADDR,
              pincodeId: loc,
              areaId: loc,
            },
          ],
        });
      expect(add.status).toBe(201);
      const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
      const t = (detail.body.tasks as Array<{ areaId: number | null; clientRateType: string | null }>).find(
        (x) => x.areaId === loc,
      );
      expect(t?.clientRateType).toBe('LOCAL');
    });

    it('rate type falls back to the CPV rate when the task has NO location', async () => {
      const ctx = await seedCpv('RTF');
      const caseId = seeded<{ id: string }>(
        await request(app)
          .post('/api/v2/cases')
          .set(SA)
          .send({
            clientId: ctx.clientId,
            productId: ctx.productId,
            backendContactNumber: BC,
            applicants: [{ name: 'RTF APP' }],
            dedupeDecision: 'NO_DUPLICATES_FOUND',
          }),
      ).id;
      const applicantId = (await request(app).get(`/api/v2/cases/${caseId}`).set(SA)).body.applicants[0]
        .id as string;
      // a single location-specific OUTSTATION rate; the task carries NO location → still resolves to it.
      const someLoc = (
        await db!.pool.query<{ id: number }>(
          `INSERT INTO locations (pincode, area, city, state, country)
           VALUES ('700001', 'RTF Area', 'Kolkata', 'West Bengal', 'India') RETURNING id`,
        )
      ).rows[0]!.id;
      await db!.pool.query(
        `INSERT INTO rates (client_id, product_id, verification_unit_id, location_id, rate_type_id, amount)
         VALUES ($1, $2, $3, $4, (SELECT id FROM rate_types WHERE code = 'OUTSTATION'), 400)`,
        [ctx.clientId, ctx.productId, ctx.enabledUnitId, someLoc],
      );
      seeded(
        await request(app)
          .post(`/api/v2/cases/${caseId}/tasks`)
          .set(SA)
          .send({ tasks: [{ verificationUnitId: ctx.enabledUnitId, applicantId, address: ADDR }] }),
      );
      const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
      const t = (detail.body.tasks as Array<{ clientRateType: string | null }>)[0];
      expect(t?.clientRateType).toBe('OUTSTATION');
    });
  });

  // ── Data scope (Epic F slice 1): case-list visibility follows the reports_to hierarchy ──
  describe('data scope', () => {
    const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });
    const visibleIds = async (h: Record<string, string>): Promise<string[]> =>
      ((await request(app).get('/api/v2/cases').set(h)).body.items as { id: string }[]).map((c) => c.id);

    it('a case is visible only up the hierarchy of its assignee (SUPER_ADMIN sees all)', async () => {
      const mgr = await createUser({ username: 'sc_mgr', name: 'SCOPE MGR', role: 'MANAGER' });
      const tl = await createUser({
        username: 'sc_tl',
        name: 'SCOPE TL',
        role: 'TEAM_LEADER',
        reportsTo: mgr,
      });
      const fa1 = await createUser({
        username: 'sc_fa1',
        name: 'SCOPE FA1',
        role: 'FIELD_AGENT',
        reportsTo: tl,
      });
      const fa2 = await createUser({ username: 'sc_fa2', name: 'SCOPE FA2', role: 'FIELD_AGENT' }); // unrelated
      const { caseId, taskId } = await seedCaseWithTask('SCOPE');
      const asg = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(SA)
        .send({ assignedTo: fa1, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1, version: 1 });
      expect(asg.status).toBe(200);

      expect(await visibleIds(hdr('FIELD_AGENT', fa1))).toContain(caseId); // the assignee
      expect(await visibleIds(hdr('TEAM_LEADER', tl))).toContain(caseId); // direct leader
      expect(await visibleIds(hdr('MANAGER', mgr))).toContain(caseId); // up the subtree
      expect(await visibleIds(hdr('FIELD_AGENT', fa2))).not.toContain(caseId); // unrelated agent
      expect(await visibleIds(SA)).toContain(caseId); // SUPER_ADMIN bypasses scope

      // Scope is applied to the COUNT as well — the unrelated agent's page is internally consistent.
      const r = await request(app).get('/api/v2/cases').set(hdr('FIELD_AGENT', fa2));
      expect(r.body.items.length).toBe(r.body.totalCount);
      expect(r.body.totalCount).toBe(0);
    });

    it('case DETAIL is scoped too — an out-of-scope id is 404 (IDOR-safe), in-scope is 200', async () => {
      const tl = await createUser({ username: 'sd_tl', name: 'SD TL', role: 'TEAM_LEADER' });
      const fa1 = await createUser({
        username: 'sd_fa1',
        name: 'SD FA1',
        role: 'FIELD_AGENT',
        reportsTo: tl,
      });
      const fa2 = await createUser({ username: 'sd_fa2', name: 'SD FA2', role: 'FIELD_AGENT' }); // unrelated
      const { caseId, taskId } = await seedCaseWithTask('DETAIL');
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(SA)
        .send({ assignedTo: fa1, visitType: 'FIELD', fieldRateType: 'LOCAL', billCount: 1, version: 1 });

      expect((await request(app).get(`/api/v2/cases/${caseId}`).set(hdr('FIELD_AGENT', fa1))).status).toBe(
        200,
      );
      expect((await request(app).get(`/api/v2/cases/${caseId}`).set(hdr('TEAM_LEADER', tl))).status).toBe(
        200,
      );
      expect((await request(app).get(`/api/v2/cases/${caseId}`).set(SA)).status).toBe(200);
      // the unrelated agent gets 404 — out-of-scope is indistinguishable from missing.
      const denied = await request(app).get(`/api/v2/cases/${caseId}`).set(hdr('FIELD_AGENT', fa2));
      expect(denied.status).toBe(404);
      expect(denied.body.error).toBe('CASE_NOT_FOUND');
    });

    it('a field agent ALSO sees unassigned cases within their territory (Epic F slice 3)', async () => {
      const { clientId, productId } = await seedCpv('TERR');
      const pin = (
        await db!.pool.query<{ id: number }>(
          `INSERT INTO locations (pincode, area, city, state, country)
           VALUES ('560001', 'MG Road', 'Bengaluru', 'Karnataka', 'India') RETURNING id`,
        )
      ).rows[0]!.id;
      // a case located in `pin`, created by SA, assigned to NOBODY
      const caseId = (
        await request(app)
          .post('/api/v2/cases')
          .set(SA)
          .send({
            clientId,
            productId,
            backendContactNumber: BC,
            applicants: [{ name: 'TERR APP' }],
            dedupeDecision: 'NO_DUPLICATES_FOUND',
            pincodeId: pin,
          })
      ).body.id as string;
      const faIn = await createUser({ username: 'fa_terr_in', name: 'FA IN', role: 'FIELD_AGENT' });
      const faOut = await createUser({ username: 'fa_terr_out', name: 'FA OUT', role: 'FIELD_AGENT' });
      // give `pin` to faIn only
      await request(app)
        .post(`/api/v2/users/${faIn}/scope-assignments`)
        .set(SA)
        .send({ dimension: 'PINCODE', entityIds: [pin] });

      // faIn sees the unassigned case because it's in their territory; faOut (no territory) does not.
      expect(await visibleIds(hdr('FIELD_AGENT', faIn))).toContain(caseId);
      expect(await visibleIds(hdr('FIELD_AGENT', faOut))).not.toContain(caseId);
      // detail honors territory too
      expect((await request(app).get(`/api/v2/cases/${caseId}`).set(hdr('FIELD_AGENT', faIn))).status).toBe(
        200,
      );
      expect((await request(app).get(`/api/v2/cases/${caseId}`).set(hdr('FIELD_AGENT', faOut))).status).toBe(
        404,
      );
    });

    it('a backend user sees ONLY their assigned client+product portfolio — no cross-client leak (Epic F slice 4)', async () => {
      const a = await seedCpv('PORTA');
      const b = await seedCpv('PORTB');
      const mkCase = async (clientId: number, productId: number, name: string): Promise<string> =>
        (
          await request(app)
            .post('/api/v2/cases')
            .set(SA)
            .send({
              clientId,
              productId,
              backendContactNumber: BC,
              applicants: [{ name }],
              dedupeDecision: 'NO_DUPLICATES_FOUND',
            })
        ).body.id as string;
      // cases created by SA, assigned to NOBODY. caseCross shares product A but belongs to client B —
      // the cross-client leak the portfolio scoping must NOT show.
      const caseA = await mkCase(a.clientId, a.productId, 'PORT APP A'); // client A + product A
      const caseB = await mkCase(b.clientId, b.productId, 'PORT APP B'); // client B + product B
      const caseCross = await mkCase(b.clientId, a.productId, 'PORT CROSS'); // client B + product A
      const bePort = await createUser({ username: 'be_port', name: 'BE PORT', role: 'BACKEND_USER' });
      const beNone = await createUser({ username: 'be_port_n', name: 'BE NONE', role: 'BACKEND_USER' });
      // a FULL portfolio: client A AND product A (BACKEND_USER = CLIENT EXPAND capped by PRODUCT RESTRICT)
      await request(app)
        .post(`/api/v2/users/${bePort}/scope-assignments`)
        .set(SA)
        .send({ dimension: 'CLIENT', entityIds: [a.clientId] });
      await request(app)
        .post(`/api/v2/users/${bePort}/scope-assignments`)
        .set(SA)
        .send({ dimension: 'PRODUCT', entityIds: [a.productId] });

      const seen = await visibleIds(hdr('BACKEND_USER', bePort));
      expect(seen).toContain(caseA); // their client + their product
      expect(seen).not.toContain(caseB); // a different client AND product
      expect(seen).not.toContain(caseCross); // SAME product, different client → capped out (the leak fix)
      // a partial/empty portfolio is fail-closed (RESTRICT product), never "all"
      expect(await visibleIds(hdr('BACKEND_USER', beNone))).toEqual([]);
      // detail honors portfolio too: in-portfolio 200, cross-client 404, empty-portfolio 404
      expect((await request(app).get(`/api/v2/cases/${caseA}`).set(hdr('BACKEND_USER', bePort))).status).toBe(
        200,
      );
      expect(
        (await request(app).get(`/api/v2/cases/${caseCross}`).set(hdr('BACKEND_USER', bePort))).status,
      ).toBe(404);
      expect((await request(app).get(`/api/v2/cases/${caseA}`).set(hdr('BACKEND_USER', beNone))).status).toBe(
        404,
      );
    });

    it('RESTRICT mode CAPS visibility: hierarchy ALL + CLIENT RESTRICT sees only assigned clients (ADR-0022)', async () => {
      const a = await seedCpv('RESTA');
      const b = await seedCpv('RESTB');
      const mkCase = async (clientId: number, productId: number, name: string): Promise<string> =>
        (
          await request(app)
            .post('/api/v2/cases')
            .set(SA)
            .send({
              clientId,
              productId,
              backendContactNumber: BC,
              applicants: [{ name }],
              dedupeDecision: 'NO_DUPLICATES_FOUND',
            })
        ).body.id as string;
      const caseA = await mkCase(a.clientId, a.productId, 'REST APP A');
      const caseB = await mkCase(b.clientId, b.productId, 'REST APP B');
      const auditor = await createUser({
        username: 'be_restrict',
        name: 'BE RESTRICT',
        role: 'BACKEND_USER',
      });
      const auditorNone = await createUser({
        username: 'be_restrict_0',
        name: 'BE R0',
        role: 'BACKEND_USER',
      });
      // reconfigure the role (an admin Role-Management act): see EVERYTHING, capped to assigned clients.
      // Neutralize the default PRODUCT cap so this test isolates the CLIENT RESTRICT mechanic.
      await db!.pool.query(`UPDATE roles SET hierarchy_mode = 'ALL' WHERE code = 'BACKEND_USER'`);
      await db!.pool.query(
        `UPDATE role_scope_dimensions SET mode = 'RESTRICT' WHERE role_code = 'BACKEND_USER' AND dimension_code = 'CLIENT'`,
      );
      await db!.pool.query(
        `UPDATE role_scope_dimensions SET mode = 'EXPAND' WHERE role_code = 'BACKEND_USER' AND dimension_code = 'PRODUCT'`,
      );
      invalidateRoleCache();
      try {
        await request(app)
          .post(`/api/v2/users/${auditor}/scope-assignments`)
          .set(SA)
          .send({ dimension: 'CLIENT', entityIds: [a.clientId] });
        const seen = await visibleIds(hdr('BACKEND_USER', auditor));
        expect(seen).toContain(caseA);
        expect(seen).not.toContain(caseB);
        expect(
          (await request(app).get(`/api/v2/cases/${caseB}`).set(hdr('BACKEND_USER', auditor))).status,
        ).toBe(404);
        // RESTRICT with ZERO assignments → sees NOTHING (fail-closed, never "all")
        expect(await visibleIds(hdr('BACKEND_USER', auditorNone))).toEqual([]);
      } finally {
        await db!.pool.query(`UPDATE roles SET hierarchy_mode = 'SELF' WHERE code = 'BACKEND_USER'`);
        await db!.pool.query(
          `UPDATE role_scope_dimensions SET mode = 'EXPAND' WHERE role_code = 'BACKEND_USER' AND dimension_code = 'CLIENT'`,
        );
        await db!.pool.query(
          `UPDATE role_scope_dimensions SET mode = 'RESTRICT' WHERE role_code = 'BACKEND_USER' AND dimension_code = 'PRODUCT'`,
        );
        invalidateRoleCache();
      }
    });
  });

  describe('field photo reverse-geocode (ADR-0040)', () => {
    beforeAll(() => setStorage(fakeStorage));
    afterAll(() => {
      setStorage(null);
      setGeocoder(null);
    });

    /** Seed a case+task, then insert ONE FIELD_PHOTO row with the given geo. */
    async function seedPhoto(
      tag: string,
      geo: Record<string, unknown> | null,
    ): Promise<{ caseId: string; photoId: string }> {
      const { caseId, taskId } = await seedCaseWithTask(tag);
      const row = await caseRepository.insertFieldAttachment(
        {
          caseId,
          taskId,
          originalName: 'p.jpg',
          mimeType: 'image/jpeg',
          fileSize: 100,
          storageKey: `field-photos/${caseId}/${taskId}/x.jpg`,
          thumbnailKey: null,
          sha256: 'a'.repeat(64),
          clientSha256: null,
          hashVerified: false,
          geoLocation: geo,
          photoType: 'verification',
          submissionId: null,
          verificationType: 'RESIDENCE',
          operationId: `geo-${tag}:0`,
        },
        '00000000-0000-0000-0000-000000000001',
      );
      return { caseId, photoId: row.id };
    }

    it('resolves + freezes the address on view; surfaced on the list; second view is cached', async () => {
      setGeocoder({ reverse: () => Promise.resolve('12 MG ROAD, MUMBAI 400001') });
      const { caseId, photoId } = await seedPhoto('GEO1', {
        latitude: 19.07,
        longitude: 72.87,
        accuracy: 8,
        timestamp: '2026-06-16T10:00:00Z',
      });
      const r1 = await request(app).get(`/api/v2/cases/${caseId}/field-photos/${photoId}/address`).set(SA);
      expect(r1.status).toBe(200);
      expect(r1.body).toEqual({ address: '12 MG ROAD, MUMBAI 400001', cached: false });

      // Persisted + surfaced on the #7 list.
      const list = await request(app).get(`/api/v2/cases/${caseId}/field-photos`).set(SA);
      expect(list.body[0].reverseGeocodedAddress).toBe('12 MG ROAD, MUMBAI 400001');

      // A later geocoder returning something else must NOT change the frozen value (cached early-return).
      setGeocoder({ reverse: () => Promise.resolve('SOMEWHERE ELSE') });
      const r2 = await request(app).get(`/api/v2/cases/${caseId}/field-photos/${photoId}/address`).set(SA);
      expect(r2.body).toEqual({ address: '12 MG ROAD, MUMBAI 400001', cached: true });
    });

    it('FIELD_PHOTO rows are excluded from the general attachments list (shown only in Field Photos)', async () => {
      setGeocoder({ reverse: () => Promise.resolve(null) });
      const { caseId, photoId } = await seedPhoto('NOLEAK', { latitude: 19.07, longitude: 72.87 });
      // the field photo IS surfaced in the dedicated Field Photos card…
      const photos = await request(app).get(`/api/v2/cases/${caseId}/field-photos`).set(SA);
      expect(photos.body.some((p: { id: string }) => p.id === photoId)).toBe(true);
      // …but is NOT mixed into the general attachments list (ADR-0034 separation).
      const atts = await request(app).get(`/api/v2/cases/${caseId}/attachments`).set(SA);
      expect(atts.body.some((a: { id: string }) => a.id === photoId)).toBe(false);
    });

    it('null geocoder result → null (UI degrades to coords); nothing persisted', async () => {
      setGeocoder({ reverse: () => Promise.resolve(null) });
      const { caseId, photoId } = await seedPhoto('GEO2', { latitude: 1.5, longitude: 2.5, accuracy: 5 });
      const r = await request(app).get(`/api/v2/cases/${caseId}/field-photos/${photoId}/address`).set(SA);
      expect(r.body).toEqual({ address: null, cached: false });
    });

    it('no coords → null without calling the geocoder', async () => {
      let called = false;
      setGeocoder({
        reverse: () => {
          called = true;
          return Promise.resolve('X');
        },
      });
      const { caseId, photoId } = await seedPhoto('GEO3', null);
      const r = await request(app).get(`/api/v2/cases/${caseId}/field-photos/${photoId}/address`).set(SA);
      expect(r.body).toEqual({ address: null, cached: false });
      expect(called).toBe(false);
    });

    it('unknown attachment id → 404 (IDOR-safe)', async () => {
      const { caseId } = await seedPhoto('GEO4', { latitude: 1, longitude: 1 });
      const r = await request(app)
        .get(`/api/v2/cases/${caseId}/field-photos/00000000-0000-0000-0000-0000000000ff/address`)
        .set(SA);
      expect(r.status).toBe(404);
    });

    it('async on-upload enqueue resolves + persists (in-process); skips an already-frozen row', async () => {
      // Distinct coords (the geocode_cache is coordinate-keyed + frozen — avoid other tests' grid cells).
      setGeocoder({ reverse: () => Promise.resolve('QUEUE ADDR, DELHI') });
      const { photoId } = await seedPhoto('GEO5', { latitude: 28.61, longitude: 77.21 });
      await enqueueReverseGeocode({ attachmentId: photoId, lat: 28.61, lng: 77.21 });
      await awaitAllReverseGeocodeJobs();
      expect(await caseRepository.fieldPhotoAddressById(photoId)).toBe('QUEUE ADDR, DELHI');

      // Re-enqueue with a different geocoder → frozen value unchanged (skip-if-set).
      setGeocoder({ reverse: () => Promise.resolve('SOMETHING DIFFERENT') });
      await enqueueReverseGeocode({ attachmentId: photoId, lat: 28.61, lng: 77.21 });
      await awaitAllReverseGeocodeJobs();
      expect(await caseRepository.fieldPhotoAddressById(photoId)).toBe('QUEUE ADDR, DELHI');
    });

    it('DLQ: insert → list open → replay re-enqueues + resolves + clears', async () => {
      const { photoId } = await seedPhoto('GEO6', { latitude: 12.97, longitude: 77.59 });
      await geocodeRepository.insertReverseGeocodeDlq(photoId, 12.97, 77.59, 'GEOCODE_UNRESOLVED');
      const open = await geocodeService.dlq();
      expect(open.some((r) => r.attachmentId === photoId)).toBe(true);

      setGeocoder({ reverse: () => Promise.resolve('REPLAYED ADDR, BENGALURU') });
      const res = await geocodeService.replayDlq();
      expect(res.replayed).toBeGreaterThanOrEqual(1);
      await awaitAllReverseGeocodeJobs();
      expect(await caseRepository.fieldPhotoAddressById(photoId)).toBe('REPLAYED ADDR, BENGALURU');
      // The open slot is cleared (replayed_at stamped).
      expect((await geocodeService.dlq()).some((r) => r.attachmentId === photoId)).toBe(false);
    });
  });

  // ── Field-photo downloads + GPS map inset (ADR-0060) ──────────────────────
  describe('field photo download / zip / static-map (ADR-0060)', () => {
    const PHOTO_BYTES = Buffer.from('PNGDATA');
    // A storage fake whose get(key) yields known bytes (the base fakeStorage returns empty bytes).
    const bytesStorage: StorageProvider = {
      put: (key) => Promise.resolve({ key }),
      get: () => Promise.resolve(PHOTO_BYTES),
      signedUrl: (key) => Promise.resolve(`https://signed.example/${key}`),
      remove: () => Promise.resolve(),
    };

    beforeAll(() => setStorage(bytesStorage));
    afterAll(() => setStorage(null));
    afterEach(() => setStaticMapProvider(null));

    /** Replicate the server's canonical filename (cases/service.ts fieldPhotoFilename) for an assertion. */
    function expectedFilename(
      caseNumber: string,
      taskNumber: string,
      seq: number,
      photoType: string,
    ): string {
      const sanitize = (s: string): string => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const nn = String(seq).padStart(2, '0');
      return `${sanitize(caseNumber)}_${sanitize(taskNumber)}_${nn}_${sanitize(photoType)}.jpg`;
    }

    /** Seed a case+task, then insert ONE FIELD_PHOTO row (known storage key + geo + photo_type). */
    async function seedFieldPhoto(
      tag: string,
      geo: Record<string, unknown> | null,
    ): Promise<{ caseId: string; photoId: string; caseNumber: string; taskNumber: string }> {
      const { caseId, taskId } = await seedCaseWithTask(tag);
      const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
      const caseNumber = detail.body.caseNumber as string;
      const taskNumber = detail.body.tasks[0].taskNumber as string;
      const row = await caseRepository.insertFieldAttachment(
        {
          caseId,
          taskId,
          originalName: 'p.jpg',
          mimeType: 'image/jpeg',
          fileSize: PHOTO_BYTES.length,
          storageKey: `field-photos/${caseId}/${taskId}/x.jpg`,
          thumbnailKey: null,
          sha256: 'a'.repeat(64),
          clientSha256: null,
          hashVerified: false,
          geoLocation: geo,
          photoType: 'verification',
          submissionId: null,
          verificationType: 'RESIDENCE',
          operationId: `dl-${tag}:0`,
        },
        '00000000-0000-0000-0000-000000000001',
      );
      return { caseId, photoId: row.id, caseNumber, taskNumber };
    }

    it('downloads ONE field photo with the canonical filename + bytes; unknown id → 404', async () => {
      const { caseId, photoId, caseNumber, taskNumber } = await seedFieldPhoto('DL1', {
        latitude: 19.07,
        longitude: 72.87,
      });
      const res = await request(app).get(`/api/v2/cases/${caseId}/field-photos/${photoId}/download`).set(SA);
      expect(res.status).toBe(200);
      const cd = res.headers['content-disposition'] as string;
      // canonical <caseNumber>_<taskNumber>_01_<TYPE>.<ext> (seq 1 → NN=01; photoType 'verification')
      expect(cd).toContain(`filename="${expectedFilename(caseNumber, taskNumber, 1, 'verification')}"`);
      expect(cd).toMatch(/filename="CASE_\d{6}_CASE_\d{6}_1_01_verification\.jpg"/);
      expect(Buffer.from(res.body)).toEqual(PHOTO_BYTES);

      const unknown = await request(app)
        .get(`/api/v2/cases/${caseId}/field-photos/00000000-0000-0000-0000-0000000000ff/download`)
        .set(SA);
      expect(unknown.status).toBe(404);
    });

    it('bakes the GPS overlay INTO the single download — a valid JPEG, not the raw bytes (ADR-0075)', async () => {
      // A real JPEG + static-map PNG so the compositor actually runs (the PHOTO_BYTES fixture is a non-image
      // that fail-opens). Restores the shared bytesStorage in `finally` so later tests are unaffected.
      const realJpeg = await sharp({
        create: { width: 400, height: 600, channels: 3, background: { r: 100, g: 120, b: 140 } },
      })
        .jpeg()
        .toBuffer();
      const mapPng = await sharp({
        create: { width: 240, height: 160, channels: 3, background: { r: 30, g: 150, b: 70 } },
      })
        .png()
        .toBuffer();
      setStorage({
        put: (key) => Promise.resolve({ key }),
        get: () => Promise.resolve(realJpeg),
        signedUrl: (key) => Promise.resolve(`https://signed.example/${key}`),
        remove: () => Promise.resolve(),
      });
      setStaticMapProvider({ thumbnail: () => Promise.resolve(mapPng) });
      try {
        const { caseId, photoId } = await seedFieldPhoto('BAKE', {
          latitude: 19.07,
          longitude: 72.87,
          accuracy: 10,
          timestamp: '2026-06-22T05:51:16.600Z',
        });
        const res = await request(app)
          .get(`/api/v2/cases/${caseId}/field-photos/${photoId}/download`)
          .set(SA)
          .buffer(true)
          .parse((r, cb) => {
            const chunks: Buffer[] = [];
            r.on('data', (c: Buffer) => chunks.push(c));
            r.on('end', () => cb(null, Buffer.concat(chunks)));
          });
        expect(res.status).toBe(200);
        const body = res.body as Buffer;
        const meta = await sharp(body).metadata();
        expect(meta.format).toBe('jpeg');
        expect(meta.width).toBe(400); // overlaid on the bottom — dimensions preserved
        expect(meta.height).toBe(600);
        expect(body.equals(realJpeg)).toBe(false); // overlay composited in, not the raw photo
      } finally {
        setStorage(bytesStorage);
      }
    });

    it('zips ALL field photos (application/zip, non-empty); a case with none → 404 NO_FIELD_PHOTOS', async () => {
      const { caseId } = await seedFieldPhoto('ZIP1', { latitude: 19.07, longitude: 72.87 });
      const zip = await request(app)
        .get(`/api/v2/cases/${caseId}/field-photos.zip`)
        .set(SA)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(zip.status).toBe(200);
      expect(zip.headers['content-type']).toContain('application/zip');
      expect((zip.body as Buffer).length).toBeGreaterThan(0);

      // A case with NO field photos → 404 NO_FIELD_PHOTOS (the web hides the control, not an empty zip).
      const { caseId: emptyCaseId } = await seedCaseWithTask('ZIP_EMPTY');
      const none = await request(app).get(`/api/v2/cases/${emptyCaseId}/field-photos.zip`).set(SA);
      expect(none.status).toBe(404);
      expect(none.body.error).toBe('NO_FIELD_PHOTOS');
    });

    it('serves the static-map PNG when the provider yields bytes', async () => {
      const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      setStaticMapProvider({ thumbnail: () => Promise.resolve(PNG) });
      const { caseId, photoId } = await seedFieldPhoto('SM1', { latitude: 19.07, longitude: 72.87 });
      const res = await request(app).get(`/api/v2/cases/${caseId}/field-photos/${photoId}/staticmap`).set(SA);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(Buffer.from(res.body)).toEqual(PNG);
    });

    it('404 STATIC_MAP_UNAVAILABLE when the provider returns null', async () => {
      setStaticMapProvider({ thumbnail: () => Promise.resolve(null) });
      const { caseId, photoId } = await seedFieldPhoto('SM2', { latitude: 19.07, longitude: 72.87 });
      const res = await request(app).get(`/api/v2/cases/${caseId}/field-photos/${photoId}/staticmap`).set(SA);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('STATIC_MAP_UNAVAILABLE');
    });

    it('404 STATIC_MAP_UNAVAILABLE when the photo has no coords (provider not consulted)', async () => {
      let called = false;
      setStaticMapProvider({
        thumbnail: () => {
          called = true;
          return Promise.resolve(Buffer.from([0x89]));
        },
      });
      const { caseId, photoId } = await seedFieldPhoto('SM3', null);
      const res = await request(app).get(`/api/v2/cases/${caseId}/field-photos/${photoId}/staticmap`).set(SA);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('STATIC_MAP_UNAVAILABLE');
      expect(called).toBe(false);
    });

    it('IDOR: an out-of-scope user gets 404 on download / zip / static-map (indistinguishable from missing)', async () => {
      setStaticMapProvider({ thumbnail: () => Promise.resolve(Buffer.from([0x89, 0x50, 0x4e, 0x47])) });
      const { caseId, photoId } = await seedFieldPhoto('IDOR', { latitude: 19.07, longitude: 72.87 });
      // A FIELD_AGENT assigned NOTHING on this case → the case is out of scope (has case.view, no access).
      const stranger = await createUser({ username: 'fp_idor', name: 'STRANGER', role: 'FIELD_AGENT' });
      const auth = { 'x-test-auth': `FIELD_AGENT:${stranger}` };
      expect(
        (await request(app).get(`/api/v2/cases/${caseId}/field-photos/${photoId}/download`).set(auth)).status,
      ).toBe(404);
      expect(
        (await request(app).get(`/api/v2/cases/${caseId}/field-photos/${photoId}/staticmap`).set(auth))
          .status,
      ).toBe(404);
      expect((await request(app).get(`/api/v2/cases/${caseId}/field-photos.zip`).set(auth)).status).toBe(404);
    });
  });

  describe('POST /cases/:id/applicants (ADR-0053)', () => {
    async function newCase(tag: string): Promise<string> {
      const { clientId, productId } = await seedCpv(`AP_${tag.toUpperCase()}`);
      const res = await request(app)
        .post('/api/v2/cases')
        .set(SA)
        .send({
          clientId,
          productId,
          backendContactNumber: BC,
          applicants: [{ name: 'PRIMARY PERSON', mobile: '9870000000' }],
          dedupeDecision: 'NO_DUPLICATES_FOUND',
        });
      return seeded<{ id: string }>(res).id;
    }

    it('adds a co-applicant to a NEW case (201) as CO_APPLICANT/non-primary with its dedupe verdict', async () => {
      const id = await newCase('clean');
      const res = await request(app)
        .post(`/api/v2/cases/${id}/applicants`)
        .set(SA)
        .send({ name: 'Sita Rao', mobile: '9990001111', dedupeDecision: 'NO_DUPLICATES_FOUND' });
      expect(res.status).toBe(201);
      expect(res.body.applicantType).toBe('CO_APPLICANT');
      expect(res.body.isPrimary).toBe(false);
      expect(res.body.dedupeDecision).toBe('NO_DUPLICATES_FOUND');
      expect(res.body.dedupeMatchedCaseNumbers).toEqual([]);

      const detail = await request(app).get(`/api/v2/cases/${id}`).set(SA);
      expect(detail.body.applicants.map((a: { name: string }) => a.name)).toContain('SITA RAO');
      expect(detail.body.applicants.filter((a: { isPrimary: boolean }) => a.isPrimary)).toHaveLength(1);
    });

    it('requires a rationale for CREATE_NEW (400)', async () => {
      const id = await newCase('norat');
      const res = await request(app)
        .post(`/api/v2/cases/${id}/applicants`)
        .set(SA)
        .send({ name: 'Dup Person', dedupeDecision: 'CREATE_NEW' });
      expect(res.status).toBe(400);
    });

    it('accepts CREATE_NEW with a rationale (201) and stores matched case numbers', async () => {
      const id = await newCase('rat');
      const res = await request(app)
        .post(`/api/v2/cases/${id}/applicants`)
        .set(SA)
        .send({
          name: 'Dup Person',
          dedupeDecision: 'CREATE_NEW',
          dedupeRationale: 'same name, different applicant',
          dedupeMatches: ['CASE-000001'],
        });
      expect(res.status).toBe(201);
      expect(res.body.dedupeDecision).toBe('CREATE_NEW');
      expect(res.body.dedupeMatchedCaseNumbers).toEqual(['CASE-000001']);

      // The per-applicant verdict must survive a re-read (GET /cases/:id), not be write-only.
      const detail = await request(app).get(`/api/v2/cases/${id}`).set(SA);
      const added = detail.body.applicants.find((a: { name: string }) => a.name === 'DUP PERSON');
      expect(added.dedupeDecision).toBe('CREATE_NEW');
      expect(added.dedupeMatchedCaseNumbers).toEqual(['CASE-000001']);
      // The creation-time primary applicant has no per-row verdict (covered by the case-level record).
      const primary = detail.body.applicants.find((a: { isPrimary: boolean }) => a.isPrimary);
      expect(primary.dedupeDecision).toBeNull();
    });

    it('rejects adding to a non-open (CANCELLED) case (409 CASE_NOT_OPEN)', async () => {
      const id = await newCase('closed');
      await db!.pool.query(`UPDATE cases SET status = 'CANCELLED' WHERE id = $1`, [id]);
      const res = await request(app)
        .post(`/api/v2/cases/${id}/applicants`)
        .set(SA)
        .send({ name: 'Late', dedupeDecision: 'NO_DUPLICATES_FOUND' });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('CASE_NOT_OPEN');
    });

    it('404 for an unknown case id', async () => {
      const res = await request(app)
        .post('/api/v2/cases/00000000-0000-0000-0000-000000000000/applicants')
        .set(SA)
        .send({ name: 'Ghost', dedupeDecision: 'NO_DUPLICATES_FOUND' });
      expect(res.status).toBe(404);
    });

    it('forbids a role without case.create (FIELD_AGENT → 403)', async () => {
      const id = await newCase('rbac');
      const res = await request(app)
        .post(`/api/v2/cases/${id}/applicants`)
        .set(FA)
        .send({ name: 'Sita', dedupeDecision: 'NO_DUPLICATES_FOUND' });
      expect(res.status).toBe(403);
    });
  });

  // Case-creation workflow lookups (dedicated, case.create-gated) — a case-creator must be able to drive
  // the whole new-case flow WITHOUT page.masterdata. Regression-proofed with a bespoke role that holds
  // case.create/case.view but explicitly NOT page.masterdata: revert any guard back to MASTERDATA_VIEW and
  // these 200s flip to 403.
  describe('GET /cases/lookups/* (decoupled from page.masterdata)', () => {
    const NOMD = { 'x-test-auth': 'CASE_CREATOR_NO_MD:11111111-1111-1111-1111-111111111111' };
    beforeAll(async () => {
      await db!.pool.query(
        `INSERT INTO roles (code, name, hierarchy_mode)
         VALUES ('CASE_CREATOR_NO_MD', 'Case Creator (no masterdata)', 'SELF')
         ON CONFLICT (code) DO NOTHING`,
      );
      await db!.pool.query(
        `INSERT INTO role_permissions (role_code, permission_code) VALUES
           ('CASE_CREATOR_NO_MD', 'case.create'), ('CASE_CREATOR_NO_MD', 'case.view')
         ON CONFLICT (role_code, permission_code) DO NOTHING`,
      );
      invalidateRoleCache();
    });

    it('serves clients/products/tat-policies/locations to a case.create role that lacks masterdata', async () => {
      const { clientId } = await seedCpv('NOMD');
      for (const path of [
        '/api/v2/cases/lookups/clients',
        `/api/v2/cases/lookups/products?clientId=${clientId}`,
        '/api/v2/cases/lookups/tat-policies',
        '/api/v2/cases/lookups/locations?search=400&limit=5',
      ]) {
        const res = await request(app).get(path).set(NOMD);
        expect(res.status, path).toBe(200);
      }
      // sanity: the same role genuinely has NO page.masterdata (the masterdata list 403s for it).
      expect((await request(app).get('/api/v2/clients/options').set(NOMD)).status).toBe(403);
    });

    it('products are client-first: only products the chosen client has enabled; clientId required', async () => {
      const { clientId, productId } = await seedCpv('NOMDP');
      // the seeded client returns its enabled product
      const ok = await request(app).get(`/api/v2/cases/lookups/products?clientId=${clientId}`).set(NOMD);
      expect(ok.status).toBe(200);
      expect(ok.body.map((p: { id: number }) => p.id)).toContain(productId);
      // a different client with no client_products link returns none of it
      const otherClientId = seeded<{ id: number }>(
        await request(app)
          .post('/api/v2/clients')
          .set(SA)
          .send(clientFactory({ code: 'C_NOMDPX' })),
      ).id;
      const otherList = await request(app)
        .get(`/api/v2/cases/lookups/products?clientId=${otherClientId}`)
        .set(NOMD);
      expect(otherList.status).toBe(200);
      expect(otherList.body.map((p: { id: number }) => p.id)).not.toContain(productId);
      // clientId is mandatory
      expect((await request(app).get('/api/v2/cases/lookups/products').set(NOMD)).status).toBe(400);
    });

    it('forbids a role without case.create (FIELD_AGENT → 403); unauth → 401', async () => {
      expect((await request(app).get('/api/v2/cases/lookups/clients').set(FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/cases/lookups/clients')).status).toBe(401);
    });
  });
});
