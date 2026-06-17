import {
  CreateUserSchema,
  UpdateUserSchema,
  UpdateSelfProfileSchema,
  SetPasswordSchema,
  type User,
  type UserView,
  type UserOption,
  type UserRole,
  type CreateUserInput,
  type Paginated,
} from '@crm2/sdk';
import { userRepository as repo } from './repository.js';
import { hashPassword, generateTempPassword } from '../../platform/password.js';
import { AppError } from '../../platform/errors.js';
import { requireVersion } from '../../platform/occ.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import {
  assertExportable,
  exportThreshold,
  type ExportColumn,
  type ResolvedExport,
} from '../../platform/export/index.js';
import {
  buildTemplate,
  runImportConfirm,
  runImportPreview,
  type ImportColumn,
  type ImportSpec,
} from '../../platform/import/index.js';
import { parseIsoDate } from '../../platform/import/parsers.js';
import { applyBulkOcc, parseBulkItems } from '../../platform/bulk.js';
import { randomUUID } from 'node:crypto';
import { getStorage } from '../../platform/storage/index.js';
import { getMailer } from '../../platform/mail/index.js';
import { detectImage, MAX_IMAGE_BYTES } from '../../platform/image.js';

/** Open role catalog (ADR-0022): the role query param is shape-checked, existence is the FK's job. */
const ROLE_CODE_SHAPE = /^[A-Z][A-Z0-9_]{1,19}$/;

/** Sortable columns (apiField → SQL column); only these reach ORDER BY. Filterable columns (§6/§7) below. */
const USER_PAGE_SPEC: PageSpec = {
  sortMap: {
    username: 'u.username',
    name: 'u.name',
    role: 'u.role',
    reportsTo: 'm.name',
    status: 'u.is_active',
    effectiveFrom: 'u.effective_from',
    createdAt: 'u.created_at',
    updatedAt: 'u.updated_at',
  },
  // Only columns present in the COUNT query (FROM users u — no manager join) are filterable.
  filterMap: {
    username: { column: 'u.username', kind: 'text' },
    name: { column: 'u.name', kind: 'text' },
    // open role catalog (ADR-0022): code-shaped multi-select, no closed enum — custom roles filter too
    role: { column: 'u.role', kind: 'code' },
    createdAt: { column: 'u.created_at', kind: 'date' },
    effectiveFrom: { column: 'u.effective_from', kind: 'date' },
  },
  defaultSort: 'name',
  defaultOrder: 'asc',
};

/**
 * The DataGrid export manifest for the users list. Column `id`s match the FE DataGrid column ids so
 * the visible-columns (`cols`) selection filters + orders them; the `actions` column has no data
 * value and is absent. Password/credential fields are never exported.
 */
const USER_EXPORT_COLUMNS: ExportColumn<UserView>[] = [
  { id: 'employeeId', header: 'Employee ID', value: (u) => u.employeeId ?? '' },
  { id: 'username', header: 'Username', value: (u) => u.username },
  { id: 'name', header: 'Name', value: (u) => u.name },
  { id: 'phone', header: 'Phone', value: (u) => u.phone ?? '' },
  { id: 'role', header: 'Role', value: (u) => u.role.replace(/_/g, ' ') },
  { id: 'departmentName', header: 'Department', value: (u) => u.departmentName ?? '' },
  { id: 'designationName', header: 'Designation', value: (u) => u.designationName ?? '' },
  { id: 'reportsTo', header: 'Reports To', value: (u) => u.reportsToName },
  { id: 'effectiveFrom', header: 'Effective From', value: (u) => u.effectiveFrom },
  { id: 'createdAt', header: 'Created', value: (u) => u.createdAt },
  { id: 'updatedAt', header: 'Updated', value: (u) => u.updatedAt },
  { id: 'status', header: 'Status', value: (u) => (u.isActive ? 'Active' : 'Inactive') },
];

