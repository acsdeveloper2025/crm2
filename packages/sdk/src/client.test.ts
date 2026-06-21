import { describe, it, expect } from 'vitest';
import { createSdk, SdkError } from './client.js';

/** A fake fetch that records the last request and returns a canned response. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('createSdk — transport', () => {
  it('GET builds a versioned URL with query params and no body', async () => {
    const { impl, calls } = fakeFetch(200, []);
    const sdk = createSdk({ baseUrl: 'http://x', fetchImpl: impl });
    await sdk.clients.list({ page: 2, limit: 50, search: 'hdfc', sortBy: 'name', filters: { active: true } });
    expect(calls[0]?.url).toBe('http://x/api/v2/clients?page=2&limit=50&search=hdfc&sortBy=name&active=true');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it('POST sends a JSON body and attaches the auth token', async () => {
    const { impl, calls } = fakeFetch(201, { id: 1 });
    const sdk = createSdk({ baseUrl: 'http://x', fetchImpl: impl, getAuthToken: () => 'Bearer t' });
    const res = await sdk.products.create({ code: 'HOME_LOAN', name: 'Home Loan' });
    expect(res).toEqual({ id: 1 });
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ code: 'HOME_LOAN', name: 'Home Loan' });
    expect((calls[0]?.init.headers as Record<string, string>)['authorization']).toBe('Bearer t');
  });

  it('non-2xx throws SdkError carrying status + error code', async () => {
    const { impl } = fakeFetch(409, { error: 'RATE_EXISTS' });
    const sdk = createSdk({ baseUrl: 'http://x', fetchImpl: impl });
    await expect(
      sdk.rates.create({ clientId: 1, productId: 2, verificationUnitId: 3, amount: 50 }),
    ).rejects.toMatchObject({ status: 409, code: 'RATE_EXISTS' });
  });

  it('SdkError exposes status, code and payload', () => {
    const e = new SdkError(404, 'NOT_FOUND', { detail: 'x' });
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(404);
    expect(e.code).toBe('NOT_FOUND');
    expect(e.payload).toEqual({ detail: 'x' });
  });

  it('covers the remaining resource verbs (locations + cpv + verification units)', async () => {
    const { impl, calls } = fakeFetch(200, { ok: true });
    const sdk = createSdk({ baseUrl: 'http://x', fetchImpl: impl });
    await sdk.locations.update(7, { area: 'A', city: 'C', state: 'S', country: 'India', version: 1 });
    await sdk.cpvUnits.list({ clientProductId: 5, active: true });
    await sdk.verificationUnits.deactivate(9, 1);
    await sdk.clientProducts.activate(3, 1);
    expect(calls[0]?.url).toBe('http://x/api/v2/locations/7');
    expect(calls[1]?.url).toBe('http://x/api/v2/cpv-units?clientProductId=5&active=true');
    expect(calls[2]?.url).toBe('http://x/api/v2/verification-units/9/deactivate');
    expect(calls[3]?.url).toBe('http://x/api/v2/client-products/3/activate');
  });

  it('dedupeSearch builds the identifier query; dedupeSearchExport returns a blob carrying the identifiers', async () => {
    const { impl, calls } = fakeFetch(200, {
      items: [],
      totalCount: 0,
      page: 2,
      pageSize: 50,
      totalPages: 0,
      sort: { sortBy: 'createdAt', sortOrder: 'asc' },
      filters: {},
    });
    const sdk = createSdk({ baseUrl: 'http://x', fetchImpl: impl });
    await sdk.cases.dedupeSearch({
      name: 'ravi',
      pan: 'ABCDE1234F',
      mobile: '90000',
      company: 'acme',
      page: 2,
      limit: 50,
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });
    const url = calls[0]?.url ?? '';
    expect(url).toContain('/api/v2/cases/dedupe-search?');
    expect(url).toContain('name=ravi');
    expect(url).toContain('company=acme');
    expect(url).toContain('page=2');
    expect(url).toContain('sortBy=createdAt');

    // export goes through the blob transport (Content-Disposition filename + identifiers in the query)
    const bcalls: { url: string }[] = [];
    const bimpl = (async (u: string) => {
      bcalls.push({ url: u });
      return {
        ok: true,
        status: 200,
        headers: {
          get: (h: string) =>
            h === 'content-disposition' ? 'attachment; filename="dedupe-20260612.csv"' : null,
        },
        blob: async () => new Blob(['Case,Applicant\n']),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const sdk2 = createSdk({ baseUrl: 'http://x', fetchImpl: bimpl });
    const out = await sdk2.cases.dedupeSearchExport(
      { pan: 'ABCDE1234F', company: 'acme' },
      { format: 'csv', mode: 'all' },
    );
    expect(out.filename).toBe('dedupe-20260612.csv');
    const burl = bcalls[0]?.url ?? '';
    expect(burl).toContain('/api/v2/cases/dedupe-search/export?');
    expect(burl).toContain('format=csv');
    expect(burl).toContain('pan=ABCDE1234F');
    expect(burl).toContain('company=acme');
  });

  it('exercises every SDK method (the web+mobile contract surface)', async () => {
    const { impl, calls } = fakeFetch(200, {});
    const s = createSdk({ baseUrl: 'http://x', fetchImpl: impl });
    const vu = {
      code: 'C',
      name: 'N',
      category: 'F',
      kind: 'FIELD_VISIT',
      workerRole: 'FIELD_AGENT',
      assignmentMethod: 'TERRITORY_AUTO',
      requiredFormCode: 'F',
      requiredPhotos: 5,
      requiredGps: true,
      requiredAttachments: [],
      billingProfile: 'AGENT_COMMISSION',
      commissionProfile: 'FIELD_RATE',
      reportTemplateType: 'FIELD_NARRATIVE',
      reverificationRule: 'REVISIT_PARENT_RATE',
    } as never;
    await Promise.all([
      s.verificationUnits.list(),
      s.verificationUnits.get(1),
      s.verificationUnits.create(vu),
      s.verificationUnits.update(1, vu),
      s.verificationUnits.activate(1, 1),
      s.clients.list(),
      s.clients.get(1),
      s.clients.create({ code: 'C', name: 'N' }),
      s.clients.update(1, { name: 'N', version: 1 }),
      s.clients.activate(1, 1),
      s.clients.deactivate(1, 1),
      s.products.list(),
      s.products.get(1),
      s.products.create({ code: 'P', name: 'N' }),
      s.products.update(1, { name: 'N', version: 1 }),
      s.products.activate(1, 1),
      s.products.deactivate(1, 1),
      s.clientProducts.list(),
      s.clientProducts.create({ clientId: 1, productId: 2 }),
      s.clientProducts.update(1, { effectiveFrom: '2026-01-01T00:00:00.000Z', version: 1 }),
      s.clientProducts.deactivate(1, 1),
      s.cpvUnits.create({ clientProductId: 1, verificationUnitId: 2 }),
      s.cpvUnits.update(1, { effectiveFrom: '2026-01-01T00:00:00.000Z', version: 1 }),
      s.cpvUnits.activate(1, 1),
      s.cpvUnits.deactivate(1, 1),
      s.rates.list(),
      s.rates.update(1, { amount: 9, version: 1 }),
      s.rates.revise(1, { amount: 12, version: 1 }),
      s.rates.history(1),
      s.rates.activate(1, 1),
      s.rates.deactivate(1, 1),
      s.commissionRates.list(),
      s.commissionRates.create({
        userId: '00000000-0000-0000-0000-000000000001',
        clientId: 1,
        productId: 2,
        verificationUnitId: 3,
        locationId: 4,
        fieldRateType: 'LOCAL',
        tatBand: 24,
        amount: 50,
      }),
      s.commissionRates.revise(1, { amount: 75, version: 1 }),
      s.commissionRates.activate(1, 1),
      s.commissionRates.deactivate(1, 1),
      s.tatPolicies.list(),
      s.tatPolicies.create({ tatHours: 4, label: '4 hours' }),
      s.tatPolicies.revise(1, { label: '4 hrs', version: 1 }),
      s.tatPolicies.activate(1, 1),
      s.tatPolicies.deactivate(1, 1),
      s.reportLayouts.list(),
      s.reportLayouts.get(1),
      s.reportLayouts.byConfig(1, 2, 'MIS'),
      s.reportLayouts.create({
        clientId: 1,
        productId: 2,
        kind: 'MIS',
        name: 'L',
        columns: [
          {
            columnKey: 'case_no',
            headerLabel: 'Case',
            sourceType: 'CASE_FIELD',
            sourceRef: 'case_number',
            dataType: 'TEXT',
          },
        ],
      }),
      s.reportLayouts.update(1, { name: 'L2', version: 1 }),
      s.reportLayouts.activate(1, 1),
      s.reportLayouts.deactivate(1, 1),
      s.dataEntry.get('00000000-0000-0000-0000-0000000000aa'),
      s.dataEntry.save('00000000-0000-0000-0000-0000000000aa', { data: { x: 1 }, version: 1 }),
      s.dataEntry.getPickup('00000000-0000-0000-0000-0000000000aa'),
      s.dataEntry.savePickup('00000000-0000-0000-0000-0000000000aa', { pickupTrigger: 'x', version: 1 }),
      s.billing.cases({ filters: { clientId: 1 } }),
      s.billing.caseTasks('00000000-0000-0000-0000-0000000000aa'),
      s.billing.breakdown(),
      s.rateTypes.list(),
      s.locations.list(),
      s.locations.pincodes('400'),
      s.locations.create({ pincode: '400001', area: 'A', city: 'C', state: 'S' }),
      s.locations.createBatch({ pincode: '400001', city: 'C', state: 'S', areas: ['A', 'B'] }),
      s.locations.update(1, { area: 'A', city: 'C', state: 'S', country: 'India', version: 1 }),
      s.locations.activate(1, 1),
      s.locations.deactivate(1, 1),
      s.users.list({ search: 'jane', filters: { role: 'FIELD_AGENT', active: true } }),
      s.users.create({ username: 'jane_doe', name: 'Jane', role: 'FIELD_AGENT' }),
      s.users.update('00000000-0000-0000-0000-000000000001', { name: 'Jane', role: 'MANAGER', version: 1 }),
      s.users.activate('00000000-0000-0000-0000-000000000001', 1),
      s.users.deactivate('00000000-0000-0000-0000-000000000001', 1),
      s.access.matrix(),
      s.reportTemplates.list({ search: 'res', filters: { templateType: 'FIELD_NARRATIVE', active: true } }),
      s.reportTemplates.create({ code: 'T', name: 'N', templateType: 'FIELD_NARRATIVE' }),
      s.reportTemplates.update(1, { name: 'N', templateType: 'KYC_DOCUMENT', content: 'x', version: 1 }),
      s.reportTemplates.activate(1, 1),
      s.reportTemplates.deactivate(1, 1),
      s.departments.list({ search: 'ops' }),
      s.departments.options(),
      s.departments.create({ name: 'Operations' }),
      s.departments.update(1, { name: 'Operations', description: 'x', version: 1 }),
      s.departments.activate(1, 1),
      s.departments.deactivate(1, 1),
      s.designations.list({ search: 'exec' }),
      s.designations.options(),
      s.designations.create({ name: 'Senior Executive', departmentId: 1 }),
      s.designations.update(1, { name: 'Senior Executive', description: 'x', version: 1 }),
      s.designations.activate(1, 1),
      s.designations.deactivate(1, 1),
      s.system.health(),
      s.users.setPassword('00000000-0000-0000-0000-000000000001', { password: 'Str0ng!pass' }),
      s.users.generateTempPassword('00000000-0000-0000-0000-000000000001'),
      s.users.unlock('00000000-0000-0000-0000-000000000001'),
      s.users.sessions('00000000-0000-0000-0000-000000000001'),
      s.users.revokeSession('00000000-0000-0000-0000-000000000001', 'jti-1'),
      s.users.photoUrl('00000000-0000-0000-0000-000000000001'),
      s.roles.list({ search: 'agent' }),
      s.roles.options(),
      s.roles.dimensions(),
      s.roles.create({ code: 'ZONE_AUDITOR', name: 'Zone Auditor', hierarchyMode: 'ALL' }),
      s.roles.update('ZONE_AUDITOR', { name: 'Zone Auditor', hierarchyMode: 'ALL', version: 1 }),
      s.roles.activate('ZONE_AUDITOR', 1),
      s.roles.deactivate('ZONE_AUDITOR', 2),
      s.roles.setPermissions('FIELD_AGENT', { permissions: ['case.view'], version: 1 }),
      s.users.scopeAssignments('00000000-0000-0000-0000-000000000001'),
      s.users.assignScope('00000000-0000-0000-0000-000000000001', {
        dimension: 'PINCODE',
        entityIds: [1],
      }),
      s.users.removeScopeAssignment('00000000-0000-0000-0000-000000000001', 1),
      s.auth.sessions('jti-1'),
      s.auth.revokeSession('jti-1'),
      s.auth.changePassword({ currentPassword: 'old', newPassword: 'Str0ng!pass' }),
      s.auth.mfaStatus(),
      s.auth.mfaEnrollStart(),
      s.auth.mfaEnrollVerify({ code: '123456' }),
      s.auth.mfaDisable({ code: '123456' }),
      s.auth.mfaAdminDisable('00000000-0000-0000-0000-000000000001'),
      s.auth.login({ username: 'u', password: 'p' }),
      s.auth.refresh({ refreshToken: 'r' }),
      s.auth.logout(),
      s.auth.me(),
      s.cases.dedupe({ pan: 'ABCDE1234F' }),
      s.cases.dedupeSearch({
        name: 'ravi',
        pan: 'ABCDE1234F',
        mobile: '90000',
        company: 'acme',
        page: 2,
        limit: 50,
        sortBy: 'createdAt',
        sortOrder: 'asc',
      }),
      s.cases.availableUnits(1, 2),
      s.cases.create({
        clientId: 1,
        productId: 2,
        backendContactNumber: '9876543210',
        applicants: [{ name: 'X' }],
        dedupeDecision: 'NO_DUPLICATES_FOUND',
      }),
      s.cases.addTasks('00000000-0000-0000-0000-000000000001', {
        tasks: [
          {
            verificationUnitId: 1,
            applicantId: '00000000-0000-0000-0000-0000000000aa',
            address: '12 MG Road',
          },
        ],
      }),
      s.cases.list({ filters: { status: 'NEW' } }),
      s.cases.get('00000000-0000-0000-0000-000000000001'),
      s.cases.assignableUsers('00000000-0000-0000-0000-000000000001'),
      s.cases.assignTask('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', {
        assignedTo: '00000000-0000-0000-0000-000000000003',
        visitType: 'FIELD',
        fieldRateType: 'LOCAL',
        billCount: 1,
        version: 1,
      }),
      s.cases.completeTask('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', {
        result: 'POSITIVE',
        remark: 'verified',
        version: 1,
      }),
      s.cases.listAttachments('00000000-0000-0000-0000-000000000001'),
      s.cases.fieldPhotos('00000000-0000-0000-0000-000000000001'),
      s.cases.fieldReport('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'),
      s.cases.attachmentUrl('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004'),
      s.cases.deleteAttachment(
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000004',
      ),
      s.cases.reportPreview('00000000-0000-0000-0000-000000000001'),
      s.cases.generateReport('00000000-0000-0000-0000-000000000001'),
      s.time.now(),
      s.tasks.list({ filters: { status: 'PENDING' } }),
      s.tasks.stats({ search: 'CASE-000001' }),
      s.tasks.assignableUsers(['00000000-0000-0000-0000-000000000002']),
      s.tasks.bulkAssign({
        items: [{ id: '00000000-0000-0000-0000-000000000002', version: 1 }],
        assignedTo: '00000000-0000-0000-0000-000000000003',
        visitType: 'FIELD',
        fieldRateType: 'LOCAL',
        billCount: 1,
      }),
      s.sync.download({ lastSyncTimestamp: '2026-06-11T00:00:00.000Z', limit: 50, offset: 0 }),
      s.fieldMonitoring.agents({ page: 1 }),
      s.fieldMonitoring.stats(),
      s.location.capture({
        latitude: 19.07,
        longitude: 72.87,
        accuracy: 8,
        timestamp: '2026-06-11T10:00:00.000Z',
        source: 'TRACKING',
      }),
      s.geocode.reverse(19.07, 72.87),
      s.notifications.list({ page: 1, unreadOnly: true }),
      s.notifications.unreadCount(),
      s.notifications.markRead('00000000-0000-0000-0000-0000000000aa'),
      s.notifications.markAllRead(),
      s.auth.registerPushToken({ pushToken: 'tok', platform: 'ANDROID' }),
      s.fieldMonitoring.requestLocation('00000000-0000-0000-0000-0000000000aa'),
      s.clients.options(),
      s.products.options(),
      s.verificationUnits.options(),
      s.users.options(),
      s.jobs.list({ page: 1 }),
      s.jobs.get('00000000-0000-0000-0000-0000000000aa'),
      s.jobs.resultUrl('00000000-0000-0000-0000-0000000000aa'),
      s.savedViews.list('cases'),
      s.savedViews.create({ resourceKey: 'cases', name: 'MY VIEW', state: { q: 'x', sort: 'name' } }),
      s.savedViews.update('00000000-0000-0000-0000-0000000000aa', { name: 'RENAMED' }),
      s.savedViews.remove('00000000-0000-0000-0000-0000000000aa'),
      s.savedViews.setDefault('00000000-0000-0000-0000-0000000000aa', true),
    ]);
    expect(calls.length).toBe(161); // ADR-0055: removed cases.unassignTask
    expect(calls.some((c) => c.url === 'http://x/api/v2/commission-rates')).toBe(true);
    expect(calls.some((c) => c.url === 'http://x/api/v2/tat-policies')).toBe(true);
    expect(calls.some((c) => c.url === 'http://x/api/v2/report-layouts')).toBe(true);
    expect(
      calls.some(
        (c) =>
          c.url ===
          'http://x/api/v2/cases/00000000-0000-0000-0000-000000000001/tasks/00000000-0000-0000-0000-000000000002/field-report',
      ),
    ).toBe(true);
    expect(
      calls.some((c) => c.url === 'http://x/api/v2/data-entry/cases/00000000-0000-0000-0000-0000000000aa'),
    ).toBe(true);
    expect(
      calls.some(
        (c) => c.url === 'http://x/api/v2/data-entry/cases/00000000-0000-0000-0000-0000000000aa/pickup',
      ),
    ).toBe(true);
    expect(calls.some((c) => c.url.startsWith('http://x/api/v2/billing/cases'))).toBe(true);
    expect(calls.some((c) => c.url === 'http://x/api/v2/saved-views?resourceKey=cases')).toBe(true);
    expect(
      calls.some(
        (c) =>
          c.url ===
          'http://x/api/v2/sync/download?lastSyncTimestamp=2026-06-11T00%3A00%3A00.000Z&limit=50&offset=0',
      ),
    ).toBe(true);
  });

  it('billing.breakdown builds a versioned URL with query params', async () => {
    const { impl, calls } = fakeFetch(200, { byLocation: [], byBand: [] });
    const sdk = createSdk({ baseUrl: 'http://x', fetchImpl: impl });
    await sdk.billing.breakdown({ clientId: 5, completedFrom: '2026-01-01' });
    expect(calls[0]?.url).toBe('http://x/api/v2/billing/breakdown?clientId=5&completedFrom=2026-01-01');
    expect(calls[0]?.init.method).toBe('GET');
  });

  it('options endpoints (B-22) hit the unpaginated /options feeds', async () => {
    const { impl, calls } = fakeFetch(200, []);
    const s = createSdk({ baseUrl: 'http://x', fetchImpl: impl });
    await s.clients.options();
    await s.products.options();
    await s.verificationUnits.options();
    await s.users.options();
    expect(calls.map((c) => c.url)).toEqual([
      'http://x/api/v2/clients/options',
      'http://x/api/v2/products/options',
      'http://x/api/v2/verification-units/options',
      'http://x/api/v2/users/options',
    ]);
    expect(calls.every((c) => c.init.method === 'GET' && c.init.body === undefined)).toBe(true);
  });

  it('wires the diagnostic + reference read endpoints (system, rate-types, roles, access, geocode)', async () => {
    const { impl, calls } = fakeFetch(200, {});
    const s = createSdk({ baseUrl: 'http://x', fetchImpl: impl });
    await s.system.health();
    await s.rateTypes.list();
    await s.roles.options();
    await s.roles.dimensions();
    await s.access.matrix();
    await s.geocode.reverse(12.97, 77.59);
    await s.geocode.dlq();
    expect(calls.map((c) => c.url)).toEqual([
      'http://x/api/v2/system/health',
      'http://x/api/v2/rate-types?active=true',
      'http://x/api/v2/roles/options',
      'http://x/api/v2/roles/dimensions',
      'http://x/api/v2/access/matrix',
      'http://x/api/v2/geocode/reverse?lat=12.97&lng=77.59',
      'http://x/api/v2/geocode/dlq',
    ]);
    expect(calls.every((c) => c.init.method === 'GET')).toBe(true);
  });

  it('posts the geocode DLQ replay', async () => {
    const { impl, calls } = fakeFetch(200, { replayed: 3 });
    const s = createSdk({ baseUrl: 'http://x', fetchImpl: impl });
    expect(await s.geocode.replayDlq()).toEqual({ replayed: 3 });
    expect(calls[0]?.url).toBe('http://x/api/v2/geocode/dlq/replay');
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('wires auth/me, notifications, billing and sync read endpoints', async () => {
    const { impl, calls } = fakeFetch(200, {});
    const s = createSdk({ baseUrl: 'http://x', fetchImpl: impl, getAuthToken: () => 'Bearer t' });
    await s.auth.me();
    await s.notifications.unreadCount();
    await s.notifications.list();
    await s.billing.cases();
    await s.billing.caseTasks('c1');
    await s.sync.download();
    expect(calls).toHaveLength(6);
    expect(calls.every((c) => c.init.method === 'GET')).toBe(true);
    // exact-path (no query) endpoints:
    expect(calls.map((c) => c.url)).toEqual(
      expect.arrayContaining([
        'http://x/api/v2/auth/me',
        'http://x/api/v2/notifications/unread-count',
        'http://x/api/v2/billing/cases/c1/tasks',
      ]),
    );
  });

  it('mis.rows builds URL with required + optional params; mis.export routes to /mis/export', async () => {
    const { impl, calls } = fakeFetch(200, { columns: [], rows: [], totalCount: 0 });
    const s = createSdk({ baseUrl: 'http://x', fetchImpl: impl });
    // required params only
    await s.mis.rows({ clientId: 3, productId: 7 });
    expect(calls[0]?.url).toBe('http://x/api/v2/mis/rows?clientId=3&productId=7');
    expect(calls[0]?.init.method).toBe('GET');
    // with optional date-range + search + pagination
    await s.mis.rows({
      clientId: 3,
      productId: 7,
      completedFrom: '2026-01-01T00:00:00.000Z',
      completedTo: '2026-06-30T23:59:59.999Z',
      search: 'HDFC',
      page: 2,
      pageSize: 100,
    });
    const q = new URL(calls[1]!.url).searchParams;
    expect(q.get('clientId')).toBe('3');
    expect(q.get('productId')).toBe('7');
    expect(q.get('completedFrom')).toBe('2026-01-01T00:00:00.000Z');
    expect(q.get('completedTo')).toBe('2026-06-30T23:59:59.999Z');
    expect(q.get('search')).toBe('HDFC');
    expect(q.get('page')).toBe('2');
    expect(q.get('pageSize')).toBe('100');
  });
});
