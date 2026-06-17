import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, verificationUnitFactory, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

/**
 * Integration: real Express app over an ephemeral Postgres (migrations + truncate).
 * Runs only when DATABASE_URL points at a throwaway test DB (CI provides it).
 */
const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER');

describe.skipIf(!RUN)('verification-units API', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    // truncate audit_log too: int PKs RESTART IDENTITY so entity_id reuses across tests.
    await db!.truncate('verification_units', 'audit_log', 'import_log');
  });

  it('SUPER_ADMIN creates a field unit (201) and lists it', async () => {
    const input = verificationUnitFactory({ code: 'RESIDENCE' });
    const created = await request(app).post('/api/v2/verification-units').set(SA).send(input);
    expect(created.status).toBe(201);
    expect(created.body.code).toBe('RESIDENCE');
    expect(created.body.version).toBe(1);

    const list = await request(app).get('/api/v2/verification-units').set(SA);
    expect(list.status).toBe(200);
    // §4 pagination envelope (PAGINATION_AND_LOADING_STANDARDS).
    expect(list.body.items).toHaveLength(1);
    expect(list.body.totalCount).toBe(1);
    expect(list.body.page).toBe(1);
    expect(list.body.pageSize).toBe(25); // default
    expect(list.body.totalPages).toBe(1);
    expect(list.body.sort).toEqual({ sortBy: 'sortOrder', sortOrder: 'asc' });
  });

  it('rejects an invalid field unit with 400 VALIDATION', async () => {
    const bad = verificationUnitFactory({ code: 'BAD_FIELD', requiredPhotos: 2 });
    const res = await request(app).post('/api/v2/verification-units').set(SA).send(bad);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION');
  });

  it('creates a KYC unit with the KYC profile', async () => {
    const res = await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ kind: 'KYC_DOCUMENT', code: 'PAN_CARD' }));
    expect(res.status).toBe(201);
    expect(res.body.billingProfile).toBe('CLIENT_INVOICE');
    expect(res.body.piiSensitive).toBe(true);
  });

  it('BACKEND_USER cannot create (403) but can read', async () => {
    const create = await request(app)
      .post('/api/v2/verification-units')
      .set(BE)
      .send(verificationUnitFactory());
    expect(create.status).toBe(403);
    const read = await request(app).get('/api/v2/verification-units').set(BE);
    expect(read.status).toBe(200);
  });

  it('unauthenticated request is 401', async () => {
    expect((await request(app).get('/api/v2/verification-units')).status).toBe(401);
  });

  it('duplicate code → 409', async () => {
    const input = verificationUnitFactory({ code: 'OFFICE' });
    await request(app).post('/api/v2/verification-units').set(SA).send(input);
    const dup = await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: 'OFFICE' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('UNIT_CODE_EXISTS');
  });

  it('update bumps version; code correctable while UNREFERENCED, locked once REFERENCED (ADR-0020)', async () => {
    const created = (
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'BUSINESS' }))
    ).body;
    const upd = await request(app)
      .put(`/api/v2/verification-units/${created.id}`)
      .set(SA)
      .send({ name: 'Business v2', version: created.version });
    expect(upd.status).toBe(200);
    expect(upd.body.name).toBe('Business v2');
    expect(upd.body.version).toBe(2);

    // code correctable while the unit is unreferenced
    const fix = await request(app)
      .put(`/api/v2/verification-units/${created.id}`)
      .set(SA)
      .send({ code: 'BUSINESS_V2', version: upd.body.version });
    expect(fix.status).toBe(200);
    expect(fix.body.code).toBe('BUSINESS_V2');
    expect(fix.body.version).toBe(3);

    // reference it via a CPV enablement → code locks
    const clientId = (await request(app).post('/api/v2/clients').set(SA).send({ code: 'C_VU', name: 'C' }))
      .body.id;
    const productId = (await request(app).post('/api/v2/products').set(SA).send({ code: 'P_VU', name: 'P' }))
      .body.id;
    const cpId = (await request(app).post('/api/v2/client-products').set(SA).send({ clientId, productId }))
      .body.id;
    await request(app)
      .post('/api/v2/cpv-units')
      .set(SA)
      .send({ clientProductId: cpId, verificationUnitId: created.id });

    const locked = await request(app)
      .put(`/api/v2/verification-units/${created.id}`)
      .set(SA)
      .send({ code: 'BUSINESS_V3', version: fix.body.version });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toBe('CODE_LOCKED');
  });

  it('activate / deactivate toggles is_active (version-guarded, each bumps version)', async () => {
    const created = (
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'NOC' }))
    ).body;
    const off = await request(app)
      .post(`/api/v2/verification-units/${created.id}/deactivate`)
      .set(SA)
      .send({ version: created.version });
    expect(off.body.isActive).toBe(false);
    expect(off.body.version).toBe(2);
    const on = await request(app)
      .post(`/api/v2/verification-units/${created.id}/activate`)
      .set(SA)
      .send({ version: off.body.version });
    expect(on.body.isActive).toBe(true);
    expect(on.body.version).toBe(3);
  });

  it('404 for unknown id', async () => {
    expect((await request(app).get('/api/v2/verification-units/999999').set(SA)).status).toBe(404);
  });

  // ── B-22 options endpoint (unpaginated USABLE feed for dropdowns) ──
  it('GET /options returns USABLE units only as a flat {id,code,name} array (B-22)', async () => {
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: 'OK_UNIT' }));
    const off = (
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'OFF_UNIT' }))
    ).body;
    await request(app)
      .post(`/api/v2/verification-units/${off.id}/deactivate`)
      .set(SA)
      .send({ version: off.version });
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send({ ...verificationUnitFactory({ code: 'FUT_UNIT' }), effectiveFrom: future });

    const res = await request(app).get('/api/v2/verification-units/options').set(SA);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true); // flat array, NOT a pagination envelope
    const codes = res.body.map((o: { code: string }) => o.code);
    expect(codes).toContain('OK_UNIT');
    expect(codes).not.toContain('OFF_UNIT'); // inactive excluded
    expect(codes).not.toContain('FUT_UNIT'); // future-dated excluded (ADR-0017)
    expect(Object.keys(res.body[0]).sort()).toEqual(['code', 'id', 'kind', 'name']); // trimmed shape + kind
  });

  it('GET /options requires auth (401); BACKEND_USER may read (200)', async () => {
    expect((await request(app).get('/api/v2/verification-units/options')).status).toBe(401);
    expect((await request(app).get('/api/v2/verification-units/options').set(BE)).status).toBe(200);
  });

  // ── Excel-style header multi-select on `kind` (DATAGRID_STANDARD §7) ──
  it('f_kind filters by the kind enum: single → eq, comma → IN; unknown values dropped', async () => {
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: 'FV1', kind: 'FIELD_VISIT' }));
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: 'KYC1', kind: 'KYC_DOCUMENT' }));

    const single = await request(app).get('/api/v2/verification-units?f_kind=KYC_DOCUMENT').set(SA);
    expect(single.body.items.map((u: { code: string }) => u.code)).toEqual(['KYC1']);
    expect(single.body.filters.f_kind).toBe('KYC_DOCUMENT');

    const multi = await request(app)
      .get('/api/v2/verification-units?f_kind=FIELD_VISIT,KYC_DOCUMENT')
      .set(SA);
    expect(multi.body.items.map((u: { code: string }) => u.code).sort()).toEqual(['FV1', 'KYC1']);

    // an out-of-enum value is dropped (whitelist) → here leaves only the valid one (eq)
    const mixed = await request(app).get('/api/v2/verification-units?f_kind=FIELD_VISIT,HACKER').set(SA);
    expect(mixed.body.items.map((u: { code: string }) => u.code)).toEqual(['FV1']);
  });

  // ── OCC contract (ADR-0019) — enforcing the pre-existing version counter ──
  it('update without a version → 400 VERSION_REQUIRED', async () => {
    const created = (
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'NEEDVER' }))
    ).body;
    const res = await request(app)
      .put(`/api/v2/verification-units/${created.id}`)
      .set(SA)
      .send({ name: 'X' }); // no version
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VERSION_REQUIRED');
  });

  it('update a non-existent id with a version → 404 UNIT_NOT_FOUND', async () => {
    const res = await request(app)
      .put('/api/v2/verification-units/999999')
      .set(SA)
      .send({ name: 'X', version: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('UNIT_NOT_FOUND');
  });

  it('concurrent edit at a stale version → 409 STALE_UPDATE with current; re-read succeeds', async () => {
    const u = (
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'RACE' }))
    ).body;
    const a = await request(app)
      .put(`/api/v2/verification-units/${u.id}`)
      .set(SA)
      .send({ name: 'A-edit', version: 1 });
    expect(a.status).toBe(200);
    expect(a.body.version).toBe(2);
    const b = await request(app)
      .put(`/api/v2/verification-units/${u.id}`)
      .set(SA)
      .send({ name: 'B-edit', version: 1 });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('STALE_UPDATE');
    expect(b.body.current.version).toBe(2);
    expect(b.body.current.name).toBe('A-edit');
    const b2 = await request(app)
      .put(`/api/v2/verification-units/${u.id}`)
      .set(SA)
      .send({ name: 'B-edit', version: b.body.current.version });
    expect(b2.status).toBe(200);
    expect(b2.body.version).toBe(3);
  });

  it('every create/update appends exactly one immutable audit_log row', async () => {
    const u = (
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'AUDITVU' }))
    ).body;
    await request(app)
      .put(`/api/v2/verification-units/${u.id}`)
      .set(SA)
      .send({ name: 'Changed', version: u.version });
    const { rows } = await db!.pool.query(
      `SELECT action, version_after FROM audit_log
       WHERE entity_type = 'verification_units' AND entity_id = $1 ORDER BY id`,
      [String(u.id)],
    );
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
    expect(rows[1].version_after).toBe(2);
    await expect(
      db!.pool.query(`UPDATE audit_log SET action = 'X' WHERE entity_id = $1`, [String(u.id)]),
    ).rejects.toThrow();
  });

  // ── Pagination contract (PAGINATION_AND_LOADING_STANDARDS §1/§4) ──
  it('paginates: page/limit slice the result set and totals are correct', async () => {
    for (const code of ['PA', 'PB', 'PC']) {
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code, name: code }));
    }
    const p1 = await request(app)
      .get('/api/v2/verification-units?limit=2&page=1&sortBy=code&sortOrder=asc')
      .set(SA);
    expect(p1.body.items.map((u: { code: string }) => u.code)).toEqual(['PA', 'PB']);
    expect(p1.body.totalCount).toBe(3);
    expect(p1.body.pageSize).toBe(2);
    expect(p1.body.totalPages).toBe(2);
    const p2 = await request(app)
      .get('/api/v2/verification-units?limit=2&page=2&sortBy=code&sortOrder=asc')
      .set(SA);
    expect(p2.body.items.map((u: { code: string }) => u.code)).toEqual(['PC']);
    expect(p2.body.page).toBe(2);
  });

  it('server sorting: sortBy=code desc orders by the whitelisted column', async () => {
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: 'AAA' }));
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: 'ZZZ' }));
    const res = await request(app).get('/api/v2/verification-units?sortBy=code&sortOrder=desc').set(SA);
    expect(res.body.items[0].code).toBe('ZZZ');
    expect(res.body.sort).toEqual({ sortBy: 'code', sortOrder: 'desc' });
  });

  it('global search filters by code/name and echoes the filter', async () => {
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: 'KOTAK_VU', name: 'Kotak Unit' }));
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: 'YESB_VU', name: 'Yes Unit' }));
    const res = await request(app).get('/api/v2/verification-units?search=kotak').set(SA);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].code).toBe('KOTAK_VU');
    expect(res.body.filters.search).toBe('kotak');
  });

  it('rejects limit > 500 with 400 LIMIT_TOO_LARGE (gate 41)', async () => {
    const res = await request(app).get('/api/v2/verification-units?limit=501').set(SA);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LIMIT_TOO_LARGE');
  });

  it('unknown sortBy falls back to the default sort (no SQL injection surface)', async () => {
    await request(app)
      .post('/api/v2/verification-units')
      .set(SA)
      .send(verificationUnitFactory({ code: 'SAFE' }));
    const res = await request(app)
      .get('/api/v2/verification-units?sortBy=name;DROP TABLE verification_units')
      .set(SA);
    expect(res.status).toBe(200);
    expect(res.body.sort.sortBy).toBe('sortOrder'); // default, not the injection string
  });

  // ── B-13 DataGrid export (IMPORT_EXPORT_STANDARD) ──
  describe('export', () => {
    const FA = authHeaderForRole('FIELD_AGENT');

    it('exports the current view as CSV (200 + headers + escaped rows)', async () => {
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'RESIDENCE', name: 'Residence' }));
      const res = await request(app).get('/api/v2/verification-units/export?format=csv&mode=current').set(SA);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(
        /attachment; filename="verification-units-\d{8}\.csv"/,
      );
      expect(res.text.split('\r\n')[0]).toBe(
        'Code,Name,Category,Kind,Billing,Effective From,Created,Updated,Status',
      );
      expect(res.text).toContain('RESIDENCE,Residence');
    });

    it('exports all matching as XLSX (200 + PK-zip body)', async () => {
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'AAA' }));
      const res = await request(app)
        .get('/api/v2/verification-units/export?format=xlsx&mode=all')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
    });

    it('respects the visible columns (cols) selection', async () => {
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'ZZZ', name: 'Zzz' }));
      const res = await request(app)
        .get('/api/v2/verification-units/export?format=csv&mode=all&cols=code,status')
        .set(SA);
      expect(res.text.split('\r\n')[0]).toBe('Code,Status');
    });

    it('mode=selected exports only the ticked ids (not the whole list)', async () => {
      const a = (
        await request(app)
          .post('/api/v2/verification-units')
          .set(SA)
          .send(verificationUnitFactory({ code: 'SELA', name: 'Sel A' }))
      ).body as { id: number };
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'SELB', name: 'Sel B' }));
      const res = await request(app)
        .get(`/api/v2/verification-units/export?format=csv&mode=selected&ids=${a.id}`)
        .set(SA);
      expect(res.status).toBe(200);
      const rows = res.text.split('\r\n');
      expect(rows[0]).toBe('Code,Name,Category,Kind,Billing,Effective From,Created,Updated,Status');
      expect(res.text).toContain('SELA');
      expect(res.text).not.toContain('SELB'); // the unticked row is excluded
    });

    it('mode=selected with no ids exports nothing (never falls through to all)', async () => {
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'NOIDS' }));
      const res = await request(app)
        .get('/api/v2/verification-units/export?format=csv&mode=selected')
        .set(SA);
      expect(res.status).toBe(200);
      expect(res.text.split('\r\n')).toHaveLength(1); // header only, zero data rows
    });

    it('rejects an unknown format with 400', async () => {
      const res = await request(app).get('/api/v2/verification-units/export?format=pdf').set(SA);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_EXPORT_FORMAT');
    });

    it('a role without data.export cannot export (403)', async () => {
      expect((await request(app).get('/api/v2/verification-units/export').set(FA)).status).toBe(403);
    });

    it('unauthenticated export is 401', async () => {
      expect((await request(app).get('/api/v2/verification-units/export')).status).toBe(401);
    });

    it('BACKEND_USER (has data.export) can export (200)', async () => {
      expect((await request(app).get('/api/v2/verification-units/export?format=csv').set(BE)).status).toBe(
        200,
      );
    });
  });

  // ── bulk activate/deactivate (per-row OCC, CONCURRENCY_AND_EDITING_STANDARD §1) ──
  describe('bulk', () => {
    const FA = authHeaderForRole('FIELD_AGENT');
    const mk = async (code: string) =>
      (await request(app).post('/api/v2/verification-units').set(SA).send(verificationUnitFactory({ code })))
        .body as { id: number; version: number };

    it('bulk-deactivate applies per-row and reports all OK', async () => {
      const a = await mk('BULKA');
      const b = await mk('BULKB');
      const res = await request(app)
        .post('/api/v2/verification-units/bulk-deactivate')
        .set(SA)
        .send({
          items: [
            { id: a.id, version: a.version },
            { id: b.id, version: b.version },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ okCount: 2, conflictCount: 0, notFoundCount: 0 });
      expect((await request(app).get(`/api/v2/verification-units/${a.id}`).set(SA)).body.isActive).toBe(
        false,
      );
    });

    it('mixed batch → per-row OK / CONFLICT (stale version) / NOT_FOUND, no silent overwrite', async () => {
      const ok = await mk('BULKOK');
      const stale = await mk('BULKSTALE');
      // bump `stale` so the version the batch carries is now behind
      await request(app)
        .post(`/api/v2/verification-units/${stale.id}/deactivate`)
        .set(SA)
        .send({ version: stale.version });
      const res = await request(app)
        .post('/api/v2/verification-units/bulk-deactivate')
        .set(SA)
        .send({
          items: [
            { id: ok.id, version: ok.version },
            { id: stale.id, version: stale.version }, // stale → CONFLICT
            { id: 999999, version: 1 }, // missing → NOT_FOUND
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ okCount: 1, conflictCount: 1, notFoundCount: 1 });
      const byId = Object.fromEntries(
        (res.body.results as { id: string; status: string }[]).map((r) => [r.id, r.status]),
      );
      expect(byId[String(ok.id)]).toBe('OK');
      expect(byId[String(stale.id)]).toBe('CONFLICT');
      expect(byId['999999']).toBe('NOT_FOUND');
    });

    it('empty items → 400 BULK_ITEMS_REQUIRED', async () => {
      const res = await request(app)
        .post('/api/v2/verification-units/bulk-activate')
        .set(SA)
        .send({ items: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BULK_ITEMS_REQUIRED');
    });

    it('a role without verification_unit.manage cannot bulk-mutate (403); unauth is 401', async () => {
      expect(
        (await request(app).post('/api/v2/verification-units/bulk-deactivate').set(FA).send({ items: [] }))
          .status,
      ).toBe(403);
      expect(
        (await request(app).post('/api/v2/verification-units/bulk-deactivate').send({ items: [] })).status,
      ).toBe(401);
    });
  });

  // ── B-14 universal import engine (IMPORT_EXPORT_STANDARD §5/§6/§7/§8) ──
  describe('import', () => {
    const FA = authHeaderForRole('FIELD_AGENT');
    // Header order MUST match VU_IMPORT_COLUMNS in service.ts.
    const HEADER = [
      'Code',
      'Name',
      'Description',
      'Category',
      'Kind',
      'Worker Role',
      'Assignment Method',
      'Required Form Code',
      'Required Photos',
      'Required GPS',
      'Result Set',
      'Review Required',
      'Billing Profile',
      'Commission Profile',
      'Report Template Type',
      'Reverification Rule',
      'PII Sensitive',
      'Sort Order',
      'Effective From',
    ];
    // A valid FIELD_VISIT row that passes applyInvariants (mirrors the seeded RESIDENCE unit).
    const validRow = (code: string): (string | number)[] => [
      code,
      'Residence Verification',
      'Physical residence verification',
      'FIELD',
      'FIELD_VISIT',
      'FIELD_AGENT',
      'TERRITORY_AUTO',
      `${code}_FORM`,
      5,
      'true',
      'Positive,Negative,Refer,Fraud',
      'true',
      'AGENT_COMMISSION',
      'FIELD_RATE',
      'FIELD_NARRATIVE',
      'REVISIT_PARENT_RATE',
      'false',
      1,
      '2026-01-01',
    ];
    // Same shape but a bad `kind` enum → zod rejects against the Kind column.
    const badKindRow = (code: string): (string | number)[] => {
      const r = validRow(code);
      r[4] = 'NOT_A_KIND';
      return r;
    };

    const mkXlsx = async (rows: (string | number)[][]): Promise<Buffer> => {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');
      ws.addRow(HEADER);
      for (const r of rows) ws.addRow(r);
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const upload = (mode: 'preview' | 'confirm', buf: Buffer, auth = SA) =>
      request(app)
        .post(`/api/v2/verification-units/import?mode=${mode}`)
        .set(auth)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'verification-units.xlsx')
        .send(buf);

    it('downloads an XLSX template (200 + PK body + filename)', async () => {
      const res = await request(app)
        .get('/api/v2/verification-units/import-template')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('verification-units-import-template.xlsx');
      expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
    });

    it('preview flags an invalid row (bad kind) against its column, keeps the valid one', async () => {
      const res = await upload('preview', await mkXlsx([validRow('RESIDENCE'), badKindRow('OFFICE')]));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalRows: 2, validRows: 1, errorRows: 1 });
      expect(res.body.errors[0]).toMatchObject({ rowNumber: 3, column: 'Kind' });
      // preview is read-only — nothing inserted
      expect((await request(app).get('/api/v2/verification-units').set(SA)).body.totalCount).toBe(0);
    });

    it('confirm imports the valid row, grows the list, writes the import_log audit record', async () => {
      const res = await upload('confirm', await mkXlsx([validRow('RESIDENCE')]));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalRows: 1, successRows: 1, failedRows: 0 });
      expect((await request(app).get('/api/v2/verification-units').set(SA)).body.totalCount).toBe(1);
      const log = await db!.pool.query(
        `SELECT resource, file_name, total_rows, success_rows, failed_rows FROM import_log`,
      );
      expect(log.rows).toHaveLength(1);
      expect(log.rows[0]).toMatchObject({
        resource: 'verification-units',
        total_rows: 1,
        success_rows: 1,
        failed_rows: 0,
      });
    });

    it('a role without verification_unit.manage cannot import (403); unauth is 401', async () => {
      const buf = await mkXlsx([validRow('RESIDENCE')]);
      expect((await upload('confirm', buf, FA)).status).toBe(403);
      expect(
        (
          await request(app)
            .post('/api/v2/verification-units/import?mode=confirm')
            .set('content-type', 'application/octet-stream')
            .send(buf)
        ).status,
      ).toBe(401);
    });
  });
});