/**
 * Import contract (B-14): the user file manifest. NO `reportsTo` column — the manager link is an
 * FK to another user that may not exist yet at import time (chicken-and-egg) and would make the
 * import order-dependent. Managers are assigned later via the per-user edit form, so the import is
 * deliberately FK-FREE: `create` maps reportsTo → null when absent. `effectiveFrom` is optional
 * (blank → server default now()) and coerced to ISO so the schema's `z.string().datetime()` accepts
 * a date typed into Excel.
 */
const USER_IMPORT_COLUMNS: ImportColumn[] = [
  { id: 'username', header: 'Username', required: true },
  { id: 'name', header: 'Name', required: true },
  { id: 'email', header: 'Email' },
  { id: 'role', header: 'Role', required: true },
  { id: 'effectiveFrom', header: 'Effective From', parse: parseIsoDate },
];

const USER_IMPORT_SPEC: ImportSpec<CreateUserInput> = {
  resource: 'users',
  columns: USER_IMPORT_COLUMNS,
  schema: CreateUserSchema,
  uniqueKey: 'username',
  sample: { username: 'jdoe', name: 'John Doe', email: 'jdoe@crm2.local', role: 'FIELD_AGENT' },
};

/**
 * User service — admin identity master-data.
 *  - create/update validated against the shared zod schema
 *  - `username` correctable as a login rename (ADR-0020 — no FK deps); update merges only provided fields
 *  - manager (`reportsTo`) must reference an existing user and may not be self
 *    (enforced by the DB FK + CHECK, mapped in the repo). Multi-level cycle
 *    prevention is deferred to the assignment/hierarchy phase.
 */
