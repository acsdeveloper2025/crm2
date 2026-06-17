import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, clientFactory, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER');

describe.skipIf(!RUN)('clients API', () => {
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
    await db!.truncate('clients', 'audit_log', 'import_log');
  });

  it('SUPER_ADMIN creates a client (201) and lists it', async () => {
    const created = await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send(clientFactory({ code: 'HDFC' }));
    expect(created.status).toBe(201);
    expect(created.body.code).toBe('HDFC');
    expect(created.body.isActive).toBe(true);

    const list = await request(app).get('/api/v2/clients').set(SA);
    expect(list.status).toBe(200);
    // §4 pagination envelope (PAGINATION_AND_LOADING_STANDARDS).
    expect(list.body.items).toHaveLength(1);
    expect(list.body.totalCount).toBe(1);
    expect(list.body.page).toBe(1);
    expect(list.body.pageSize).toBe(25); // default
    expect(list.body.totalPages).toBe(1);
    expect(list.body.sort).toEqual({ sortBy: 'name', sortOrder: 'asc' });
  });

  it('rejects an empty name with 400 VALIDATION', async () => {
    const res = await request(app).post('/api/v2/clients').set(SA).send({ code: 'HDFC', name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION');
  });

  it('BACKEND_USER cannot create (403) but can read', async () => {
    const create = await request(app).post('/api/v2/clients').set(BE).send(clientFactory());
    expect(create.status).toBe(403);
    const read = await request(app).get('/api/v2/clients').set(BE);
    expect(read.status).toBe(200);
  });

  it('unauthenticated request is 401', async () => {
    expect((await request(app).get('/api/v2/clients')).status).toBe(401);
  });

  it('duplicate code → 409', async () => {
    await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send(clientFactory({ code: 'ICICI' }));
    const dup = await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send(clientFactory({ code: 'ICICI' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('CLIENT_CODE_EXISTS');
  });

  it('update changes the name, code stays immutable', async () => {
    const created = (
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'AXIS' }))
    ).body;
    expect(created.version).toBe(1);
    const upd = await request(app)
      .put(`/api/v2/clients/${created.id}`)
      .set(SA)
      .send({ name: 'Axis v2', version: created.version });
    expect(upd.status).toBe(200);
    expect(upd.body.name).toBe('Axis v2');
    expect(upd.body.code).toBe('AXIS');
    expect(upd.body.version).toBe(2); // OCC token bumped by exactly 1
  });

  // ── ADR-0020: code correctable while unreferenced, locked once in use ──
  it('corrects a typo in the code while the client is UNREFERENCED', async () => {
    const c = (await request(app).post('/api/v2/clients').set(SA).send({ code: 'HDCF', name: 'HDFC Bank' }))
      .body;
    const fix = await request(app)
      .put(`/api/v2/clients/${c.id}`)
      .set(SA)
      .send({ code: 'HDFC', name: 'HDFC Bank', version: c.version });
    expect(fix.status).toBe(200);
    expect(fix.body.code).toBe('HDFC');
    expect(fix.body.version).toBe(2);
  });

  it('locks the code once the client is REFERENCED → 409 CODE_LOCKED (name still editable)', async () => {
    const c = (await request(app).post('/api/v2/clients').set(SA).send({ code: 'LOCKME', name: 'Lock Bank' }))
      .body;
    const p = (await request(app).post('/api/v2/products').set(SA).send({ code: 'P_LOCK', name: 'P' })).body;
    // reference it (a CPV link) → code is now in use
    await request(app).post('/api/v2/client-products').set(SA).send({ clientId: c.id, productId: p.id });

    const blocked = await request(app)
      .put(`/api/v2/clients/${c.id}`)
      .set(SA)
      .send({ code: 'NEWCODE', name: 'Lock Bank', version: c.version });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('CODE_LOCKED');

    // a name-only edit (code unchanged) still succeeds while referenced
    const nameOnly = await request(app)
      .put(`/api/v2/clients/${c.id}`)
      .set(SA)
      .send({ code: 'LOCKME', name: 'Lock Bank 2', version: c.version });
    expect(nameOnly.status).toBe(200);
    expect(nameOnly.body.name).toBe('Lock Bank 2');
  });

  it('activate / deactivate toggles is_active (version-guarded, each bumps version)', async () => {
    const created = (
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'SBI' }))
    ).body;
    const off = await request(app)
      .post(`/api/v2/clients/${created.id}/deactivate`)
      .set(SA)
      .send({ version: created.version });
    expect(off.body.isActive).toBe(false);
    expect(off.body.version).toBe(2);
    const on = await request(app)
      .post(`/api/v2/clients/${created.id}/activate`)
      .set(SA)
      .send({ version: off.body.version });
    expect(on.body.isActive).toBe(true);
    expect(on.body.version).toBe(3);
  });

  it('404 for unknown id', async () => {
    expect((await request(app).get('/api/v2/clients/999999').set(SA)).status).toBe(404);
  });

  // ── B-22 options endpoint (unpaginated USABLE feed for dropdowns) ──
  it('GET /options returns USABLE clients only as a flat {id,code,name} array (B-22)', async () => {
    await request(app).post('/api/v2/clients').set(SA).send({ code: 'NOWB', name: 'Now Bank' });
    const off = (await request(app).post('/api/v2/clients').set(SA).send({ code: 'OFFB', name: 'Off Bank' }))
      .body;
    await request(app).post(`/api/v2/clients/${off.id}/deactivate`).set(SA).send({ version: off.version });
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send({ code: 'FUTB', name: 'Future', effectiveFrom: future });

    const res = await request(app).get('/api/v2/clients/options').set(SA);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true); // flat array, NOT a pagination envelope
    const codes = res.body.map((o: { code: string }) => o.code);
    expect(codes).toContain('NOWB');
    expect(codes).not.toContain('OFFB'); // inactive excluded
    expect(codes).not.toContain('FUTB'); // future-dated excluded (ADR-0017)
    expect(Object.keys(res.body[0]).sort()).toEqual(['code', 'id', 'name']); // trimmed shape
  });

  it('GET /options requires auth (401); BACKEND_USER may read (200)', async () => {
    expect((await request(app).get('/api/v2/clients/options')).status).toBe(401);
    expect((await request(app).get('/api/v2/clients/options').set(BE)).status).toBe(200);
  });

  // ── B2: /options is scoped to the actor's CLIENT portfolio (commit 3b00776 part E) ──
  it('GET /options is scoped to the actor portfolio: a BACKEND_USER sees only assigned clients, SUPER_ADMIN sees all', async () => {
    // x-test-auth header for a SPECIFIC created user (so scopedEntityIds resolves THAT user's assignments)
    const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });
    const createUser = async (username: string): Promise<string> =>
      (
        await request(app)
          .post('/api/v2/users')
          .set(SA)
          .send({ username, name: username.toUpperCase(), role: 'BACKEND_USER' })
      ).body.id as string;
    const mk = async (code: string): Promise<number> =>
      (await request(app).post('/api/v2/clients').set(SA).send(clientFactory({ code }))).body.id as number;

    const a = await mk('PORTA');
    await mk('PORTB');
    await mk('PORTC');

    // BACKEND_USER holds CLIENT as an EXPAND dimension day-0 → an assignment narrows /options to it.
    const bePortfolio = await createUser('be_opts_c');
    await request(app)
      .post(`/api/v2/users/${bePortfolio}/scope-assignments`)
      .set(SA)
      .send({ dimension: 'CLIENT', entityIds: [a] });
    const beNone = await createUser('be_opts_none');

    // SUPER_ADMIN (no CLIENT wiring) sees the whole catalog
    const saCodes = (await request(app).get('/api/v2/clients/options').set(SA)).body
      .map((o: { code: string }) => o.code)
      .sort();
    expect(saCodes).toEqual(['PORTA', 'PORTB', 'PORTC']);

    // the portfolio user sees ONLY the assigned client
    const portfolioCodes = (
      await request(app).get('/api/v2/clients/options').set(hdr('BACKEND_USER', bePortfolio))
    ).body.map((o: { code: string }) => o.code);
    expect(portfolioCodes).toEqual(['PORTA']);

    // an UNASSIGNED BACKEND_USER falls through to the full catalog: CLIENT is an EXPAND dimension,
    // and EXPAND with no assignment adds no cap (only RESTRICT caps; the options feed has no
    // hierarchy leg). Pinned so a future change to this semantics is a conscious one.
    const noneCodes = (
      await request(app).get('/api/v2/clients/options').set(hdr('BACKEND_USER', beNone))
    ).body
      .map((o: { code: string }) => o.code)
      .sort();
    expect(noneCodes).toEqual(['PORTA', 'PORTB', 'PORTC']);
  });

  it('future-dated client is excluded from ?active=true but shown in the admin list (ADR-0017)', async () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const scheduled = await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send({ code: 'FUTURE', name: 'Future Bank', effectiveFrom: future });
    expect(scheduled.status).toBe(201);
    expect(new Date(scheduled.body.effectiveFrom).getTime()).toBeGreaterThan(Date.now());
    await request(app).post('/api/v2/clients').set(SA).send({ code: 'NOWBANK', name: 'Now Bank' });

    const usable = await request(app).get('/api/v2/clients?active=true').set(SA);
    const usableCodes = usable.body.items.map((c: { code: string }) => c.code);
    expect(usableCodes).toContain('NOWBANK');
    expect(usableCodes).not.toContain('FUTURE');

    const admin = await request(app).get('/api/v2/clients').set(SA);
    expect(admin.body.items.map((c: { code: string }) => c.code).sort()).toEqual(['FUTURE', 'NOWBANK']);
  });

  it('update can reschedule effectiveFrom into the future, hiding it from active reads (ADR-0017)', async () => {
    const c = (await request(app).post('/api/v2/clients').set(SA).send({ code: 'RESCH', name: 'Resched' }))
      .body;
    // created with default now() → usable
    expect(
      (await request(app).get('/api/v2/clients?active=true').set(SA)).body.items.some(
        (x: { id: number }) => x.id === c.id,
      ),
    ).toBe(true);
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const upd = await request(app)
      .put(`/api/v2/clients/${c.id}`)
      .set(SA)
      .send({ name: c.name, effectiveFrom: future, version: c.version });
    expect(upd.status).toBe(200);
    expect(new Date(upd.body.effectiveFrom).getTime()).toBeGreaterThan(Date.now());
    expect(
      (await request(app).get('/api/v2/clients?active=true').set(SA)).body.items.some(
        (x: { id: number }) => x.id === c.id,
      ),
    ).toBe(false);
  });

  // ── OCC contract (ADR-0019 / CONCURRENCY_AND_EDITING_STANDARD §6) ──
  it('update without a version → 400 VERSION_REQUIRED', async () => {
    const c = (
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'NEEDVER' }))
    ).body;
    const res = await request(app).put(`/api/v2/clients/${c.id}`).set(SA).send({ name: 'X' }); // no version
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VERSION_REQUIRED');
  });

  it('update a non-existent id with a version → 404 CLIENT_NOT_FOUND', async () => {
    const res = await request(app).put('/api/v2/clients/999999').set(SA).send({ name: 'X', version: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CLIENT_NOT_FOUND');
  });

  it('concurrent edit: second writer at a stale version → 409 STALE_UPDATE with current; re-read succeeds', async () => {
    const c = (
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'RACE' }))
    ).body;
    // writer A saves first (v1 → v2)
    const a = await request(app).put(`/api/v2/clients/${c.id}`).set(SA).send({ name: 'A-edit', version: 1 });
    expect(a.status).toBe(200);
    expect(a.body.version).toBe(2);
    // writer B still holds v1 → conflict
    const b = await request(app).put(`/api/v2/clients/${c.id}`).set(SA).send({ name: 'B-edit', version: 1 });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('STALE_UPDATE');
    expect(b.body.current.version).toBe(2);
    expect(b.body.current.name).toBe('A-edit');
    // B reloads to v2 and re-applies → succeeds
    const b2 = await request(app)
      .put(`/api/v2/clients/${c.id}`)
      .set(SA)
      .send({ name: 'B-edit', version: b.body.current.version });
    expect(b2.status).toBe(200);
    expect(b2.body.version).toBe(3);
    expect(b2.body.name).toBe('B-edit');
  });

  it('every create/update appends exactly one immutable audit_log row (actor + action)', async () => {
    const c = (
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'AUDITED' }))
    ).body;
    await request(app).put(`/api/v2/clients/${c.id}`).set(SA).send({ name: 'Changed', version: c.version });
    const { rows } = await db!.pool.query(
      `SELECT action, version_after FROM audit_log
       WHERE entity_type = 'clients' AND entity_id = $1 ORDER BY id`,
      [String(c.id)],
    );
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
    expect(rows[1].version_after).toBe(2);
    // audit_log is append-only — a direct UPDATE is rejected at the DB
    await expect(
      db!.pool.query(`UPDATE audit_log SET action = 'X' WHERE entity_id = $1`, [String(c.id)]),
    ).rejects.toThrow();
  });

  // ── Pagination contract (PAGINATION_AND_LOADING_STANDARDS §1/§4) ──
  it('paginates: page/limit slice the result set and totals are correct', async () => {
    for (const code of ['PA', 'PB', 'PC']) {
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code, name: code }));
    }
    const p1 = await request(app).get('/api/v2/clients?limit=2&page=1&sortBy=name&sortOrder=asc').set(SA);
    expect(p1.body.items.map((c: { code: string }) => c.code)).toEqual(['PA', 'PB']);
    expect(p1.body.totalCount).toBe(3);
    expect(p1.body.pageSize).toBe(2);
    expect(p1.body.totalPages).toBe(2);
    const p2 = await request(app).get('/api/v2/clients?limit=2&page=2&sortBy=name&sortOrder=asc').set(SA);
    expect(p2.body.items.map((c: { code: string }) => c.code)).toEqual(['PC']);
    expect(p2.body.page).toBe(2);
  });

  it('server sorting: sortBy=code desc orders by the whitelisted column', async () => {
    await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send(clientFactory({ code: 'AAA' }));
    await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send(clientFactory({ code: 'ZZZ' }));
    const res = await request(app).get('/api/v2/clients?sortBy=code&sortOrder=desc').set(SA);
    expect(res.body.items[0].code).toBe('ZZZ');
    expect(res.body.sort).toEqual({ sortBy: 'code', sortOrder: 'desc' });
  });

  it('global search filters by code/name and echoes the filter', async () => {
    await request(app).post('/api/v2/clients').set(SA).send({ code: 'KOTAK', name: 'Kotak Bank' });
    await request(app).post('/api/v2/clients').set(SA).send({ code: 'YESB', name: 'Yes Bank' });
    const res = await request(app).get('/api/v2/clients?search=kotak').set(SA);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].code).toBe('KOTAK');
    expect(res.body.filters.search).toBe('kotak');
  });

  // ── per-column filter (DATAGRID_STANDARD §6/§8) ──
  it('column filter f_code ILIKEs the code column and echoes f_code; combines with f_name (AND)', async () => {
    await request(app).post('/api/v2/clients').set(SA).send({ code: 'HDFC', name: 'HDFC Bank' });
    await request(app).post('/api/v2/clients').set(SA).send({ code: 'HDB', name: 'HDB Financial' });
    await request(app).post('/api/v2/clients').set(SA).send({ code: 'ICICI', name: 'ICICI Bank' });

    const byCode = await request(app).get('/api/v2/clients?f_code=hd').set(SA);
    expect(byCode.status).toBe(200);
    expect(byCode.body.items.map((c: { code: string }) => c.code).sort()).toEqual(['HDB', 'HDFC']);
    expect(byCode.body.filters.f_code).toBe('hd');

    // multi-column AND: code~hd AND name~bank → only HDFC Bank
    const combined = await request(app).get('/api/v2/clients?f_code=hd&f_name=bank').set(SA);
    expect(combined.body.items.map((c: { code: string }) => c.code)).toEqual(['HDFC']);
  });

  it('an unknown column filter (not in filterMap) is ignored — no effect, no injection', async () => {
    await request(app).post('/api/v2/clients').set(SA).send({ code: 'AAA', name: 'Aaa' });
    const res = await request(app).get('/api/v2/clients?f_secret=x&f_is_active=true%3BDROP').set(SA);
    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(1); // unwhitelisted filters dropped
  });

  it('date-range filter narrows the list to a created-between window (export honors it)', async () => {
    await request(app).post('/api/v2/clients').set(SA).send({ code: 'TODAY', name: 'Today Bank' });
    const today = new Date().toISOString().slice(0, 10);
    const past = '2020-01-01';
    // a window that includes today returns the row...
    const inWindow = await request(app)
      .get(`/api/v2/clients?f_createdAt_from=${past}&f_createdAt_to=${today}`)
      .set(SA);
    expect(inWindow.status).toBe(200);
    expect(inWindow.body.totalCount).toBe(1);
    expect(inWindow.body.filters.f_createdAt_from).toBe(past);
    // ...a window ending in the past excludes it (created_at = now()).
    const before = await request(app).get(`/api/v2/clients?f_createdAt_to=${past}`).set(SA);
    expect(before.body.totalCount).toBe(0);
    // and the same filter flows into the export (CSV has only the header row when out of window).
    const csv = await request(app)
      .get(`/api/v2/clients/export?format=csv&mode=all&f_createdAt_to=${past}`)
      .set(SA);
    expect(csv.status).toBe(200);
    expect(csv.text.split('\r\n')).toHaveLength(1); // header only, no data rows
  });

  it('rejects limit > 500 with 400 LIMIT_TOO_LARGE (gate 41)', async () => {
    const res = await request(app).get('/api/v2/clients?limit=501').set(SA);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LIMIT_TOO_LARGE');
  });

  it('unknown sortBy falls back to the default sort (no SQL injection surface)', async () => {
    await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send(clientFactory({ code: 'SAFE' }));
    const res = await request(app).get('/api/v2/clients?sortBy=name;DROP TABLE clients').set(SA);
    expect(res.status).toBe(200);
    expect(res.body.sort.sortBy).toBe('name'); // default, not the injection string
  });

  // ── B-13 DataGrid export (IMPORT_EXPORT_STANDARD) ──
  describe('export', () => {
    const FA = authHeaderForRole('FIELD_AGENT');

    it('exports the current view as CSV (200 + headers + escaped rows)', async () => {
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'HDFC', name: 'HDFC Bank' }));
      const res = await request(app).get('/api/v2/clients/export?format=csv&mode=current').set(SA);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="clients-\d{8}\.csv"/);
      expect(res.text.split('\r\n')[0]).toBe('Code,Name,Effective From,Created,Updated,Status');
      expect(res.text).toContain('HDFC,HDFC Bank');
    });

    it('exports all matching as XLSX (200 + PK-zip body), honoring the active filter', async () => {
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'AAA' }));
      const res = await request(app)
        .get('/api/v2/clients/export?format=xlsx&mode=all')
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
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'ZZZ', name: 'Zzz' }));
      const res = await request(app)
        .get('/api/v2/clients/export?format=csv&mode=all&cols=code,status')
        .set(SA);
      expect(res.text.split('\r\n')[0]).toBe('Code,Status');
    });

    it('mode=selected exports only the ticked ids (not the whole list)', async () => {
      const a = (
        await request(app)
          .post('/api/v2/clients')
          .set(SA)
          .send(clientFactory({ code: 'SELA' }))
      ).body as { id: number };
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'SELB' }));
      const res = await request(app)
        .get(`/api/v2/clients/export?format=csv&mode=selected&ids=${a.id}`)
        .set(SA);
      expect(res.status).toBe(200);
      const rows = res.text.split('\r\n');
      expect(rows[0]).toBe('Code,Name,Effective From,Created,Updated,Status');
      expect(res.text).toContain('SELA');
      expect(res.text).not.toContain('SELB'); // the unticked row is excluded
    });

    it('mode=selected with no ids exports nothing (never falls through to all)', async () => {
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'NOIDS' }));
      const res = await request(app).get('/api/v2/clients/export?format=csv&mode=selected').set(SA);
      expect(res.status).toBe(200);
      expect(res.text.split('\r\n')).toHaveLength(1); // header only, zero data rows
    });

    it('rejects an unknown format with 400', async () => {
      const res = await request(app).get('/api/v2/clients/export?format=pdf').set(SA);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_EXPORT_FORMAT');
    });

    it('a role without data.export cannot export (403)', async () => {
      expect((await request(app).get('/api/v2/clients/export').set(FA)).status).toBe(403);
    });

    it('unauthenticated export is 401', async () => {
      expect((await request(app).get('/api/v2/clients/export')).status).toBe(401);
    });

    it('BACKEND_USER (has data.export) can export (200)', async () => {
      expect((await request(app).get('/api/v2/clients/export?format=csv').set(BE)).status).toBe(200);
    });
  });

  // ── bulk activate/deactivate (per-row OCC, CONCURRENCY_AND_EDITING_STANDARD §1) ──
  describe('bulk', () => {
    const FA = authHeaderForRole('FIELD_AGENT');
    const mk = async (code: string) =>
      (await request(app).post('/api/v2/clients').set(SA).send(clientFactory({ code }))).body as {
        id: number;
        version: number;
      };

    it('bulk-deactivate applies per-row and reports all OK', async () => {
      const a = await mk('BA');
      const b = await mk('BB');
      const res = await request(app)
        .post('/api/v2/clients/bulk-deactivate')
        .set(SA)
        .send({
          items: [
            { id: a.id, version: a.version },
            { id: b.id, version: b.version },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ okCount: 2, conflictCount: 0, notFoundCount: 0 });
      expect((await request(app).get(`/api/v2/clients/${a.id}`).set(SA)).body.isActive).toBe(false);
    });

    it('mixed batch → per-row OK / CONFLICT (stale version) / NOT_FOUND, no silent overwrite', async () => {
      const ok = await mk('BOK');
      const stale = await mk('BSTALE');
      // bump `stale` so the version the batch carries is now behind
      await request(app)
        .post(`/api/v2/clients/${stale.id}/deactivate`)
        .set(SA)
        .send({ version: stale.version });
      const res = await request(app)
        .post('/api/v2/clients/bulk-deactivate')
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
      const res = await request(app).post('/api/v2/clients/bulk-activate').set(SA).send({ items: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BULK_ITEMS_REQUIRED');
    });

    it('a role without masterdata.manage cannot bulk-mutate (403); unauth is 401', async () => {
      expect(
        (await request(app).post('/api/v2/clients/bulk-deactivate').set(FA).send({ items: [] })).status,
      ).toBe(403);
      expect((await request(app).post('/api/v2/clients/bulk-deactivate').send({ items: [] })).status).toBe(
        401,
      );
    });
  });

  // ── B-14 universal import engine (IMPORT_EXPORT_STANDARD §5/§6/§7/§8) ──
  describe('import', () => {
    const FA = authHeaderForRole('FIELD_AGENT');
    const HEADER = ['Code', 'Name', 'Effective From'];

    // Build an .xlsx upload in-memory (header row + the given data rows).
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
        .post(`/api/v2/clients/import?mode=${mode}`)
        .set(auth)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'clients.xlsx')
        .send(buf);

    it('downloads an XLSX template (200 + PK body + filename)', async () => {
      const res = await request(app)
        .get('/api/v2/clients/import-template')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('clients-import-template.xlsx');
      expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
    });

    it('preview validates without writing (valid rows reported, nothing inserted)', async () => {
      const res = await upload(
        'preview',
        await mkXlsx([
          ['ACME', 'Acme Bank'],
          ['ZED', 'Zed Co'],
        ]),
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalRows: 2, validRows: 2, errorRows: 0 });
      expect(res.body.errors).toHaveLength(0);
      expect(res.body.sample[0]).toMatchObject({ Code: 'ACME', Name: 'Acme Bank' });
      // preview is read-only — the list is still empty
      expect((await request(app).get('/api/v2/clients').set(SA)).body.totalCount).toBe(0);
    });

    it('preview flags an invalid row (bad code) against the file column, keeps the valid one', async () => {
      const res = await upload(
        'preview',
        await mkXlsx([
          ['ok_code', 'lower'],
          ['GOOD', 'Good'],
        ]),
      );
      expect(res.body.validRows).toBe(1);
      expect(res.body.errorRows).toBe(1);
      expect(res.body.errors[0]).toMatchObject({ rowNumber: 2, column: 'Code' });
    });

    it('preview flags an in-file duplicate of the unique key (code)', async () => {
      const res = await upload(
        'preview',
        await mkXlsx([
          ['DUP', 'First'],
          ['DUP', 'Second'],
        ]),
      );
      expect(res.body.validRows).toBe(1);
      expect(res.body.errors.some((e: { message: string }) => /duplicate/i.test(e.message))).toBe(true);
    });

    it('confirm imports valid rows, writes the import_log audit record, and audits each create', async () => {
      const res = await upload(
        'confirm',
        await mkXlsx([
          ['ACME', 'Acme Bank'],
          ['ZED', 'Zed Co'],
        ]),
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalRows: 2, successRows: 2, failedRows: 0 });
      expect(typeof res.body.durationMs).toBe('number');
      // rows persisted
      expect((await request(app).get('/api/v2/clients').set(SA)).body.totalCount).toBe(2);
      // import_log batch record (§7)
      const log = await db!.pool.query(
        `SELECT resource, file_name, total_rows, success_rows, failed_rows FROM import_log`,
      );
      expect(log.rows).toHaveLength(1);
      expect(log.rows[0]).toMatchObject({
        resource: 'clients',
        file_name: 'clients.xlsx',
        total_rows: 2,
        success_rows: 2,
        failed_rows: 0,
      });
      // per-row CREATE audit (§7 row-level traceability via audit_log)
      const audit = await db!.pool.query(`SELECT count(*)::int AS n FROM audit_log WHERE action='CREATE'`);
      expect(audit.rows[0].n).toBe(2);
    });

    it('confirm: a row duplicating an existing code fails per-row without blocking the valid rows', async () => {
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'EXIST', name: 'Existing' }));
      const res = await upload(
        'confirm',
        await mkXlsx([
          ['NEWONE', 'New One'],
          ['EXIST', 'Dupe'],
        ]),
      );
      expect(res.body).toMatchObject({ totalRows: 2, successRows: 1, failedRows: 1 });
      expect(res.body.errors[0]).toMatchObject({ rowNumber: 3, column: '*' });
      expect((await request(app).get('/api/v2/clients').set(SA)).body.totalCount).toBe(2); // EXIST + NEWONE
    });

    it('accepts a CSV upload (format auto-detected; quoted comma field preserved)', async () => {
      const csv = 'Code,Name,Effective From\r\nCSVCO,"Csv, Bank",\r\nCSVZED,Zed Co,\r\n';
      const res = await upload('confirm', Buffer.from(csv, 'utf8'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalRows: 2, successRows: 2, failedRows: 0 });
      const list = await request(app).get('/api/v2/clients?search=Csv').set(SA);
      expect(list.body.items.some((c: { name: string }) => c.name === 'Csv, Bank')).toBe(true);
    });

    it('no file body → 400 NO_IMPORT_FILE', async () => {
      const res = await request(app)
        .post('/api/v2/clients/import?mode=preview')
        .set(SA)
        .set('content-type', 'application/octet-stream')
        .send(Buffer.alloc(0));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('NO_IMPORT_FILE');
    });

    it('unknown mode → 400 BAD_IMPORT_MODE', async () => {
      const res = await upload('preview', await mkXlsx([['X', 'X']]));
      expect(res.status).toBe(200); // sanity: preview is valid
      const bad = await request(app)
        .post('/api/v2/clients/import?mode=bogus')
        .set(SA)
        .set('content-type', 'application/octet-stream')
        .send(await mkXlsx([['X', 'X']]));
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe('BAD_IMPORT_MODE');
    });

    it('a file at/above the job threshold → 413 IMPORT_TOO_LARGE (no sync import)', async () => {
      const big = Array.from({ length: 10000 }, (_v, i) => [`R${i}`, 'n']);
      const res = await upload('preview', await mkXlsx(big));
      expect(res.status).toBe(413);
      expect(res.body.error).toBe('IMPORT_TOO_LARGE');
    }, 20000); // building a 10k-row xlsx in-memory is heavy; allow headroom under CI/load

    it('a role without masterdata.manage cannot import or get the template (403); unauth is 401', async () => {
      expect((await upload('preview', await mkXlsx([['X', 'X']]), FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/clients/import-template').set(FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/clients/import-template')).status).toBe(401);
    });
  });
});
