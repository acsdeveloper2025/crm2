import type {
  VerificationUnit,
  VerificationUnitOption,
  CreateVerificationUnitInput,
  UpdateVerificationUnitInput,
} from './verificationUnit.js';
import type { Paginated, PageQuery } from './pagination.js';
import { pageQueryToParams } from './pagination.js';
import type { MisReportTypeMeta, MisRow, MisSummary } from './mis.js';
import type { KycAttachment, KycQueueState, KycTaskRow } from './kycTasks.js';
import type { ExportRequest, ExportResult } from './export.js';
import { exportQueryToParams } from './export.js';
import type { Option } from './options.js';
import type { Client, CreateClientInput, UpdateClientInput } from './clients.js';
import type { Product, CreateProductInput, UpdateProductInput } from './products.js';
import type {
  ClientProduct,
  ClientProductView,
  ClientProductVerificationUnit,
  ClientProductVerificationUnitView,
  CreateClientProductInput,
  CreateCpvUnitInput,
  UpdateClientProductInput,
  UpdateCpvUnitInput,
  CpvUnitListQuery,
} from './cpv.js';
import type {
  Rate,
  RateView,
  RateHistory,
  CreateRateInput,
  UpdateRateInput,
  ReviseRateInput,
} from './rates.js';
import type { RateTypeOption } from './rateTypes.js';
import type {
  BulkCommissionRateResult,
  BulkCreateCommissionRatesInput,
  CommissionRate,
  CommissionRateView,
  CommissionTerritoryLocation,
  CreateCommissionRateInput,
  ReviseCommissionRateInput,
} from './commissionRates.js';
import type { TatPolicy, TatPolicyView, CreateTatPolicyInput, ReviseTatPolicyInput } from './tatPolicies.js';
import type {
  BillingLineRow,
  BillingLinesSummary,
  CommissionSummaryRow,
  CommissionSummaryQuery,
  CommissionDetailRow,
  CommissionDetailQuery,
} from './billing.js';
import type { FieldReportView } from './reportLayouts.js';
import type {
  Location,
  CreateLocationInput,
  CreateLocationBatchInput,
  LocationBatchResult,
  UpdateLocationInput,
} from './locations.js';
import type { User, UserView, UserOption, CreateUserInput, UpdateUserInput } from './users.js';
import type { UserScopeAssignments, AssignScopeInput } from './userAssignments.js';
import type { AccessMatrix } from './access.js';
import type {
  RoleView,
  RoleOption,
  ScopeDimensionInfo,
  CreateRoleInput,
  UpdateRoleInput,
  UpdateRolePermissionsInput,
} from './roles.js';
import type {
  Department,
  DepartmentOption,
  CreateDepartmentInput,
  UpdateDepartmentInput,
} from './departments.js';
import type {
  Designation,
  DesignationOption,
  CreateDesignationInput,
  UpdateDesignationInput,
} from './designations.js';
import type { SystemHealth } from './system.js';
import type {
  LoginInput,
  RefreshInput,
  LoginResponse,
  AuthTokens,
  AuthUser,
  SetPasswordInput,
  ChangePasswordInput,
  TempPasswordResponse,
  MfaCodeInput,
  MfaStatus,
  MfaEnrollStart,
  MfaRecoveryCodes,
  SessionInfo,
} from './auth.js';
import type {
  Case,
  CaseView,
  CaseDetail,
  CaseTaskView,
  AvailableUnit,
  DuplicateMatch,
  DedupeQuery,
  DedupeSearchQuery,
  CreateCaseInput,
  AddTasksInput,
  AddApplicantInput,
  CaseApplicant,
  AssignableUser,
  AssignTaskRequest,
  CompleteTaskRequest,
  RecordTaskResultRequest,
  CaseFinalizeRequest,
  CaseVerdictEvent,
  RevokeTaskInput,
  ReworkTaskInput,
  ReassignTaskInput,
  CaseAttachment,
  CaseFieldPhoto,
  EligibleAssigneesQuery,
} from './cases.js';
import type { CaseReportContext, CaseReportFormat } from './caseReports.js';
import type { TaskView, TaskStats, BulkAssignInput, BulkAssignResult } from './tasks.js';
import type { FieldAgentView, FieldMonitoringStats } from './fieldMonitoring.js';
import type {
  Notification,
  NotificationListQuery,
  UnreadCount,
  MarkAllReadResult,
  RegisterPushTokenInput,
  PushTokenRegistration,
  RequestLocationResult,
} from './notifications.js';
import type { LocationCaptureRequest, LocationCaptureResponse } from './location.js';
import type { ReverseGeocodeResult, ReverseGeocodeDlqRow } from './geocode.js';
import type { ServerTime } from './time.js';
import type { MobileSyncDownload, SyncDownloadQuery } from './sync.js';
import type { JobView, JobListQuery, JobResultUrl } from './jobs.js';
import type { SavedView, CreateSavedViewInput, UpdateSavedViewInput } from './savedViews.js';

export interface SdkOptions {
  baseUrl: string;
  /** returns the Authorization header value (e.g. `Bearer <jwt>`) */
  getAuthToken?: () => string | null;
  fetchImpl?: typeof fetch;
}

/** Shared query-string builder for the commission-summary list + export (everything but page/pageSize). */
function commissionSummaryParams(q: Omit<CommissionSummaryQuery, 'page' | 'pageSize'>): URLSearchParams {
  const p = new URLSearchParams();
  if (q.period) p.set('period', q.period);
  if (q.groupBy) p.set('groupBy', q.groupBy);
  if (q.clientId !== undefined) p.set('clientId', String(q.clientId));
  if (q.productId !== undefined) p.set('productId', String(q.productId));
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.search) p.set('search', q.search);
  return p;
}

