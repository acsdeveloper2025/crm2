import { z } from 'zod';
import { AssignScopeSchema, type UserScopeAssignments } from '@crm2/sdk';
import { AppError } from '../../platform/errors.js';
import { dimensionDef } from '../../platform/scope/dimensions.js';
import { scopeAssignmentRepository as repo, type ScopeExportRow } from './repository.js';
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
  type ImportSpec,
  type ResolveResult,
} from '../../platform/import/index.js';

// file-cell caps (mirror users.username varchar(50) / scope_dimensions.code varchar(32) / value text)
const MAX_USERNAME_LEN = 50;
const MAX_DIMENSION_LEN = 32;
const MAX_ENTITY_LEN = 200;

/** Bulk-assignment file row (IMPORT_EXPORT_STANDARD): who, which dimension, which entity. */
const ScopeImportFileSchema = z.object({
  username: z.string().trim().min(1).max(MAX_USERNAME_LEN),
  dimension: z
    .string()
    .trim()
    .min(1)
    .max(MAX_DIMENSION_LEN)
    .transform((s) => s.toUpperCase()),
  entity: z.string().trim().min(1).max(MAX_ENTITY_LEN),
});
type ScopeImportFile = z.infer<typeof ScopeImportFileSchema>;

interface ScopeImportInput {
  userId: string;
  dimension: string;
  entityIds?: number[];
  entityValues?: string[];
}

/** Resolve one file row → the assignment input; every failure is a per-row, per-column error
 *  (runs in preview AND confirm, so the operator sees resolution problems before writing). */
async function resolveImportRow(row: ScopeImportFile): Promise<ResolveResult<ScopeImportInput>> {
  const def = dimensionDef(row.dimension);
  if (!def) return { ok: false, errors: [{ column: 'Dimension', message: `unknown dimension` }] };
  const userId = await repo.userIdByUsername(row.username);
  if (!userId) return { ok: false, errors: [{ column: 'Username', message: 'unknown or inactive user' }] };
  const role = (await repo.targetRole(userId))!;
  const allowed = await repo.roleDimensions(role);
  if (!allowed.has(row.dimension))
    return {
      ok: false,
      errors: [{ column: 'Dimension', message: `not enabled for the user's role (${role})` }],
    };
  if (def.entityKind === 'VALUE') {
    const found = await repo.existingValues(def, [row.entity]);
    if (found.length === 0)
      return { ok: false, errors: [{ column: 'Entity', message: 'unknown state/city value' }] };
    return { ok: true, value: { userId, dimension: row.dimension, entityValues: [found[0]!] } };
  }
  if (row.dimension === 'PINCODE') {
    // a postal pincode spans many (pincode, area) rows — assigning it means ALL of them
    const ids = await repo.locationIdsByPincode(row.entity);
    if (ids.length === 0) return { ok: false, errors: [{ column: 'Entity', message: 'unknown pincode' }] };
    return { ok: true, value: { userId, dimension: row.dimension, entityIds: ids } };
  }
  if (row.dimension === 'AREA') {
    const [pincode, ...areaParts] = row.entity.split(':');
    const area = areaParts.join(':').trim();
    if (!pincode || !area)
      return { ok: false, errors: [{ column: 'Entity', message: 'use the form PINCODE:AREA' }] };
    const id = await repo.locationIdByPincodeArea(pincode.trim(), area);
    if (id === undefined)
      return { ok: false, errors: [{ column: 'Entity', message: 'unknown pincode:area pair' }] };
    return { ok: true, value: { userId, dimension: row.dimension, entityIds: [id] } };
  }
  const id = await repo.catalogIdByCode(def, row.entity);
  if (id === undefined)
    return { ok: false, errors: [{ column: 'Entity', message: `unknown ${def.code} code` }] };
  return { ok: true, value: { userId, dimension: row.dimension, entityIds: [id] } };
}

const SCOPE_IMPORT_SPEC: ImportSpec<ScopeImportFile, ScopeImportInput> = {
  resource: 'user_scope_assignments',
  columns: [
    { id: 'username', header: 'Username', required: true },
    { id: 'dimension', header: 'Dimension', required: true },
    { id: 'entity', header: 'Entity', required: true },
  ],
  schema: ScopeImportFileSchema,
  sample: { username: 'jdoe', dimension: 'PINCODE', entity: '400001' },
  resolve: resolveImportRow,
};

