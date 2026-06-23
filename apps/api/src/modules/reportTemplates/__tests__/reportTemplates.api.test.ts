import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER');

const valid = (over = {}) => ({
  code: 'FIELD_RESIDENCE_V1',
  name: 'Field Residence v1',
  templateType: 'FIELD_NARRATIVE',
  content: 'Report for {{applicantName}}',
  ...over,
});
const create = (over = {}) => request(app).post('/api/v2/report-templates').set(SA).send(valid(over));

describe.skipIf(!RUN)('report-templates API', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    // truncate audit_log too: integer ids restart at 1 each test, so audit rows would
    // otherwise collide on entity_id across tests (OCC audit assertions scope by entity_id).
    await db!.truncate('report_templates', 'audit_log');
  });

  it('creates a template (201) and lists it', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('FIELD_RESIDENCE_V1');
    expect(res.body.templateType).toBe('FIELD_NARRATIVE');
    expect(res.body.isActive).toBe(true);

    const list = await request(app).get('/api/v2/report-templates').set(SA);
    expect(list.status).toBe(200);
    // §4 pagination envelope (PAGINATION_AND_LOADING_STANDARDS).
    expect(list.body.items).toHaveLength(1);
    expect(list.body.totalCount).toBe(1);
    expect(list.body.page).toBe(1);
    expect(list.body.pageSize).toBe(25); // default
    expect(list.body.totalPages).toBe(1);
    expect(list.body.sort).toEqual({ sortBy: 'name', sortOrder: 'asc' });
  });

  // ── GET /:id (additive read, ADR-0051 D4) ──
  it('GET /:id returns the created template (200 + body) for a TEMPLATE_VIEW caller', async () => {
    const made = (await create()).body as { id: number };
    const res = await request(app).get(`/api/v2/report-templates/${made.id}`).set(SA);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(made.id);
    expect(res.body.code).toBe('FIELD_RESIDENCE_V1');
    expect(res.body.templateType).toBe('FIELD_NARRATIVE');
  });

  it('GET a non-existent id → 404 REPORT_TEMPLATE_NOT_FOUND', async () => {
    const res = await request(app).get('/api/v2/report-templates/999999').set(SA);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('REPORT_TEMPLATE_NOT_FOUND');
  });

  it('GET /:id without TEMPLATE_VIEW (BACKEND_USER) → 403', async () => {
    const made = (await create()).body as { id: number };
    const res = await request(app).get(`/api/v2/report-templates/${made.id}`).set(BE);
    expect(res.status).toBe(403);
  });

  it('rejects an unknown template type (400 VALIDATION)', async () => {
    const res = await create({ templateType: 'SOMETHING_ELSE' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION');
  });

  it('rejects a lowercase code (400 VALIDATION)', async () => {
    const res = await create({ code: 'lower_case' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION');
  });

  it('duplicate code → 409 REPORT_TEMPLATE_EXISTS', async () => {
    await create();
    const dup = await create({ name: 'Another' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('REPORT_TEMPLATE_EXISTS');
  });

  it('update changes name/type/content; code unchanged when omitted', async () => {
    const made = (await create()).body;
    expect(made.version).toBe(1);
    const upd = await request(app).put(`/api/v2/report-templates/${made.id}`).set(SA).send({
      name: 'Updated',
      templateType: 'KYC_DOCUMENT',
      content: 'new body',
      version: made.version,
    });
    expect(upd.status).toBe(200);
    expect(upd.body.code).toBe('FIELD_RESIDENCE_V1');
    expect(upd.body.name).toBe('UPDATED');
    expect(upd.body.templateType).toBe('KYC_DOCUMENT');
    expect(upd.body.content).toBe('new body');
    expect(upd.body.version).toBe(2); // OCC token bumped by exactly 1
  });

  it('filters the list by templateType and echoes the filter', async () => {
    await create({ code: 'A_FIELD', templateType: 'FIELD_NARRATIVE' });
    await create({ code: 'A_KYC', templateType: 'KYC_DOCUMENT' });
    const list = await request(app).get('/api/v2/report-templates?templateType=KYC_DOCUMENT').set(SA);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].code).toBe('A_KYC');
    expect(list.body.filters.templateType).toBe('KYC_DOCUMENT');
  });

  // ── ADR-0020: code correctable (report_templates has no v2 referrers → always editable) ──
  it('corrects the code on edit (no referrers in v2)', async () => {
    const made = (await create({ code: 'TYPO_TPL' })).body;
    const fix = await request(app).put(`/api/v2/report-templates/${made.id}`).set(SA).send({
      code: 'FIXED_TPL',
      name: made.name,
      templateType: made.templateType,
      content: 'x',
      version: made.version,
    });
    expect(fix.status).toBe(200);
    expect(fix.body.code).toBe('FIXED_TPL');
    expect(fix.body.version).toBe(2);
  });

  it('BACKEND_USER cannot read or write templates (403)', async () => {
    expect((await request(app).get('/api/v2/report-templates').set(BE)).status).toBe(403);
    expect((await request(app).post('/api/v2/report-templates').set(BE).send(valid())).status).toBe(403);
  });

  it('unauthenticated request is 401', async () => {
    expect((await request(app).get('/api/v2/report-templates')).status).toBe(401);
  });

  it('activate / deactivate toggles is_active (version-guarded, each bumps version)', async () => {
    const made = (await create()).body;
    const off = await request(app)
      .post(`/api/v2/report-templates/${made.id}/deactivate`)
      .set(SA)
      .send({ version: made.version });
    expect(off.body.isActive).toBe(false);
    expect(off.body.version).toBe(2);
    const on = await request(app)
      .post(`/api/v2/report-templates/${made.id}/activate`)
      .set(SA)
      .send({ version: off.body.version });
    expect(on.body.isActive).toBe(true);
    expect(on.body.version).toBe(3);
  });

  // ── OCC contract (ADR-0019 / CONCURRENCY_AND_EDITING_STANDARD §6) ──
  it('update without a version → 400 VERSION_REQUIRED', async () => {
    const made = (await create()).body;
    const res = await request(app)
      .put(`/api/v2/report-templates/${made.id}`)
      .set(SA)
      .send({ name: 'X', templateType: 'KYC_DOCUMENT', content: 'x' }); // no version
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VERSION_REQUIRED');
  });

  it('update a non-existent id with a version → 404 REPORT_TEMPLATE_NOT_FOUND', async () => {
    const res = await request(app)
      .put('/api/v2/report-templates/999999')
      .set(SA)
      .send({ name: 'X', templateType: 'KYC_DOCUMENT', content: 'x', version: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('REPORT_TEMPLATE_NOT_FOUND');
  });

  it('concurrent edit: second writer at a stale version → 409 STALE_UPDATE with current; re-read succeeds', async () => {
    const made = (await create()).body;
    // writer A saves first (v1 → v2)
    const a = await request(app)
      .put(`/api/v2/report-templates/${made.id}`)
      .set(SA)
      .send({ name: 'A-edit', templateType: 'KYC_DOCUMENT', content: 'a', version: 1 });
    expect(a.status).toBe(200);
    expect(a.body.version).toBe(2);
    // writer B still holds v1 → conflict
    const b = await request(app)
      .put(`/api/v2/report-templates/${made.id}`)
      .set(SA)
      .send({ name: 'B-edit', templateType: 'KYC_DOCUMENT', content: 'b', version: 1 });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('STALE_UPDATE');
    expect(b.body.current.version).toBe(2);
    expect(b.body.current.name).toBe('A-EDIT');
    // B reloads to v2 and re-applies → succeeds
    const b2 = await request(app)
      .put(`/api/v2/report-templates/${made.id}`)
      .set(SA)
      .send({ name: 'B-edit', templateType: 'KYC_DOCUMENT', content: 'b', version: b.body.current.version });
    expect(b2.status).toBe(200);
    expect(b2.body.version).toBe(3);
    expect(b2.body.name).toBe('B-EDIT');
  });

  it('every create/update appends exactly one immutable audit_log row (actor + action)', async () => {
    const made = (await create()).body;
    await request(app)
      .put(`/api/v2/report-templates/${made.id}`)
      .set(SA)
      .send({ name: 'Changed', templateType: 'KYC_DOCUMENT', content: 'x', version: made.version });
    const { rows } = await db!.pool.query(
      `SELECT action, version_after FROM audit_log
       WHERE entity_type = 'report_templates' AND entity_id = $1 ORDER BY id`,
      [String(made.id)],
    );
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
    expect(rows[1].version_after).toBe(2);
    // audit_log is append-only — a direct UPDATE is rejected at the DB
    await expect(
      db!.pool.query(`UPDATE audit_log SET action = 'X' WHERE entity_id = $1`, [String(made.id)]),
    ).rejects.toThrow();
  });

  // ── Pagination contract (PAGINATION_AND_LOADING_STANDARDS §1/§4) ──
  it('paginates: page/limit slice the result set and totals are correct', async () => {
    for (const code of ['PA', 'PB', 'PC']) {
      await create({ code, name: code });
    }
    const p1 = await request(app)
      .get('/api/v2/report-templates?limit=2&page=1&sortBy=name&sortOrder=asc')
      .set(SA);
    expect(p1.body.items.map((t: { code: string }) => t.code)).toEqual(['PA', 'PB']);
    expect(p1.body.totalCount).toBe(3);
    expect(p1.body.pageSize).toBe(2);
    expect(p1.body.totalPages).toBe(2);
    const p2 = await request(app)
      .get('/api/v2/report-templates?limit=2&page=2&sortBy=name&sortOrder=asc')
      .set(SA);
    expect(p2.body.items.map((t: { code: string }) => t.code)).toEqual(['PC']);
    expect(p2.body.page).toBe(2);
  });

  it('server sorting: sortBy=code desc orders by the whitelisted column', async () => {
    await create({ code: 'AAA' });
    await create({ code: 'ZZZ' });
    const res = await request(app).get('/api/v2/report-templates?sortBy=code&sortOrder=desc').set(SA);
    expect(res.body.items[0].code).toBe('ZZZ');
    expect(res.body.sort).toEqual({ sortBy: 'code', sortOrder: 'desc' });
  });

  it('global search filters by code/name and echoes the filter', async () => {
    await create({ code: 'KOTAK', name: 'Kotak Report' });
    await create({ code: 'YESB', name: 'Yes Report' });
    const res = await request(app).get('/api/v2/report-templates?search=kotak').set(SA);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].code).toBe('KOTAK');
    expect(res.body.filters.search).toBe('kotak');
  });

  // ── column filters (DATAGRID_STANDARD §6/§7) ──
  it('f_code (text) and f_templateType (enum) filter the list and echo', async () => {
    await create({ code: 'FN1', name: 'Field One', templateType: 'FIELD_NARRATIVE' });
    await create({ code: 'KD1', name: 'KYC One', templateType: 'KYC_DOCUMENT' });

    const byType = await request(app).get('/api/v2/report-templates?f_templateType=KYC_DOCUMENT').set(SA);
    expect(byType.body.items.map((t: { code: string }) => t.code)).toEqual(['KD1']);
    expect(byType.body.filters.f_templateType).toBe('KYC_DOCUMENT');

    const byCode = await request(app).get('/api/v2/report-templates?f_code=FN').set(SA);
    expect(byCode.body.items.map((t: { code: string }) => t.code)).toEqual(['FN1']);
  });

  it('rejects limit > 500 with 400 LIMIT_TOO_LARGE (gate 41)', async () => {
    const res = await request(app).get('/api/v2/report-templates?limit=501').set(SA);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LIMIT_TOO_LARGE');
  });

  it('unknown sortBy falls back to the default sort (no SQL injection surface)', async () => {
    await create({ code: 'SAFE' });
    const res = await request(app)
      .get('/api/v2/report-templates?sortBy=name;DROP TABLE report_templates')
      .set(SA);
    expect(res.status).toBe(200);
    expect(res.body.sort.sortBy).toBe('name'); // default, not the injection string
  });

  // ── B-13 DataGrid export (IMPORT_EXPORT_STANDARD) ──
  describe('export', () => {
    const FA = authHeaderForRole('FIELD_AGENT');

    it('exports the current view as CSV (200 + headers + rows)', async () => {
      await create({ code: 'FIELD_RESIDENCE_V1', name: 'Field Residence v1' });
      const res = await request(app).get('/api/v2/report-templates/export?format=csv&mode=current').set(SA);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(
        /attachment; filename="report-templates-\d{8}\.csv"/,
      );
      expect(res.text.split('\r\n')[0]).toBe('Code,Name,Type,Effective From,Created,Updated,Status');
      expect(res.text).toContain('FIELD_RESIDENCE_V1,FIELD RESIDENCE V1,FIELD_NARRATIVE');
    });

    it('exports all matching as XLSX (200 + PK-zip body)', async () => {
      await create({ code: 'AAA' });
      const res = await request(app)
        .get('/api/v2/report-templates/export?format=xlsx&mode=all')
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
      await create({ code: 'ZZZ', name: 'Zzz' });
      const res = await request(app)
        .get('/api/v2/report-templates/export?format=csv&mode=all&cols=code,templateType,status')
        .set(SA);
      expect(res.text.split('\r\n')[0]).toBe('Code,Type,Status');
    });

    it('mode=selected exports only the ticked ids (not the whole list)', async () => {
      const a = (await create({ code: 'SELA' })).body as { id: number };
      await create({ code: 'SELB' });
      const res = await request(app)
        .get(`/api/v2/report-templates/export?format=csv&mode=selected&ids=${a.id}`)
        .set(SA);
      expect(res.status).toBe(200);
      const rows = res.text.split('\r\n');
      expect(rows[0]).toBe('Code,Name,Type,Effective From,Created,Updated,Status');
      expect(res.text).toContain('SELA');
      expect(res.text).not.toContain('SELB'); // the unticked row is excluded
    });

    it('mode=selected with no ids exports nothing (never falls through to all)', async () => {
      await create({ code: 'NOIDS' });
      const res = await request(app).get('/api/v2/report-templates/export?format=csv&mode=selected').set(SA);
      expect(res.status).toBe(200);
      expect(res.text.split('\r\n')).toHaveLength(1); // header only, zero data rows
    });

    it('rejects an unknown format with 400', async () => {
      const res = await request(app).get('/api/v2/report-templates/export?format=pdf').set(SA);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_EXPORT_FORMAT');
    });

    it('a role without data.export cannot export (403)', async () => {
      expect((await request(app).get('/api/v2/report-templates/export').set(FA)).status).toBe(403);
    });

    it('unauthenticated export is 401', async () => {
      expect((await request(app).get('/api/v2/report-templates/export')).status).toBe(401);
    });

    it('a data.export-only role without page.templates cannot export templates (403) — export shares the list audience', async () => {
      // BACKEND_USER holds data.export but NOT page.templates (it is 403 on `GET /` above); the export
      // must not widen access beyond who can read the template list.
      expect((await request(app).get('/api/v2/report-templates/export?format=csv').set(BE)).status).toBe(403);
    });
  });

  // ── bulk activate/deactivate (per-row OCC, CONCURRENCY_AND_EDITING_STANDARD §1) ──
  describe('bulk', () => {
    const FA = authHeaderForRole('FIELD_AGENT');
    const mk = async (code: string) => (await create({ code })).body as { id: number; version: number };

    it('bulk-deactivate applies per-row and reports all OK', async () => {
      const a = await mk('BA');
      const b = await mk('BB');
      const res = await request(app)
        .post('/api/v2/report-templates/bulk-deactivate')
        .set(SA)
        .send({
          items: [
            { id: a.id, version: a.version },
            { id: b.id, version: b.version },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ okCount: 2, conflictCount: 0, notFoundCount: 0 });
      // verify via the active=false list (also covered per-row by GET /:id above)
      const inactive = (await request(app).get('/api/v2/report-templates?active=false&limit=100').set(SA))
        .body.items as { id: number; isActive: boolean }[];
      expect(inactive.some((t) => t.id === a.id && !t.isActive)).toBe(true);
    });

    it('mixed batch → per-row OK / CONFLICT (stale version) / NOT_FOUND, no silent overwrite', async () => {
      const ok = await mk('BOK');
      const stale = await mk('BSTALE');
      // bump `stale` so the version the batch carries is now behind
      await request(app)
        .post(`/api/v2/report-templates/${stale.id}/deactivate`)
        .set(SA)
        .send({ version: stale.version });
      const res = await request(app)
        .post('/api/v2/report-templates/bulk-deactivate')
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
        .post('/api/v2/report-templates/bulk-activate')
        .set(SA)
        .send({ items: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BULK_ITEMS_REQUIRED');
    });

    it('a role without template.manage cannot bulk-mutate (403); unauth is 401', async () => {
      expect(
        (await request(app).post('/api/v2/report-templates/bulk-deactivate').set(FA).send({ items: [] }))
          .status,
      ).toBe(403);
      expect(
        (await request(app).post('/api/v2/report-templates/bulk-deactivate').send({ items: [] })).status,
      ).toBe(401);
    });
  });
});