/** Shared query-string builder for the commission-detail list + export (everything but page/pageSize). */
function commissionDetailParams(q: Omit<CommissionDetailQuery, 'page' | 'pageSize'>): URLSearchParams {
  const p = new URLSearchParams();
  if (q.clientId !== undefined) p.set('clientId', String(q.clientId));
  if (q.productId !== undefined) p.set('productId', String(q.productId));
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.search) p.set('search', q.search);
  return p;
}

/** Thin typed client (Day-1 carries the contracts; no separate package). */
export function createSdk(opts: SdkOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  const req = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const token = opts.getAuthToken?.() ?? null;
    const init: RequestInit = {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: token } : {}),
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await doFetch(`${opts.baseUrl}${path}`, init);
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new SdkError(res.status, json?.error ?? 'REQUEST_FAILED', json);
    return json as T;
  };

  /**
   * DataGrid export transport (IMPORT_EXPORT_STANDARD): GET a file, not JSON. On success returns the
   * blob + the server-suggested filename (Content-Disposition); on error (e.g. 413 EXPORT_TOO_LARGE)
   * the body is JSON, parsed into an SdkError like `req`.
   */
  const reqBlob = async (
    resource: string,
    r: ExportRequest,
    extra?: Record<string, string | undefined>,
  ): Promise<ExportResult> => {
    const token = opts.getAuthToken?.() ?? null;
    const params = exportQueryToParams(r);
    for (const [k, v] of Object.entries(extra ?? {})) if (v) params.set(k, v);
    const qs = params.toString();
    const res = await doFetch(`${opts.baseUrl}/api/v2/${resource}/export?${qs}`, {
      method: 'GET',
      headers: { ...(token ? { authorization: token } : {}) },
    });
    if (!res.ok) {
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      throw new SdkError(res.status, json?.error ?? 'EXPORT_FAILED', json);
    }
    const disp = res.headers.get('content-disposition') ?? '';
    const match = /filename="?([^"]+)"?/.exec(disp);
    const filename = match?.[1] ?? `${resource}.${r.format}`;
    return { blob: await res.blob(), filename };
  };

  return {
    verificationUnits: {
      list: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<VerificationUnit>>('GET', `/api/v2/verification-units${qs ? `?${qs}` : ''}`);
      },
      get: (id: number) => req<VerificationUnit>('GET', `/api/v2/verification-units/${id}`),
      /** Unpaginated USABLE units (with `kind`) for dropdowns (B-22); never truncates like `?limit=200`. */
      options: () => req<VerificationUnitOption[]>('GET', '/api/v2/verification-units/options'),
      create: (input: CreateVerificationUnitInput) =>
        req<VerificationUnit>('POST', '/api/v2/verification-units', input),
      // OCC (ADR-0019): edits/(de)activations carry the expected `version`; 409 STALE_UPDATE on conflict.
      update: (id: number, input: UpdateVerificationUnitInput & { version: number }) =>
        req<VerificationUnit>('PUT', `/api/v2/verification-units/${id}`, input),
      activate: (id: number, version: number) =>
        req<VerificationUnit>('POST', `/api/v2/verification-units/${id}/activate`, { version }),
      deactivate: (id: number, version: number) =>
        req<VerificationUnit>('POST', `/api/v2/verification-units/${id}/deactivate`, { version }),
      /** DataGrid export (IMPORT_EXPORT_STANDARD): same list query + format/mode → a file blob. */
      export: (r: ExportRequest) => reqBlob('verification-units', r),
    },

    clients: {
      list: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<Client>>('GET', `/api/v2/clients${qs ? `?${qs}` : ''}`);
      },
      get: (id: number) => req<Client>('GET', `/api/v2/clients/${id}`),
      /** Unpaginated USABLE clients for dropdowns (B-22); never truncates like `?limit=200`. */
      options: () => req<Option[]>('GET', '/api/v2/clients/options'),
      create: (input: CreateClientInput) => req<Client>('POST', '/api/v2/clients', input),
      // OCC (ADR-0019): edits/(de)activations carry the expected `version`; 409 STALE_UPDATE on conflict.
      update: (id: number, input: UpdateClientInput & { version: number }) =>
        req<Client>('PUT', `/api/v2/clients/${id}`, input),
      activate: (id: number, version: number) =>
        req<Client>('POST', `/api/v2/clients/${id}/activate`, { version }),
      deactivate: (id: number, version: number) =>
        req<Client>('POST', `/api/v2/clients/${id}/deactivate`, { version }),
      /** DataGrid export (IMPORT_EXPORT_STANDARD): same list query + format/mode → a file blob. */
      export: (r: ExportRequest) => reqBlob('clients', r),
    },

    products: {
      list: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<Product>>('GET', `/api/v2/products${qs ? `?${qs}` : ''}`);
      },
      get: (id: number) => req<Product>('GET', `/api/v2/products/${id}`),
      /** Unpaginated USABLE products for dropdowns (B-22); never truncates like `?limit=200`. */
      options: () => req<Option[]>('GET', '/api/v2/products/options'),
      create: (input: CreateProductInput) => req<Product>('POST', '/api/v2/products', input),
      // OCC (ADR-0019): edits/(de)activations carry the expected `version`; 409 STALE_UPDATE on conflict.
      update: (id: number, input: UpdateProductInput & { version: number }) =>
        req<Product>('PUT', `/api/v2/products/${id}`, input),
      activate: (id: number, version: number) =>
        req<Product>('POST', `/api/v2/products/${id}/activate`, { version }),
      deactivate: (id: number, version: number) =>
        req<Product>('POST', `/api/v2/products/${id}/deactivate`, { version }),
      /** DataGrid export (IMPORT_EXPORT_STANDARD): same list query + format/mode → a file blob. */
      export: (r: ExportRequest) => reqBlob('products', r),
    },

    clientProducts: {
      /** Paginated CPV links (DataGrid envelope); `f_client`/`f_product` + clientId/active filters. */
      list: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<ClientProductView>>('GET', `/api/v2/client-products${qs ? `?${qs}` : ''}`);
      },
      create: (input: CreateClientProductInput) =>
        req<ClientProduct>('POST', '/api/v2/client-products', input),
      // OCC (ADR-0019): reschedule effective-from carries the expected `version`; 409 STALE_UPDATE on conflict.
      update: (id: number, input: UpdateClientProductInput & { version: number }) =>
        req<ClientProduct>('PUT', `/api/v2/client-products/${id}`, input),
      activate: (id: number, version: number) =>
        req<ClientProduct>('POST', `/api/v2/client-products/${id}/activate`, { version }),
      deactivate: (id: number, version: number) =>
        req<ClientProduct>('POST', `/api/v2/client-products/${id}/deactivate`, { version }),
      /** DataGrid export (IMPORT_EXPORT_STANDARD): same list query + format/mode → a file blob. */
      export: (r: ExportRequest) => reqBlob('client-products', r),
    },

    cpvUnits: {
      list: (q: CpvUnitListQuery) => {
        const params = new URLSearchParams();
        params.set('clientProductId', String(q.clientProductId));
        if (q.active !== undefined) params.set('active', String(q.active));
        return req<ClientProductVerificationUnitView[]>('GET', `/api/v2/cpv-units?${params.toString()}`);
      },
      create: (input: CreateCpvUnitInput) =>
        req<ClientProductVerificationUnit>('POST', '/api/v2/cpv-units', input),
      // OCC (ADR-0019): reschedule effective-from carries the expected `version`; 409 STALE_UPDATE on conflict.
      update: (id: number, input: UpdateCpvUnitInput & { version: number }) =>
        req<ClientProductVerificationUnit>('PUT', `/api/v2/cpv-units/${id}`, input),
      activate: (id: number, version: number) =>
        req<ClientProductVerificationUnit>('POST', `/api/v2/cpv-units/${id}/activate`, { version }),
      deactivate: (id: number, version: number) =>
        req<ClientProductVerificationUnit>('POST', `/api/v2/cpv-units/${id}/deactivate`, { version }),
    },

    rates: {
      list: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<RateView>>('GET', `/api/v2/rates${qs ? `?${qs}` : ''}`);
      },
      create: (input: CreateRateInput) => req<Rate>('POST', '/api/v2/rates', input),
      // OCC (ADR-0019): edit/revise/(de)activate carry the current row's `version`; 409 STALE_UPDATE on conflict.
      update: (id: number, input: UpdateRateInput & { version: number }) =>
        req<Rate>('PUT', `/api/v2/rates/${id}`, input),
      revise: (id: number, input: ReviseRateInput & { version: number }) =>
        req<Rate>('POST', `/api/v2/rates/${id}/revise`, input),
      history: (id: number) => req<RateHistory[]>('GET', `/api/v2/rates/${id}/history`),
      activate: (id: number, version: number) =>
        req<Rate>('POST', `/api/v2/rates/${id}/activate`, { version }),
      deactivate: (id: number, version: number) =>
        req<Rate>('POST', `/api/v2/rates/${id}/deactivate`, { version }),
      /** DataGrid export (IMPORT_EXPORT_STANDARD): same list query + format/mode → a file blob. */
      export: (r: ExportRequest) => reqBlob('rates', r),
    },

    /** Per-user agent-commission rates (ADR-0036). Same effective-dated/OCC shape as rates. */
    commissionRates: {
      list: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<CommissionRateView>>('GET', `/api/v2/commission-rates${qs ? `?${qs}` : ''}`);
      },
      create: (input: CreateCommissionRateInput) =>
        req<CommissionRate>('POST', '/api/v2/commission-rates', input),
      /** The field user's assigned (pincode, area) locations — the bulk/single location-picker source. */
      territory: (userId: string) =>
        req<CommissionTerritoryLocation[]>(
          'GET',
          `/api/v2/commission-rates/lookups/territory?userId=${encodeURIComponent(userId)}`,
        ),
      /** Multi-location bulk create — one field agent's rate fanned across many territory locations. */
      bulkCreate: (input: BulkCreateCommissionRatesInput) =>
        req<BulkCommissionRateResult>('POST', '/api/v2/commission-rates/bulk', input),
      // OCC (ADR-0019): revise/(de)activate carry the current row's `version`; 409 STALE_UPDATE on conflict.
      revise: (id: number, input: ReviseCommissionRateInput & { version: number }) =>
        req<CommissionRate>('POST', `/api/v2/commission-rates/${id}/revise`, input),
      activate: (id: number, version: number) =>
        req<CommissionRate>('POST', `/api/v2/commission-rates/${id}/activate`, { version }),
      deactivate: (id: number, version: number) =>
        req<CommissionRate>('POST', `/api/v2/commission-rates/${id}/deactivate`, { version }),
    },

    /** TAT band master (ADR-0044). Same effective-dated/OCC shape as commission rates. */
    tatPolicies: {
      list: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<TatPolicyView>>('GET', `/api/v2/tat-policies${qs ? `?${qs}` : ''}`);
      },
      create: (input: CreateTatPolicyInput) => req<TatPolicy>('POST', '/api/v2/tat-policies', input),
      // OCC (ADR-0019): revise/(de)activate carry the current row's `version`; 409 STALE_UPDATE on conflict.
      revise: (id: number, input: ReviseTatPolicyInput & { version: number }) =>
        req<TatPolicy>('POST', `/api/v2/tat-policies/${id}/revise`, input),
      activate: (id: number, version: number) =>
        req<TatPolicy>('POST', `/api/v2/tat-policies/${id}/activate`, { version }),
      deactivate: (id: number, version: number) =>
        req<TatPolicy>('POST', `/api/v2/tat-policies/${id}/deactivate`, { version }),
    },

    /** Billing read-model (ADR-0036, slice 5b; flat per-line list per ADR-0086) — gated billing.view. */
    billing: {
      /** Flat billing lines — one row per COMPLETED billable task, every detail column on the row. */
      lines: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<BillingLineRow>>('GET', `/api/v2/billing/lines${qs ? `?${qs}` : ''}`);
      },
      /** DataGrid export (IMPORT_EXPORT_STANDARD): same list query + format/mode → a file blob. */
      linesExport: (r: ExportRequest) => reqBlob('billing/lines', r),
      /** Filter-aware ₹ bill total + line count for the grid footer (ADR-0086) — same list query, summed. */
      linesSummary: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<BillingLinesSummary>('GET', `/api/v2/billing/lines/summary${qs ? `?${qs}` : ''}`);
      },

      /**
       * Periodic per-field-user commission rollup (ADR-0081) — week/fortnight/month/quarter buckets,
       * optionally split by client+product. Anchored on earned-at COALESCE(submittedAt, completedAt).
       */
      commissionSummary: (q: CommissionSummaryQuery = {}) => {
        const p = commissionSummaryParams(q);
        if (q.page !== undefined) p.set('page', String(q.page));
        if (q.pageSize !== undefined) p.set('limit', String(q.pageSize)); // server pagination reads `limit`
        const qs = p.toString();
        return req<Paginated<CommissionSummaryRow>>(
          'GET',
          `/api/v2/billing/commission-summary${qs ? `?${qs}` : ''}`,
        );
      },

      /** DataGrid export (IMPORT_EXPORT_STANDARD): same summary query + format/mode → a file blob. */
      commissionSummaryExport: (q: Omit<CommissionSummaryQuery, 'page' | 'pageSize'>, r: ExportRequest) => {
        const extra: Record<string, string | undefined> = {};
        for (const [k, v] of commissionSummaryParams(q)) extra[k] = v;
        return reqBlob('billing/commission-summary', r, extra);
      },

      /** Per-task commission/billing detail (ADR-0081, v1 line-export parity) — real per-task rate + both rate types. */
      commissionDetail: (q: CommissionDetailQuery = {}) => {
        const p = commissionDetailParams(q);
        if (q.page !== undefined) p.set('page', String(q.page));
        if (q.pageSize !== undefined) p.set('limit', String(q.pageSize)); // server pagination reads `limit`
        const qs = p.toString();
        return req<Paginated<CommissionDetailRow>>(
          'GET',
          `/api/v2/billing/commission-detail${qs ? `?${qs}` : ''}`,
        );
      },

      /** DataGrid export (IMPORT_EXPORT_STANDARD): same detail query + format/mode → a file blob. */
      commissionDetailExport: (q: Omit<CommissionDetailQuery, 'page' | 'pageSize'>, r: ExportRequest) => {
        const extra: Record<string, string | undefined> = {};
        for (const [k, v] of commissionDetailParams(q)) extra[k] = v;
        return reqBlob('billing/commission-detail', r, extra);
      },
    },

    rateTypes: {
      // GET / is now paginated; the lean dropdown lives at /options (ADR-0064).
      list: () => req<RateTypeOption[]>('GET', '/api/v2/rate-types/options?active=true'),
    },

    locations: {
      list: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<Location>>('GET', `/api/v2/locations${qs ? `?${qs}` : ''}`);
      },
      pincodes: (q = '') =>
        req<string[]>('GET', `/api/v2/locations/pincodes${q ? `?q=${encodeURIComponent(q)}` : ''}`),
      create: (input: CreateLocationInput) => req<Location>('POST', '/api/v2/locations', input),
      /** Multi-area create — one pincode/city/state + N areas → N rows (existing pairs skipped). */
      createBatch: (input: CreateLocationBatchInput) =>
        req<LocationBatchResult>('POST', '/api/v2/locations/batch', input),
      // OCC (ADR-0019): edits/(de)activations carry the expected `version`; 409 STALE_UPDATE on conflict.
      update: (id: number, input: UpdateLocationInput & { version: number }) =>
        req<Location>('PUT', `/api/v2/locations/${id}`, input),
      activate: (id: number, version: number) =>
        req<Location>('POST', `/api/v2/locations/${id}/activate`, { version }),
      deactivate: (id: number, version: number) =>
        req<Location>('POST', `/api/v2/locations/${id}/deactivate`, { version }),
      /** DataGrid export (IMPORT_EXPORT_STANDARD): same list query + format/mode → a file blob. */
      export: (r: ExportRequest) => reqBlob('locations', r),
    },

    users: {
      list: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<UserView>>('GET', `/api/v2/users${qs ? `?${qs}` : ''}`);
      },
      /** Unpaginated USABLE users for dropdowns (e.g. reports-to picker, B-22); never truncates. */
      options: () => req<UserOption[]>('GET', '/api/v2/users/options'),
      create: (input: CreateUserInput) => req<User>('POST', '/api/v2/users', input),
      // OCC (ADR-0019): edits/(de)activations carry the expected `version`; 409 STALE_UPDATE on conflict.
      update: (id: string, input: UpdateUserInput & { version: number }) =>
        req<User>('PUT', `/api/v2/users/${id}`, input),
      activate: (id: string, version: number) =>
        req<User>('POST', `/api/v2/users/${id}/activate`, { version }),
      deactivate: (id: string, version: number) =>
        req<User>('POST', `/api/v2/users/${id}/deactivate`, { version }),
      setPassword: (id: string, input: SetPasswordInput) =>
        req<{ ok: true }>('POST', `/api/v2/users/${id}/password`, input),
      /** Admin mints a strong one-time password (returned once); the user must change it on first login. */
      generateTempPassword: (id: string) =>
        req<TempPasswordResponse>('POST', `/api/v2/users/${id}/generate-temp-password`),
      /** Admin clears a lockout from too many failed logins. */
      unlock: (id: string) => req<{ ok: true }>('POST', `/api/v2/users/${id}/unlock`),
      /** Admin views/revokes a user's active sessions (slice 6). */
      sessions: (id: string) => req<SessionInfo[]>('GET', `/api/v2/users/${id}/sessions`),
      revokeSession: (id: string, jti: string) =>
        req<{ ok: true }>('POST', `/api/v2/users/${id}/sessions/${jti}/revoke`),
      /** A signed URL to the user's profile photo (slice 7); 404 NO_PHOTO when none. The upload
       *  itself posts raw image bytes (apiUpload, like import) — no JSON method. */
      photoUrl: (id: string) => req<{ url: string }>('GET', `/api/v2/users/${id}/photo-url`),
      /** Generic scope assignment (ADR-0022): one surface for every dimension (territory, portfolio,
       *  …) — the target role's admin-edited wiring governs what may be assigned. Each mutation
       *  returns the fresh grouped assignments. Gated by access_scope.assign (SUPER_ADMIN only). */
      scopeAssignments: (id: string) =>
        req<UserScopeAssignments>('GET', `/api/v2/users/${id}/scope-assignments`),
      assignScope: (id: string, input: AssignScopeInput) =>
        req<UserScopeAssignments>('POST', `/api/v2/users/${id}/scope-assignments`, input),
      removeScopeAssignment: (id: string, assignmentId: number) =>
        req<UserScopeAssignments>('DELETE', `/api/v2/users/${id}/scope-assignments/${assignmentId}`),
      /** DataGrid export (IMPORT_EXPORT_STANDARD): same list query + format/mode → a file blob. */
      export: (r: ExportRequest) => reqBlob('users', r),
    },

    auth: {
      login: (input: LoginInput) => req<LoginResponse>('POST', '/api/v2/auth/login', input),
      refresh: (input: RefreshInput) => req<{ tokens: AuthTokens }>('POST', '/api/v2/auth/refresh', input),
      logout: () => req<{ ok: true }>('POST', '/api/v2/auth/logout'),
      me: () => req<AuthUser>('GET', '/api/v2/auth/me'),
      /** FCM device-token registration (ADR-0027): the device registers its push token (own user). */
      registerPushToken: (input: RegisterPushTokenInput) =>
        req<PushTokenRegistration>('POST', '/api/v2/auth/notifications/register', input),
      /** Self-service change-password (authenticated): current → new strong password. */
      changePassword: (input: ChangePasswordInput) =>
        req<{ ok: true }>('POST', '/api/v2/auth/change-password', input),
      /** MFA (slice 5): self-service enrol/status/disable; admin removes another user's enrolment. */
      mfaStatus: () => req<MfaStatus>('GET', '/api/v2/auth/mfa/status'),
      mfaEnrollStart: () => req<MfaEnrollStart>('POST', '/api/v2/auth/mfa/enroll/start'),
      mfaEnrollVerify: (input: MfaCodeInput) =>
        req<MfaRecoveryCodes>('POST', '/api/v2/auth/mfa/enroll/verify', input),
      mfaDisable: (input: MfaCodeInput) => req<{ ok: true }>('POST', '/api/v2/auth/mfa/disable', input),
      mfaAdminDisable: (userId: string) =>
        req<{ ok: true }>('POST', `/api/v2/auth/mfa/admin/${userId}/disable`),
      /** Sessions (slice 6): my active sessions; `currentJti` (decoded from my refresh token) flags
       *  the "this device" row. Revoke one of my own sessions (revoke-one, not logout-all). */
      sessions: (currentJti?: string) =>
        req<SessionInfo[]>(
          'GET',
          `/api/v2/auth/sessions${currentJti ? `?currentJti=${encodeURIComponent(currentJti)}` : ''}`,
        ),
      revokeSession: (jti: string) => req<{ ok: true }>('POST', `/api/v2/auth/sessions/${jti}/revoke`),
    },

    roles: {
      /** Role configuration (ADR-0022): the catalog is admin data — custom roles, permission sets,
       *  hierarchy visibility mode, and scope-dimension wiring are all edited here (role.manage). */
      list: (q: PageQuery = {}) =>
        req<Paginated<RoleView>>('GET', `/api/v2/roles?${pageQueryToParams(q).toString()}`),
      options: () => req<RoleOption[]>('GET', '/api/v2/roles/options'),
      dimensions: () => req<ScopeDimensionInfo[]>('GET', '/api/v2/roles/dimensions'),
      create: (input: CreateRoleInput) => req<RoleView>('POST', '/api/v2/roles', input),
      update: (code: string, input: UpdateRoleInput) => req<RoleView>('PUT', `/api/v2/roles/${code}`, input),
      activate: (code: string, version: number) =>
        req<RoleView>('POST', `/api/v2/roles/${code}/activate`, { version }),
      deactivate: (code: string, version: number) =>
        req<RoleView>('POST', `/api/v2/roles/${code}/deactivate`, { version }),
      setPermissions: (code: string, input: UpdateRolePermissionsInput) =>
        req<RoleView>('PUT', `/api/v2/roles/${code}/permissions`, input),
    },

    access: {
      matrix: () => req<AccessMatrix>('GET', '/api/v2/access/matrix'),
    },

    departments: {
      list: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<Department>>('GET', `/api/v2/departments${qs ? `?${qs}` : ''}`);
      },
      options: () => req<DepartmentOption[]>('GET', '/api/v2/departments/options'),
      create: (input: CreateDepartmentInput) => req<Department>('POST', '/api/v2/departments', input),
      // OCC (ADR-0019): edits/(de)activations carry the expected `version`; 409 STALE_UPDATE on conflict.
      update: (id: number, input: UpdateDepartmentInput & { version: number }) =>
        req<Department>('PUT', `/api/v2/departments/${id}`, input),
      activate: (id: number, version: number) =>
        req<Department>('POST', `/api/v2/departments/${id}/activate`, { version }),
      deactivate: (id: number, version: number) =>
        req<Department>('POST', `/api/v2/departments/${id}/deactivate`, { version }),
      /** DataGrid export (IMPORT_EXPORT_STANDARD): same list query + format/mode → a file blob. */
      export: (r: ExportRequest) => reqBlob('departments', r),
    },

    designations: {
      list: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<Designation>>('GET', `/api/v2/designations${qs ? `?${qs}` : ''}`);
      },
      options: () => req<DesignationOption[]>('GET', '/api/v2/designations/options'),
      create: (input: CreateDesignationInput) => req<Designation>('POST', '/api/v2/designations', input),
      // OCC (ADR-0019): edits/(de)activations carry the expected `version`; 409 STALE_UPDATE on conflict.
      update: (id: number, input: UpdateDesignationInput & { version: number }) =>
        req<Designation>('PUT', `/api/v2/designations/${id}`, input),
      activate: (id: number, version: number) =>
        req<Designation>('POST', `/api/v2/designations/${id}/activate`, { version }),
      deactivate: (id: number, version: number) =>
        req<Designation>('POST', `/api/v2/designations/${id}/deactivate`, { version }),
      /** DataGrid export (IMPORT_EXPORT_STANDARD): same list query + format/mode → a file blob. */
      export: (r: ExportRequest) => reqBlob('designations', r),
    },

    system: {
      health: () => req<SystemHealth>('GET', '/api/v2/system/health'),
    },

    cases: {
      dedupe: (input: DedupeQuery) => req<DuplicateMatch[]>('POST', '/api/v2/cases/dedupe', input),
      /** Standalone Dedupe Check page: paginated cross-case duplicate lookup (dedupe.view). */
      dedupeSearch: (q: DedupeSearchQuery) => {
        const p = new URLSearchParams();
        if (q.name) p.set('name', q.name);
        if (q.mobile) p.set('mobile', q.mobile);
        if (q.pan) p.set('pan', q.pan);
        if (q.company) p.set('company', q.company);
        if (q.page !== undefined) p.set('page', String(q.page));
        if (q.limit !== undefined) p.set('limit', String(q.limit));
        if (q.sortBy) p.set('sortBy', q.sortBy);
        if (q.sortOrder) p.set('sortOrder', q.sortOrder);
        return req<Paginated<DuplicateMatch>>('GET', `/api/v2/cases/dedupe-search?${p.toString()}`);
      },
      /** Export the current dedupe-search view (data.export) — same identifiers + format/mode. */
      dedupeSearchExport: (identifiers: DedupeQuery, r: ExportRequest) =>
        reqBlob('cases/dedupe-search', r, {
          name: identifiers.name,
          mobile: identifiers.mobile,
          pan: identifiers.pan,
          company: identifiers.company,
        }),
      availableUnits: (clientId: number, productId: number) =>
        req<AvailableUnit[]>(
          'GET',
          `/api/v2/cases/available-units?clientId=${clientId}&productId=${productId}`,
        ),
      create: (input: CreateCaseInput) => req<Case>('POST', '/api/v2/cases', input),
      addTasks: (id: string, input: AddTasksInput) =>
        req<CaseTaskView[]>('POST', `/api/v2/cases/${id}/tasks`, input),
      /** ADR-0053: add a co-applicant to an existing OPEN case (with its own dedupe verdict). */
      addApplicant: (id: string, input: AddApplicantInput) =>
        req<CaseApplicant>('POST', `/api/v2/cases/${id}/applicants`, input),
      list: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<CaseView>>('GET', `/api/v2/cases${qs ? `?${qs}` : ''}`);
      },
      get: (id: string) => req<CaseDetail>('GET', `/api/v2/cases/${id}`),
      assignableUsers: (caseId: string, taskId?: string, visitType?: string) => {
        const p = new URLSearchParams();
        if (taskId) p.set('taskId', taskId);
        if (visitType) p.set('visitType', visitType);
        const qs = p.toString();
        return req<AssignableUser[]>('GET', `/api/v2/cases/${caseId}/assignable-users${qs ? `?${qs}` : ''}`);
      },
      // ADR-0024: the eligible pool for a NEW task — visit-type pool ∩ hierarchy ∩ (FIELD: territory).
      eligibleAssignees: (caseId: string, q: EligibleAssigneesQuery) => {
        const p = new URLSearchParams({ visitType: q.visitType });
        if (q.pincodeId !== undefined) p.set('pincodeId', String(q.pincodeId));
        if (q.areaId !== undefined) p.set('areaId', String(q.areaId));
        return req<AssignableUser[]>('GET', `/api/v2/cases/${caseId}/eligible-assignees?${p.toString()}`);
      },
      // ADR-0055: assign a PENDING task only (server-gated); no unassign — move off an agent via Revoke +
      // reassign-after-revoke (reassignTask, below).
      assignTask: (caseId: string, taskId: string, input: AssignTaskRequest) =>
        req<CaseTaskView>('POST', `/api/v2/cases/${caseId}/tasks/${taskId}/assign`, input),
      completeTask: (caseId: string, taskId: string, input: CompleteTaskRequest) =>
        req<CaseTaskView>('POST', `/api/v2/cases/${caseId}/tasks/${taskId}/complete`, input),
      // Record the per-task office result on an already-COMPLETED task (ADR-0032 D3).
      recordTaskResult: (caseId: string, taskId: string, input: RecordTaskResultRequest) =>
        req<CaseTaskView>('POST', `/api/v2/cases/${caseId}/tasks/${taskId}/result`, input),
      // Record the ONE final case verdict + close the case (ADR-0032, AWAITING_COMPLETION → COMPLETED).
      finalize: (caseId: string, input: CaseFinalizeRequest) =>
        req<CaseDetail>('POST', `/api/v2/cases/${caseId}/finalize`, input),
      // Case verdict history (ADR-0033): every finalize (who/when/what), newest first, from the audit log.
      verdictHistory: (caseId: string) =>
        req<CaseVerdictEvent[]>('GET', `/api/v2/cases/${caseId}/verdict-history`),
      // Backend/office REVOKE a LIVE task (ADR-0033, task.revoke): {ASSIGNED,IN_PROGRESS} → REVOKED.
      revokeTask: (caseId: string, taskId: string, input: RevokeTaskInput) =>
        req<CaseTaskView>('POST', `/api/v2/cases/${caseId}/tasks/${taskId}/revoke`, input),
      // REVISIT a COMPLETED task — a new lineage-linked task that re-opens the case, billed separately
      // (ADR-0033, task.rework). Born PENDING (dispatched via the normal assign flow).
      revisitTask: (caseId: string, taskId: string, input: ReworkTaskInput = {}) =>
        req<CaseTaskView>('POST', `/api/v2/cases/${caseId}/tasks/${taskId}/revisit`, input),
      // REASSIGN-AFTER-REVOKE — dispatch a replacement for a REVOKED task (ADR-0033, task.rework).
      reassignTask: (caseId: string, taskId: string, input: ReassignTaskInput) =>
        req<CaseTaskView>('POST', `/api/v2/cases/${caseId}/tasks/${taskId}/reassign`, input),
      // Reference attachments (ADR-0025 B2). Upload is raw bytes (octet-stream + x-filename) — done
      // via the web's apiUpload, not this JSON transport. List/url/delete are JSON.
      listAttachments: (caseId: string) =>
        req<CaseAttachment[]>('GET', `/api/v2/cases/${caseId}/attachments`),
      /** Device field photos (ADR-0034) for the Field Photos card; images via attachmentUrl. */
      fieldPhotos: (caseId: string) => req<CaseFieldPhoto[]>('GET', `/api/v2/cases/${caseId}/field-photos`),
      /** Resolve (+persist, freeze-safe) one field photo's reverse-geocoded address — the on-view
       *  fallback (ADR-0040, FIELD_PHOTO only). Returns the frozen/cached address or null → coords. */
      fieldPhotoAddress: (caseId: string, attachmentId: string) =>
        req<ReverseGeocodeResult>('GET', `/api/v2/cases/${caseId}/field-photos/${attachmentId}/address`),
      /** The rendered FIELD_REPORT narrative for a task (#6 card; ADR-0039) — config-driven template
       *  run against the task's submitted form_data. `narrative` is null when none is configured. */
      fieldReport: (caseId: string, taskId: string) =>
        req<FieldReportView>('GET', `/api/v2/cases/${caseId}/tasks/${taskId}/field-report`),
      /** The assembled CASE_REPORT context (ADR-0041 S5 slice 1) — case identity + per-task FIELD_REPORT
       *  narratives + photos with frozen reverse-geocoded address + totals + active layout pointer.
       *  This is the JSON the renderers (slice 2 PDF / 4 docx / 5 xlsx) run against; admin Designer
       *  reads it to populate the variable catalog. */
      reportPreview: (caseId: string) =>
        req<CaseReportContext>('GET', `/api/v2/cases/${caseId}/report/preview`),
      /** Enqueue a CASE_REPORT job in `format` (pdf slice 2b / docx slice 4) → 202 + PENDING JobView.
       *  The FE tracks it in the job tray and downloads via jobs.resultUrl (the shared pattern). */
      generateReport: (caseId: string, format: CaseReportFormat = 'pdf') =>
        req<JobView>('POST', `/api/v2/cases/${caseId}/report?format=${format}`),
      attachmentUrl: (caseId: string, attachmentId: string) =>
        req<{ url: string }>('GET', `/api/v2/cases/${caseId}/attachments/${attachmentId}/url`),
      deleteAttachment: (caseId: string, attachmentId: string) =>
        req<void>('DELETE', `/api/v2/cases/${caseId}/attachments/${attachmentId}`),
    },

    tasks: {
      list: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<TaskView>>('GET', `/api/v2/tasks${qs ? `?${qs}` : ''}`);
      },
      stats: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<TaskStats>('GET', `/api/v2/tasks/stats${qs ? `?${qs}` : ''}`);
      },
      assignableUsers: (taskIds: string[], visitType?: string) =>
        req<AssignableUser[]>(
          'GET',
          `/api/v2/tasks/assignable-users?taskIds=${taskIds.join(',')}${visitType ? `&visitType=${visitType}` : ''}`,
        ),
      bulkAssign: (input: BulkAssignInput) =>
        req<BulkAssignResult>('POST', '/api/v2/tasks/bulk-assign', input),
      export: (r: ExportRequest) => reqBlob('tasks', r),
    },
    /** MIS (ADR-0084): predefined report types + a code-owned column allow-list. `reportTypes` is the
     *  catalog the picker renders (money columns present only for billing.view holders); `rows` fetches
     *  a paginated report, optionally restricted to the given column keys. */
    mis: {
      reportTypes: () => req<MisReportTypeMeta[]>('GET', '/api/v2/mis/report-types'),
      rows: (type: string, q: PageQuery = {}, cols?: string[]) => {
        const params = pageQueryToParams(q);
        if (cols && cols.length) params.set('cols', cols.join(','));
        const qs = params.toString();
        return req<Paginated<MisRow>>(
          'GET',
          `/api/v2/mis/${encodeURIComponent(type)}/rows${qs ? `?${qs}` : ''}`,
        );
      },
      summary: (type: string, groupBy: string, q: PageQuery = {}) => {
        const params = pageQueryToParams(q);
        params.set('group', groupBy);
        return req<MisSummary>('GET', `/api/v2/mis/${encodeURIComponent(type)}/summary?${params.toString()}`);
      },
    },
    /** KYC-verifier queue (ADR-0085): the actor's OFFICE tasks by derived export state. Export IS
     *  the claim action (first export dedups at the DB); `reexportReason` makes it an explicit,
     *  reasoned re-export of already-exported selected rows. */
    kycTasks: {
      list: (state: KycQueueState, q: PageQuery = {}, cols?: string[]) => {
        const params = pageQueryToParams(q);
        params.set('state', state);
        if (cols && cols.length) params.set('cols', cols.join(','));
        return req<Paginated<KycTaskRow>>('GET', `/api/v2/kyc-tasks?${params.toString()}`);
      },
      export: (r: ExportRequest, reexportReason?: string) =>
        reqBlob('kyc-tasks', r, reexportReason ? { reexportReason } : undefined),
      /** Reference attachments on the verifier's OWN task (he has no case-page access). */
      attachments: (taskId: string) =>
        req<KycAttachment[]>('GET', `/api/v2/kyc-tasks/${encodeURIComponent(taskId)}/attachments`),
      attachmentUrl: (taskId: string, attachmentId: string) =>
        req<{ url: string }>(
          'GET',
          `/api/v2/kyc-tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}/url`,
        ),
    },
    /** Field Monitoring console (ADR-0026): field executives in the actor's hierarchy scope. */
    fieldMonitoring: {
      agents: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<FieldAgentView>>('GET', `/api/v2/field-monitoring/agents${qs ? `?${qs}` : ''}`);
      },
      stats: (q: PageQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<FieldMonitoringStats>('GET', `/api/v2/field-monitoring/stats${qs ? `?${qs}` : ''}`);
      },
      export: (r: ExportRequest) => reqBlob('field-monitoring', r),
      /** Admin "request location" ping (ADR-0027): FCM + socket wake of a field agent for a fresh fix. */
      requestLocation: (agentId: string) =>
        req<RequestLocationResult>('POST', `/api/v2/field-monitoring/agents/${agentId}/request-location`),
    },
    /** In-app notification feed (ADR-0027): own-user scoped; the bell + the mobile feed contract. */
    notifications: {
      list: (q: NotificationListQuery = {}) => {
        const params = pageQueryToParams(q);
        if (q.unreadOnly) params.set('unreadOnly', 'true');
        const qs = params.toString();
        return req<Paginated<Notification>>('GET', `/api/v2/notifications${qs ? `?${qs}` : ''}`);
      },
      unreadCount: () => req<UnreadCount>('GET', '/api/v2/notifications/unread-count'),
      markRead: (id: string) => req<Notification>('POST', `/api/v2/notifications/${id}/read`, {}),
      markAllRead: () => req<MarkAllReadResult>('POST', '/api/v2/notifications/mark-all-read', {}),
    },
    /** Background jobs (ADR-0030): the own-user job tray — list + poll a long-running export/import. */
    jobs: {
      list: (q: JobListQuery = {}) => {
        const qs = pageQueryToParams(q).toString();
        return req<Paginated<JobView>>('GET', `/api/v2/jobs${qs ? `?${qs}` : ''}`);
      },
      get: (id: string) => req<JobView>('GET', `/api/v2/jobs/${id}`),
      /** Presigned download for a finished export job's artifact (B-13). */
      resultUrl: (id: string) => req<JobResultUrl>('GET', `/api/v2/jobs/${id}/result-url`),
    },
    /** Saved DataGrid views (B-5): own-user named grid-state snapshots, per resource. */
    savedViews: {
      list: (resourceKey: string) =>
        req<SavedView[]>('GET', `/api/v2/saved-views?resourceKey=${encodeURIComponent(resourceKey)}`),
      create: (input: CreateSavedViewInput) => req<SavedView>('POST', '/api/v2/saved-views', input),
      update: (id: string, input: UpdateSavedViewInput) =>
        req<SavedView>('PUT', `/api/v2/saved-views/${id}`, input),
      remove: (id: string) => req<{ ok: true }>('DELETE', `/api/v2/saved-views/${id}`),
      setDefault: (id: string, isDefault: boolean) =>
        req<SavedView>('POST', `/api/v2/saved-views/${id}/set-default`, { isDefault }),
    },
    /** Device location ingest (ADR-0026): the locked capture contract (forward-prep). */
    location: {
      capture: (body: LocationCaptureRequest) =>
        req<LocationCaptureResponse>('POST', '/api/v2/location/capture', body),
    },
    /** Reverse geocoding (ADR-0026): coord → frozen human address (null when unconfigured). */
    geocode: {
      reverse: (lat: number, lng: number) =>
        req<ReverseGeocodeResult>('GET', `/api/v2/geocode/reverse?lat=${lat}&lng=${lng}`),
      /** Open reverse-geocode DLQ (ADR-0040 S4 Slice B; ops/SA). */
      dlq: () => req<ReverseGeocodeDlqRow[]>('GET', '/api/v2/geocode/dlq'),
      /** Re-enqueue every open DLQ row (ops/SA). */
      replayDlq: () => req<{ replayed: number }>('POST', '/api/v2/geocode/dlq/replay'),
    },
    /** Server-authoritative time (ADR-0028): the clock reference for the client offset. */
    time: {
      now: () => req<ServerTime>('GET', '/api/v2/time'),
    },
    /** Mobile down-sync (ADR-0054): the v2-native field-dispatch contract for the field app. */
    sync: {
      download: (q: SyncDownloadQuery = {}) => {
        const p = new URLSearchParams();
        if (q.lastSyncTimestamp) p.set('lastSyncTimestamp', q.lastSyncTimestamp);
        if (q.limit !== undefined) p.set('limit', String(q.limit));
        if (q.offset !== undefined) p.set('offset', String(q.offset));
        const qs = p.toString();
        return req<MobileSyncDownload>('GET', `/api/v2/sync/download${qs ? `?${qs}` : ''}`);
      },
    },
  };
}

export class SdkError extends Error {
  constructor(
    public status: number,
    public code: string,
    public payload?: unknown,
  ) {
    super(`${status} ${code}`);
    this.name = 'SdkError';
  }
}

export type Crm2Sdk = ReturnType<typeof createSdk>;