const SCOPE_EXPORT_COLUMNS: ExportColumn<ScopeExportRow>[] = [
  { id: 'username', header: 'Username', value: (r) => r.username },
  { id: 'name', header: 'Name', value: (r) => r.name },
  { id: 'role', header: 'Role', value: (r) => r.role },
  { id: 'dimension', header: 'Dimension', value: (r) => r.dimensionCode },
  { id: 'entity', header: 'Entity', value: (r) => r.label },
  { id: 'assignedAt', header: 'Assigned At', value: (r) => r.createdAt },
];

/**
 * Generic scope assignment (ADR-0022 slice 3) — replaces the dimension-specific territory and
 * portfolio modules. What a user may be assigned is governed entirely by their ROLE's dimension
 * wiring (`role_scope_dimensions`, admin data) — no role names here. References are validated
 * against the dimension's catalog before insert (the generic table carries no per-dimension FK).
 */
export const scopeAssignmentService = {
  get: (userId: string): Promise<UserScopeAssignments> => repo.listForUser(userId),

  async add(userId: string, input: unknown, assignedBy: string): Promise<UserScopeAssignments> {
    const { dimension, entityIds, entityValues } = AssignScopeSchema.parse(input);
    const def = dimensionDef(dimension);
    if (!def) throw AppError.badRequest('UNKNOWN_DIMENSION', { dimension });

    const role = await repo.targetRole(userId);
    if (role === undefined) throw AppError.notFound('USER_NOT_FOUND');
    const allowed = await repo.roleDimensions(role);
    if (!allowed.has(dimension))
      throw AppError.badRequest('DIMENSION_NOT_ALLOWED_FOR_ROLE', { dimension, role });

    if (def.entityKind === 'ID') {
      if (!entityIds?.length) throw AppError.badRequest('BAD_REQUEST', { expected: 'entityIds' });
      const found = await repo.existingIds(def, entityIds);
      const missing = entityIds.filter((id) => !found.includes(id));
      if (missing.length > 0) throw AppError.badRequest('INVALID_REFERENCE', { dimension, missing });
    } else {
      if (!entityValues?.length) throw AppError.badRequest('BAD_REQUEST', { expected: 'entityValues' });
      const found = await repo.existingValues(def, entityValues);
      const missing = entityValues.filter((v) => !found.includes(v));
      if (missing.length > 0) throw AppError.badRequest('INVALID_REFERENCE', { dimension, missing });
    }

    const before = await repo.listForUser(userId);
    await repo.add(
      userId,
      dimension,
      def.entityKind === 'ID' ? { entityIds: entityIds! } : { entityValues: entityValues! },
      assignedBy,
      before,
    );
    return repo.listForUser(userId);
  },

  async remove(userId: string, assignmentId: number, actorId: string): Promise<UserScopeAssignments> {
    await repo.remove(userId, assignmentId, actorId); // owner-scoped; a miss is a silent no-op
    return repo.listForUser(userId);
  },

  // ── bulk assignment (IMPORT_EXPORT_STANDARD): template → preview → confirm + export ──
  importTemplate: () => buildTemplate(SCOPE_IMPORT_SPEC),
  importPreview: (file: Buffer) => runImportPreview(file, SCOPE_IMPORT_SPEC),
  importConfirm: (file: Buffer, actorId: string, fileName: string | undefined) =>
    runImportConfirm(
      file,
      SCOPE_IMPORT_SPEC,
      async (input) => {
        const before = await repo.listForUser(input.userId);
        await repo.add(
          input.userId,
          input.dimension,
          {
            ...(input.entityIds ? { entityIds: input.entityIds } : {}),
            ...(input.entityValues ? { entityValues: input.entityValues } : {}),
          },
          actorId,
          before,
        );
      },
      { userId: actorId, fileName },
    ),

  /** Every active assignment, labels resolved — streamed by the controller as a file. */
  async exportData(ex: ResolvedExport) {
    const rows = await repo.allForExport(exportThreshold());
    if (ex.mode === 'all') assertExportable(rows.length);
    return { rows, columns: SCOPE_EXPORT_COLUMNS };
  },
};
