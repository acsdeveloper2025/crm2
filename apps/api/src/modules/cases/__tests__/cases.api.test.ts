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
import { setGeocoder } from '../../../platform/geocode/index.js';
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
async function seedCpv(tag: string): Promise<Ctx> {
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
  const enabledUnitId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: `UE_${tag}` })),
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
    expect(ok.body.dedupeRationale).toContain('Different loan');
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
    expect(detail.body.applicants[0].companyName).toBe('Acme Industries');
    // the in-create dedupe gate matches on company (case-insensitive)
    const gate = await request(app).post('/api/v2/cases/dedupe').set(SA).send({ company: 'acme industries' });
    expect(gate.body).toHaveLength(1);
    expect(gate.body[0].matchType).toContain('COMPANY');
    expect(gate.body[0].companyName).toBe('Acme Industries');
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
      expect(res.body.items[0].companyName).toBe('Globex');
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

    it('exports the matches as CSV (data.export); a role without it → 403', async () => {
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
      expect(csv.text).toContain('Initech');
      // export needs data.export — FIELD_AGENT lacks it
      expect((await request(app).get('/api/v2/cases/dedupe-search/export?pan=x').set(FA)).status).toBe(403);
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
    return res.body.id as string;
  }

  async function seedCaseWithTask(tag: string): Promise<{ caseId: string; taskId: string }> {
    const ctx = await seedCpv(tag);
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
    return { caseId, taskId: task.id };
  }

  it('assigns a task to an executive (status ASSIGNED + visit/distance/bill + assignee name)', async () => {
    const { caseId, taskId } = await seedCaseWithTask('AS1');
    const agent = await createUser({ username: 'fa_as1', name: 'FIELD ONE', role: 'FIELD_AGENT' });

    const res = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
      .set(SA)
      .send({ assignedTo: agent, visitType: 'FIELD', distanceBand: 'LOCAL', billCount: 2, version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ASSIGNED');
    expect(res.body.assignedTo).toBe(agent);
    expect(res.body.assignedToName).toBe('FIELD ONE');
    expect(res.body.visitType).toBe('FIELD');
    expect(res.body.distanceBand).toBe('LOCAL');
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

  it('reassigns to a different executive, then unassigns back to PENDING', async () => {
    const { caseId, taskId } = await seedCaseWithTask('AS2');
    // ADR-0024: the pool follows the chosen visit type. Reassign across pools — a FIELD agent first,
    // then re-pool to OFFICE and a KYC verifier (the task is unlocated → no territory gate).
    const a1 = await createUser({ username: 'fa_as2a', name: 'AGENT A', role: 'FIELD_AGENT' });
    const a2 = await createUser({ username: 'kyc_as2b', name: 'OFFICE B', role: 'KYC_VERIFIER' });

    await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
      .set(SA)
      .send({ assignedTo: a1, visitType: 'FIELD', distanceBand: 'LOCAL', billCount: 1, version: 1 });
    const reassign = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
      .set(SA)
      .send({ assignedTo: a2, visitType: 'OFFICE', distanceBand: 'OGL', billCount: 1, version: 2 });
    expect(reassign.status).toBe(200);
    expect(reassign.body.assignedTo).toBe(a2);
    expect(reassign.body.visitType).toBe('OFFICE');

    const unassign = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/unassign`)
      .set(SA)
      .send({ version: 3 });
    expect(unassign.status).toBe(200);
    expect(unassign.body.status).toBe('PENDING');
    expect(unassign.body.assignedTo).toBeNull();
    expect(unassign.body.visitType).toBeNull();
    expect(unassign.body.billCount).toBe(1);
  });

  it('rejects an assignee outside the eligible pool (400 INVALID_ASSIGNEE)', async () => {
    const { caseId, taskId } = await seedCaseWithTask('AS3');
    const backend = await createUser({ username: 'be_as3', name: 'BACKEND', role: 'BACKEND_USER' });
    const res = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
      .set(SA)
      .send({ assignedTo: backend, visitType: 'FIELD', distanceBand: 'LOCAL', billCount: 1, version: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ASSIGNEE');
  });

  it('cannot assign a terminal task (409 TASK_NOT_ASSIGNABLE); cannot unassign a PENDING task (409)', async () => {
    const { caseId, taskId } = await seedCaseWithTask('AS4');
    const agent = await createUser({ username: 'fa_as4', name: 'FIELD FOUR', role: 'FIELD_AGENT' });

    const unassignPending = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/unassign`)
      .set(SA)
      .send({ version: 1 });
    expect(unassignPending.status).toBe(409);
    expect(unassignPending.body.error).toBe('TASK_NOT_ASSIGNED');

    await db!.pool.query(`UPDATE case_tasks SET status = 'COMPLETED' WHERE id = $1`, [taskId]);
    const res = await request(app)
      .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
      .set(SA)
      .send({ assignedTo: agent, visitType: 'FIELD', distanceBand: 'LOCAL', billCount: 1, version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TASK_NOT_ASSIGNABLE');
  });

  it('a backend user finalizes an assigned desk task → COMPLETED with the official result + remark (ADR-0025)', async () => {
    const { caseId, taskId } = await seedCaseWithTask('CP1');
    const verifier = await createUser({ username: 'kyc_cp1', name: 'DESK V', role: 'KYC_VERIFIER' });
    const be = await createUser({ username: 'be_cp1', name: 'BACKEND BOB', role: 'BACKEND_USER' });
    // a desk (OFFICE) task assigned to the read-only verifier (version 1 → 2)
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
    expect(res.body.remark).toBe('Verified against the issuer');
    expect(res.body.completedByName).toBe('BACKEND BOB'); // completed_by resolves to the user name
    expect(res.body.completedAt).toBeTruthy();
    expect(res.body.version).toBe(3); // OCC bumped

    const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
    expect(detail.body.tasks[0].verificationOutcome).toBe('POSITIVE');
    expect(detail.body.tasks[0].status).toBe('COMPLETED');
  });

  it('finalize guards: read-only verifier 403, out-of-scope 404, remark required 400, stale + terminal 409', async () => {
    const { caseId, taskId } = await seedCaseWithTask('CP2');
    const verifier = await createUser({ username: 'kyc_cp2', name: 'DESK V2', role: 'KYC_VERIFIER' });
    const outsider = await createUser({ username: 'be_cp2_out', name: 'BE OUT', role: 'BACKEND_USER' });
    expect(
      (
        await request(app)
          .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
          .set(SA)
          .send({ assignedTo: verifier, visitType: 'OFFICE', billCount: 1, version: 1 })
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
    // AWAITING_COMPLETION. OFFICE pool ⇒ a KYC verifier holds the task; SA (field_review.complete via
    // grants_all) records the per-task result. Returns the case's current OCC version (from the API).
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
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/complete`)
        .set(SA)
        .send({ result: 'POSITIVE', remark: 'desk check', version: 2 });
      const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
      expect(detail.body.status).toBe('AWAITING_COMPLETION'); // rollup: all tasks COMPLETED
      return detail.body.version as number;
    }

    it('rollup parks the case in AWAITING_COMPLETION; a backend user finalizes → COMPLETED with the ONE final verdict (distinct from the per-task result)', async () => {
      const { caseId, taskId } = await seedCaseWithTask('FIN1');
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
      expect(fin.body.resultRemark).toBe('final call from the desk');
      expect(fin.body.completedByName).toBe('FINAL FRED');
      expect(fin.body.completedAt).toBeTruthy();
      expect(fin.body.tasks[0].verificationOutcome).toBe('POSITIVE'); // per-task result preserved
      expect(fin.body.tasks[0].status).toBe('COMPLETED');
    });

    it('finalize guards: not-AWAITING 409, verifier 403, out-of-scope 404, stale 409, double-finalize 409', async () => {
      const { caseId, taskId } = await seedCaseWithTask('FIN2');
      const verifier = await createUser({ username: 'kyc_fin2', name: 'DESK V', role: 'KYC_VERIFIER' });
      const outsider = await createUser({ username: 'be_fin2_out', name: 'BE OUT', role: 'BACKEND_USER' });
      const url = `/api/v2/cases/${caseId}/finalize`;

      // the case is IN_PROGRESS (its task is not complete) → not finalizable
      const early = await request(app).post(url).set(SA).send({ result: 'POSITIVE', version: 1 });
      expect(early.status).toBe(409);
      expect(early.body.error).toBe('INVALID_TRANSITION');

      const version = await driveToAwaitingCompletion(caseId, taskId, 'FIN2');

      // read-only verifier lacks case.finalize → 403 (before any scope/state check)
      expect(
        (
          await request(app)
            .post(url)
            .set(hdr('KYC_VERIFIER', verifier))
            .send({ result: 'POSITIVE', version })
        ).status,
      ).toBe(403);
      // a backend user outside the case's scope → 404 (IDOR-safe, indistinguishable from missing)
      expect(
        (
          await request(app)
            .post(url)
            .set(hdr('BACKEND_USER', outsider))
            .send({ result: 'POSITIVE', version })
        ).status,
      ).toBe(404);
      // stale version → 409
      expect(
        (
          await request(app)
            .post(url)
            .set(SA)
            .send({ result: 'POSITIVE', version: version - 1 })
        ).status,
      ).toBe(409);
      // happy finalize → 200; a second finalize on the now-COMPLETED case → 409 INVALID_TRANSITION
      expect((await request(app).post(url).set(SA).send({ result: 'POSITIVE', version })).status).toBe(200);
      const again = await request(app)
        .post(url)
        .set(SA)
        .send({ result: 'POSITIVE', version: version + 1 });
      expect(again.status).toBe(409);
      expect(again.body.error).toBe('INVALID_TRANSITION');
    });

    it('a revisit-style new active task re-opens a COMPLETED case → IN_PROGRESS and invalidates the verdict', async () => {
      // built inline (not via seedCaseWithTask) so we keep ctx.enabledUnitId to add a second task.
      const ctx = await seedCpv('FIN3');
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
      const { caseId, taskId } = await seedCaseWithTask('RES');
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
      expect(res.body.remark).toBe('docs partial');
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
      const { caseId, taskId } = await seedCaseWithTask('RV1');
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

      // a BACKEND_USER is not in the OFFICE pool → 400 INVALID_ASSIGNEE
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
      const { caseId, taskId } = await seedCaseWithTask('VH1');
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
      expect(hist.body[0].remark).toBe('changed after revisit');
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
      const { caseId, taskId } = await seedCaseWithTask('VHR');
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
      expect(ok.body.remark).toBe('gate closed');
      // idempotent re-revoke → 200 (already REVOKED)
      expect((await request(app).post(url).set(SA).send({ reason: 'again' })).status).toBe(200);

      // a COMPLETED task CANNOT be revoked (it is reworked via revisit) → 409
      const done = await seedCaseWithTask('BRV2');
      await settle(done.caseId, done.taskId, 'BRV2');
      const blocked = await request(app)
        .post(`/api/v2/cases/${done.caseId}/tasks/${done.taskId}/revoke`)
        .set(SA)
        .send({ reason: 'too late' });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toBe('INVALID_TRANSITION');
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

    it('scope + RBAC: the assigned read-only verifier reads; an outsider 404; case.view-only cannot upload (403)', async () => {
      const { caseId, taskId } = await seedCaseWithTask('AT3');
      const verifier = await createUser({ username: 'kyc_at3', name: 'DESK A', role: 'KYC_VERIFIER' });
      await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(SA)
        .send({ assignedTo: verifier, visitType: 'OFFICE', billCount: 1, version: 1 });
      const att = await upload(caseId, PDF_BYTES, 'kyc.pdf', taskId);
      expect(att.status).toBe(201);

      // the assigned read-only verifier (case.view) sees + signs their task's document
      const vList = await request(app)
        .get(`/api/v2/cases/${caseId}/attachments`)
        .set(hdr('KYC_VERIFIER', verifier));
      expect(vList.status).toBe(200);
      expect(vList.body).toHaveLength(1);
      expect(
        (
          await request(app)
            .get(`/api/v2/cases/${caseId}/attachments/${att.body.id}/url`)
            .set(hdr('KYC_VERIFIER', verifier))
        ).status,
      ).toBe(200);

      // a verifier NOT on this case → case invisible → 404 (IDOR-safe)
      const outsider = await createUser({ username: 'kyc_at3_out', name: 'OUT', role: 'KYC_VERIFIER' });
      expect(
        (await request(app).get(`/api/v2/cases/${caseId}/attachments`).set(hdr('KYC_VERIFIER', outsider)))
          .status,
      ).toBe(404);

      // case.view-only (no case.create) cannot upload → 403 at the authorize gate
      expect((await upload(caseId, PDF_BYTES, 'x.pdf', taskId, hdr('KYC_VERIFIER', verifier))).status).toBe(
        403,
      );
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
      .send({ assignedTo: agent, visitType: 'FIELD', distanceBand: 'LOCAL', billCount: 1, version: 1 });
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
      const body = { assignedTo: agent, visitType: 'FIELD', distanceBand: 'LOCAL', billCount: 1 };

      const noVersion = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(SA)
        .send(body);
      expect(noVersion.status).toBe(400);
      expect(noVersion.body.error).toBe('VERSION_REQUIRED');

      expect(
        (
          await request(app)
            .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
            .set(SA)
            .send({ ...body, version: 1 })
        ).status,
      ).toBe(200);
      // version bumped to 2 → replaying version 1 is stale, returns the fresh row
      const stale = await request(app)
        .post(`/api/v2/cases/${caseId}/tasks/${taskId}/assign`)
        .set(SA)
        .send({ ...body, version: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.error).toBe('STALE_UPDATE');
      expect(stale.body.current.version).toBe(2);
    });

    it('writes the append-only history trail: ASSIGNED → REASSIGNED → UNASSIGNED', async () => {
      const { caseId, taskId } = await seedCaseWithTask('HIST');
      const a1 = await createUser({ username: 'fa_h1', name: 'HIST A', role: 'FIELD_AGENT' });
      const a2 = await createUser({ username: 'fa_h2', name: 'HIST B', role: 'FIELD_AGENT' });
      const post = (path: string, body: object) =>
        request(app).post(`/api/v2/cases/${caseId}/tasks/${taskId}/${path}`).set(SA).send(body);
      const attrs = { visitType: 'FIELD', distanceBand: 'LOCAL', billCount: 1 };
      expect((await post('assign', { ...attrs, assignedTo: a1, version: 1 })).status).toBe(200);
      expect((await post('assign', { ...attrs, assignedTo: a2, version: 2 })).status).toBe(200);
      expect((await post('unassign', { version: 3 })).status).toBe(200);

      const { rows } = await db!.pool.query<{
        action: string;
        assigned_to: string | null;
        previous_assigned_to: string | null;
      }>(
        `SELECT action, assigned_to, previous_assigned_to
         FROM task_assignment_history WHERE task_id = $1 ORDER BY id`,
        [taskId],
      );
      expect(rows.map((r) => r.action)).toEqual(['ASSIGNED', 'REASSIGNED', 'UNASSIGNED']);
      expect(rows[0]).toMatchObject({ assigned_to: a1, previous_assigned_to: null });
      expect(rows[1]).toMatchObject({ assigned_to: a2, previous_assigned_to: a1 });
      expect(rows[2]).toMatchObject({ assigned_to: null, previous_assigned_to: a2 });
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
        distanceBand: 'LOCAL',
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
      const body = { assignedTo: fa, visitType: 'FIELD', distanceBand: 'LOCAL', billCount: 1, version: 1 };

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
        .send({ assignedTo: fa, visitType: 'FIELD', distanceBand: 'LOCAL', billCount: 1, version: 1 });
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
      const { loc, caseId } = await locatedCase('PEF');
      const fa = await createUser({ username: 'fa_pef', name: 'PEF FA', role: 'FIELD_AGENT' });
      const kyc = await createUser({ username: 'kyc_pef', name: 'PEF KYC', role: 'KYC_VERIFIER' });
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
      expect(ids(field.body)).not.toContain(kyc); // wrong pool for FIELD

      // OFFICE: the KYC desk pool, no territory needed; field agents excluded.
      const office = await request(app)
        .get(`/api/v2/cases/${caseId}/eligible-assignees?visitType=OFFICE`)
        .set(SA);
      expect(office.status).toBe(200);
      expect(ids(office.body)).toContain(kyc);
      expect(ids(office.body)).not.toContain(fa);
    });

    it('assign-at-create: eligible assignee → ASSIGNED + history; ineligible → 400', async () => {
      const { ctx, loc, caseId, applicantId } = await locatedCase('AAC');
      const fa = await createUser({ username: 'fa_aac', name: 'AAC FA', role: 'FIELD_AGENT' });
      const spec = {
        verificationUnitId: ctx.enabledUnitId,
        applicantId,
        address: ADDR,
        visitType: 'FIELD',
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
    });

    it('rate type resolves from rate management — most specific location wins', async () => {
      const { ctx, loc, caseId, applicantId } = await locatedCase('RT');
      // a location-specific LOCAL rate + a default (location-less) OGL rate → the specific one wins.
      await db!.pool.query(
        `INSERT INTO rates (client_id, product_id, verification_unit_id, location_id, rate_type, amount)
         VALUES ($1, $2, $3, NULL, 'OGL', 250), ($1, $2, $3, $4, 'LOCAL', 100)`,
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
      const t = (detail.body.tasks as Array<{ areaId: number | null; rateType: string | null }>).find(
        (x) => x.areaId === loc,
      );
      expect(t?.rateType).toBe('LOCAL');
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
        `INSERT INTO rates (client_id, product_id, verification_unit_id, location_id, rate_type, amount)
         VALUES ($1, $2, $3, $4, 'OUTSTATION', 400)`,
        [ctx.clientId, ctx.productId, ctx.enabledUnitId, someLoc],
      );
      seeded(
        await request(app)
          .post(`/api/v2/cases/${caseId}/tasks`)
          .set(SA)
          .send({ tasks: [{ verificationUnitId: ctx.enabledUnitId, applicantId, address: ADDR }] }),
      );
      const detail = await request(app).get(`/api/v2/cases/${caseId}`).set(SA);
      const t = (detail.body.tasks as Array<{ rateType: string | null }>)[0];
      expect(t?.rateType).toBe('OUTSTATION');
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
        .send({ assignedTo: fa1, visitType: 'FIELD', distanceBand: 'LOCAL', billCount: 1, version: 1 });
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
        .send({ assignedTo: fa1, visitType: 'FIELD', distanceBand: 'LOCAL', billCount: 1, version: 1 });

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

    it('STATE (VALUE-kind, EXPAND): a field agent sees cases located anywhere in an assigned state', async () => {
      const { clientId, productId } = await seedCpv('STT');
      const loc = async (pincode: string, city: string, state: string): Promise<number> =>
        (
          await db!.pool.query<{ id: number }>(
            `INSERT INTO locations (pincode, area, city, state, country)
             VALUES ($1, 'Main', $2, $3, 'India') RETURNING id`,
            [pincode, city, state],
          )
        ).rows[0]!.id;
      const mh = await loc('416001', 'Kolhapur', 'Maharashtra');
      const ka = await loc('560002', 'Bengaluru', 'Karnataka');
      const mkCase = async (pincodeId: number, name: string): Promise<string> =>
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
              pincodeId,
            })
        ).body.id as string;
      const caseMh = await mkCase(mh, 'STATE MH');
      const caseKa = await mkCase(ka, 'STATE KA');
      const fa = await createUser({ username: 'fa_state', name: 'FA STATE', role: 'FIELD_AGENT' });
      // wire STATE to the field role (an admin Role-Management act) + assign the value via the API
      await db!.pool.query(
        `INSERT INTO role_scope_dimensions (role_code, dimension_code, mode)
         VALUES ('FIELD_AGENT', 'STATE', 'EXPAND') ON CONFLICT (role_code, dimension_code) DO NOTHING`,
      );
      invalidateRoleCache();
      try {
        await request(app)
          .post(`/api/v2/users/${fa}/scope-assignments`)
          .set(SA)
          .send({ dimension: 'STATE', entityValues: ['Maharashtra'] });
        const seen = await visibleIds(hdr('FIELD_AGENT', fa));
        expect(seen).toContain(caseMh);
        expect(seen).not.toContain(caseKa);
        expect((await request(app).get(`/api/v2/cases/${caseKa}`).set(hdr('FIELD_AGENT', fa))).status).toBe(
          404,
        );
      } finally {
        await db!.pool.query(
          `DELETE FROM role_scope_dimensions WHERE role_code = 'FIELD_AGENT' AND dimension_code = 'STATE'`,
        );
        invalidateRoleCache();
      }
    });

    it('CITY (VALUE-kind, RESTRICT): hierarchy ALL capped to assigned cities; location-less cases excluded', async () => {
      const { clientId, productId } = await seedCpv('CTY');
      const loc = async (pincode: string, city: string): Promise<number> =>
        (
          await db!.pool.query<{ id: number }>(
            `INSERT INTO locations (pincode, area, city, state, country)
             VALUES ($1, 'Main', $2, 'Maharashtra', 'India') RETURNING id`,
            [pincode, city],
          )
        ).rows[0]!.id;
      const mum = await loc('400003', 'Mumbai');
      const pun = await loc('411003', 'Pune');
      const mkCase = async (pincodeId: number | null, name: string): Promise<string> =>
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
              ...(pincodeId ? { pincodeId } : {}),
            })
        ).body.id as string;
      const caseMum = await mkCase(mum, 'CITY MUM');
      const casePun = await mkCase(pun, 'CITY PUN');
      const caseNoLoc = await mkCase(null, 'CITY NONE');
      const be = await createUser({ username: 'be_city', name: 'BE CITY', role: 'BACKEND_USER' });
      // Neutralize the default PRODUCT cap so this test isolates the CITY RESTRICT mechanic.
      await db!.pool.query(`UPDATE roles SET hierarchy_mode = 'ALL' WHERE code = 'BACKEND_USER'`);
      await db!.pool.query(
        `INSERT INTO role_scope_dimensions (role_code, dimension_code, mode)
         VALUES ('BACKEND_USER', 'CITY', 'RESTRICT') ON CONFLICT (role_code, dimension_code) DO NOTHING`,
      );
      await db!.pool.query(
        `UPDATE role_scope_dimensions SET mode = 'EXPAND' WHERE role_code = 'BACKEND_USER' AND dimension_code = 'PRODUCT'`,
      );
      invalidateRoleCache();
      try {
        await request(app)
          .post(`/api/v2/users/${be}/scope-assignments`)
          .set(SA)
          .send({ dimension: 'CITY', entityValues: ['Mumbai'] });
        const seen = await visibleIds(hdr('BACKEND_USER', be));
        expect(seen).toContain(caseMum);
        expect(seen).not.toContain(casePun);
        // a location-less case fails the city EXISTS leg → excluded under RESTRICT (fail-closed)
        expect(seen).not.toContain(caseNoLoc);
      } finally {
        await db!.pool.query(`UPDATE roles SET hierarchy_mode = 'SELF' WHERE code = 'BACKEND_USER'`);
        await db!.pool.query(
          `DELETE FROM role_scope_dimensions WHERE role_code = 'BACKEND_USER' AND dimension_code = 'CITY'`,
        );
        await db!.pool.query(
          `UPDATE role_scope_dimensions SET mode = 'RESTRICT' WHERE role_code = 'BACKEND_USER' AND dimension_code = 'PRODUCT'`,
        );
        invalidateRoleCache();
      }
    });

    it('VERIFICATION_TYPE (ID-kind, task-level EXISTS): visibility follows the case’s task units', async () => {
      // two cases, each carrying a task of a DIFFERENT unit
      const a = await seedCaseWithTask('VTA');
      const b = await seedCaseWithTask('VTB');
      const unitA = (
        await db!.pool.query<{ verificationUnitId: number }>(
          `SELECT verification_unit_id AS "verificationUnitId" FROM case_tasks WHERE id = $1`,
          [a.taskId],
        )
      ).rows[0]!.verificationUnitId;
      const be = await createUser({ username: 'be_vt', name: 'BE VT', role: 'BACKEND_USER' });
      // Neutralize the default PRODUCT cap so this test isolates the VERIFICATION_TYPE mechanic.
      await db!.pool.query(
        `INSERT INTO role_scope_dimensions (role_code, dimension_code, mode)
         VALUES ('BACKEND_USER', 'VERIFICATION_TYPE', 'EXPAND') ON CONFLICT (role_code, dimension_code) DO NOTHING`,
      );
      await db!.pool.query(
        `UPDATE role_scope_dimensions SET mode = 'EXPAND' WHERE role_code = 'BACKEND_USER' AND dimension_code = 'PRODUCT'`,
      );
      invalidateRoleCache();
      try {
        await request(app)
          .post(`/api/v2/users/${be}/scope-assignments`)
          .set(SA)
          .send({ dimension: 'VERIFICATION_TYPE', entityIds: [unitA] });
        const seen = await visibleIds(hdr('BACKEND_USER', be));
        expect(seen).toContain(a.caseId);
        expect(seen).not.toContain(b.caseId);
        expect(
          (await request(app).get(`/api/v2/cases/${b.caseId}`).set(hdr('BACKEND_USER', be))).status,
        ).toBe(404);
      } finally {
        await db!.pool.query(
          `DELETE FROM role_scope_dimensions WHERE role_code = 'BACKEND_USER' AND dimension_code = 'VERIFICATION_TYPE'`,
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
});