export const userService = {
  async list(rawQuery: Record<string, unknown>): Promise<Paginated<UserView>> {
    const r = resolvePage(rawQuery, USER_PAGE_SPEC);
    const rawRole = rawQuery['role'];
    const role: UserRole | undefined =
      typeof rawRole === 'string' && ROLE_CODE_SHAPE.test(rawRole) ? rawRole : undefined;
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, USER_PAGE_SPEC);
    const { items, totalCount } = await repo.list({
      ...(role !== undefined ? { role } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: r.limit,
      offset: r.offset,
    });
    const filters: Record<string, unknown> = {};
    if (role !== undefined) filters['role'] = role;
    if (active !== undefined) filters['active'] = active;
    if (r.search !== undefined) filters['search'] = r.search;
    for (const f of columnFilters) filters[`f_${f.field}`] = f.values.join(',');
    return buildPage(items, totalCount, r, filters);
  },

  /**
   * Export rows for the DataGrid (IMPORT_EXPORT_STANDARD). Re-runs the SAME list query
   * (role/active/search/filters/sort) — `current` = the exact page; `all` = every matching row
   * (no page LIMIT, capped at the job threshold → 413 EXPORT_TOO_LARGE above it). Returns rows +
   * the users column manifest; the controller streams the file.
   */
  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    const r = resolvePage(rawQuery, USER_PAGE_SPEC);
    const rawRole = rawQuery['role'];
    const role: UserRole | undefined =
      typeof rawRole === 'string' && ROLE_CODE_SHAPE.test(rawRole) ? rawRole : undefined;
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, USER_PAGE_SPEC);
    // `selected` restricts to the ticked uuid ids; drop malformed ids and export nothing for an
    // empty/invalid set (never falls through to "all"). id is a uuid (not an int).
    const selectedIds =
      ex.mode === 'selected'
        ? ex.ids.filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))
        : undefined;
    if (ex.mode === 'selected' && (!selectedIds || selectedIds.length === 0))
      return { rows: [], columns: USER_EXPORT_COLUMNS };
    const { items, totalCount } = await repo.list({
      ...(role !== undefined ? { role } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      ...(selectedIds ? { ids: selectedIds } : {}),
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: ex.mode === 'current' ? r.limit : exportThreshold(),
      offset: ex.mode === 'current' ? r.offset : 0,
    });
    if (ex.mode === 'all') assertExportable(totalCount);
    return { rows: items, columns: USER_EXPORT_COLUMNS };
  },

  options(): Promise<UserOption[]> {
    return repo.options();
  },

  async create(input: unknown, userId: string): Promise<User> {
    const v = CreateUserSchema.parse(input); // throws ZodError → 400
    // employee_id is minted in the repo; an optional initial password is hashed here (strong policy
    // already enforced by the schema), else the admin sets it later via POST /:id/password.
    const passwordHash = v.password ? await hashPassword(v.password) : undefined;
    return repo.create(
      {
        username: v.username,
        name: v.name,
        email: v.email ?? null,
        phone: v.phone ?? null,
        departmentId: v.departmentId ?? null,
        designationId: v.designationId ?? null,
        role: v.role,
        reportsTo: v.reportsTo ?? null,
        effectiveFrom: v.effectiveFrom,
        ...(passwordHash !== undefined ? { passwordHash } : {}),
      },
      userId,
    );
  },

  /** Import (B-14): download template / preview (validate, no writes) / confirm (process valid rows).
   *  Confirm reuses the audited `userService.create` per row (which maps fields + sets reportsTo null
   *  when absent), so each imported row also appends an audit_log CREATE; a duplicate username is
   *  reported per-row and never blocks the others. */
  importTemplate: () => buildTemplate(USER_IMPORT_SPEC),
  importPreview: (file: Buffer) => runImportPreview(file, USER_IMPORT_SPEC),
  importConfirm: (file: Buffer, userId: string, fileName: string | undefined) =>
    runImportConfirm(
      file,
      USER_IMPORT_SPEC,
      async (input) => {
        await userService.create(input, userId);
      },
      { userId, fileName },
    ),

  async update(id: string, input: unknown, userId: string): Promise<User> {
    const v = UpdateUserSchema.parse(input); // field validation (400 VALIDATION)
    const expectedVersion = requireVersion(input); // OCC token (400 VERSION_REQUIRED)
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('USER_NOT_FOUND');
    // ADR-0020: username is a login rename (no FK dependents — refs are by uuid); pass when changed.
    const usernameChanged = v.username !== undefined && v.username !== existing.username;
    return repo.update(
      id,
      {
        ...(usernameChanged ? { username: v.username } : {}),
        name: v.name,
        role: v.role,
        email: v.email === undefined ? existing.email : v.email,
        phone: v.phone === undefined ? existing.phone : v.phone,
        departmentId: v.departmentId === undefined ? existing.departmentId : v.departmentId,
        designationId: v.designationId === undefined ? existing.designationId : v.designationId,
        reportsTo: v.reportsTo === undefined ? existing.reportsTo : v.reportsTo,
        effectiveFrom: v.effectiveFrom,
        ...(v.mfaRequired === undefined ? {} : { mfaRequired: v.mfaRequired }),
      },
      userId,
      expectedVersion,
      existing,
    );
  },

  /** Self-profile read — the caller's own joined view (employee id, role, manager/department names). */
  async selfProfile(id: string): Promise<UserView> {
    const view = await repo.profileView(id);
    if (!view) throw AppError.notFound('USER_NOT_FOUND');
    return view;
  },

  /** Self-service contact edit — validate + apply only the caller's own email/phone. Reuses the shared
   *  zod contract; existing values are kept when a field is omitted (PATCH semantics). */
  async updateSelfContact(id: string, input: unknown): Promise<User> {
    const v = UpdateSelfProfileSchema.parse(input);
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('USER_NOT_FOUND');
    return repo.updateSelfContact(
      id,
      {
        email: v.email === undefined ? existing.email : v.email,
        phone: v.phone === undefined ? existing.phone : v.phone,
      },
      existing,
    );
  },

  /** Admin set/reset a password. `mustChange` issues it as a one-time password (forced change on
   *  first login — the "Set a password" reset mode); otherwise it's a permanent set. */
  async setPassword(id: string, input: unknown, userId: string): Promise<void> {
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('USER_NOT_FOUND');
    const { password, mustChange } = SetPasswordSchema.parse(input);
    await repo.setPasswordHash(id, await hashPassword(password), userId, mustChange ?? false);
  },

  /** Admin "generate one-time password": mint a strong random password, store it must-change, and
   *  deliver it — `view` returns the plaintext to show ONCE; `email` sends it to the user and omits the
   *  plaintext on success. Email falls back to returning the plaintext when there is no address or SMTP
   *  is unconfigured, so a reset never strands the account with an undelivered password (ADR-0021). */
  async generateTempPassword(
    id: string,
    userId: string,
    deliver: 'view' | 'email' = 'view',
  ): Promise<{ temporaryPassword?: string; emailed: boolean }> {
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('USER_NOT_FOUND');
    const temporaryPassword = generateTempPassword();
    await repo.setPasswordHash(id, await hashPassword(temporaryPassword), userId, true);
    const emailed =
      deliver === 'email' && existing.email
        ? await getMailer().send({
            to: existing.email,
            subject: 'Your CRM2 one-time password',
            text:
              `Hello ${existing.name},\n\nAn administrator set a one-time password for your CRM2 ` +
              `account (${existing.username}):\n\n  ${temporaryPassword}\n\nYou will be asked to choose ` +
              `a new password the first time you sign in.`,
          })
        : false;
    // On a successful email the password travels only by email; otherwise surface it so the admin can
    // deliver it manually (view mode, or an email that could not be sent).
    return emailed ? { emailed: true } : { temporaryPassword, emailed: false };
  },

  /** Profile photo (slice 7): validate the image by magic bytes + size, store it in object storage
   *  under a server-minted key, persist the key, and delete any previous object. Returns a signed URL.
   *  Throws STORAGE_NOT_CONFIGURED (503) when the deployment has no bucket (deferred-activation). */
  async setPhoto(id: string, bytes: Buffer, userId: string): Promise<{ url: string }> {
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('USER_NOT_FOUND');
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES)
      throw AppError.badRequest('INVALID_IMAGE', { reason: 'size' });
    const image = detectImage(bytes);
    if (!image) throw AppError.badRequest('INVALID_IMAGE', { reason: 'type' });
    const storage = getStorage();
    const key = `users/${id}/${randomUUID()}.${image.ext}`;
    await storage.put(key, bytes, image.type); // throws 503 here when unconfigured — before any DB write
    const prev = await repo.setPhotoKey(id, key, userId);
    if (prev?.previousKey) await storage.remove(prev.previousKey); // best-effort orphan cleanup
    return { url: await storage.signedUrl(key) };
  },

  /** A time-limited URL to the user's current photo. 404 when they have none. */
  async photoUrl(id: string): Promise<{ url: string }> {
    const key = await repo.photoKeyById(id);
    if (!key) throw AppError.notFound('NO_PHOTO');
    return { url: await getStorage().signedUrl(key) };
  },

  /** Admin unlock — clear a lockout from too many failed logins. */
  async unlock(id: string, userId: string): Promise<void> {
    await repo.unlock(id, userId);
  },

  activate: (id: string, version: number, userId: string) => repo.setActive(id, true, userId, version),
  deactivate: (id: string, version: number, userId: string) => repo.setActive(id, false, userId, version),

  /** Bulk (de)activate — per-row OCC, per-row result (CONCURRENCY_AND_EDITING_STANDARD §1). Reuses
   *  the same version-guarded `repo.setActive`; a row changed since selection comes back CONFLICT.
   *  id is a uuid (string) — passed through as a string, never Number()'d. */
  bulkSetActive(body: unknown, isActive: boolean, userId: string) {
    const items = parseBulkItems(body, 'uuid');
    return applyBulkOcc(items, (id, version) => repo.setActive(String(id), isActive, userId, version));
  },
};
