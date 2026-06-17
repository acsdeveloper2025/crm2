import { SaveDataEntrySchema, SavePickupSchema, type CaseDataEntry, type CasePickup } from '@crm2/sdk';
import { caseDataEntryRepository as repo } from './repository.js';
import type { PickupInput, PickupRow } from './repository.js';
import { reportLayoutRepository } from '../reportLayouts/repository.js';
import { AppError } from '../../platform/errors.js';
import { requireVersion } from '../../platform/occ.js';
import { resolveScope, type Actor } from '../../platform/scope/index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Office data-entry service (ADR-0037 slice 3) — key a CASE's MIS fields against its (client,product)
 * active DATA_ENTRY layout (Zion `NewDataQC` keys these per case, not per task). Every read/write is
 * scope-guarded (an out-of-scope/absent case → 404, IDOR-safe) and gated `data_entry.manage` at the
 * route. Saves are validated against the layout (required columns present; unknown keys dropped) and
 * OCC-guarded once an entry exists.
 */
export const caseDataEntryService = {
  async get(caseId: string, actor: Actor): Promise<CaseDataEntry> {
    if (!UUID_RE.test(caseId)) throw AppError.badRequest('BAD_REQUEST', { param: 'caseId' });
    const scope = await resolveScope(actor);
    const c = await repo.caseScope(caseId, scope);
    if (!c) throw AppError.notFound('CASE_NOT_FOUND');
    const layout = await reportLayoutRepository.findActiveByConfig(c.clientId, c.productId, 'DATA_ENTRY');
    const entry = await repo.findByCase(caseId);
    return { caseId, layout, entry };
  },

  async save(caseId: string, input: unknown, actor: Actor): Promise<CaseDataEntry> {
    if (!UUID_RE.test(caseId)) throw AppError.badRequest('BAD_REQUEST', { param: 'caseId' });
    const v = SaveDataEntrySchema.parse(input); // ZodError → 400
    const scope = await resolveScope(actor);
    const c = await repo.caseScope(caseId, scope);
    if (!c) throw AppError.notFound('CASE_NOT_FOUND');
    const layout = await reportLayoutRepository.findActiveByConfig(c.clientId, c.productId, 'DATA_ENTRY');
    if (!layout) throw AppError.badRequest('DATA_ENTRY_LAYOUT_NOT_CONFIGURED');

    // Validate against the layout: required columns must be present; only known column_keys are kept.
    const supplied = v.data as Record<string, unknown>;
    const clean: Record<string, unknown> = {};
    for (const col of layout.columns) {
      const val = supplied[col.columnKey];
      if (col.isRequired && (val === undefined || val === null || val === ''))
        throw AppError.badRequest('DATA_ENTRY_REQUIRED', { field: col.columnKey });
      if (val !== undefined) clean[col.columnKey] = val;
    }

    const existing = await repo.findByCase(caseId);
    const saved = existing
      ? await repo.update(caseId, clean, actor.userId, requireVersion(input))
      : await repo.insert(caseId, layout.id, clean, actor.userId);
    return { caseId, layout, entry: saved };
  },

  // ── Pickup Information (fixed per-case box) ──

  async getPickup(caseId: string, actor: Actor): Promise<CasePickup> {
    if (!UUID_RE.test(caseId)) throw AppError.badRequest('BAD_REQUEST', { param: 'caseId' });
    const scope = await resolveScope(actor);
    const c = await repo.caseScope(caseId, scope);
    if (!c) throw AppError.notFound('CASE_NOT_FOUND');
    const ctx = await repo.pickupContext(caseId);
    const pickup = await repo.findPickupByCase(caseId);
    return buildPickup(caseId, ctx, pickup);
  },

  async savePickup(caseId: string, input: unknown, actor: Actor): Promise<CasePickup> {
    if (!UUID_RE.test(caseId)) throw AppError.badRequest('BAD_REQUEST', { param: 'caseId' });
    const v = SavePickupSchema.parse(input); // ZodError → 400
    const scope = await resolveScope(actor);
    const c = await repo.caseScope(caseId, scope);
    if (!c) throw AppError.notFound('CASE_NOT_FOUND');

    const fields: PickupInput = {
      pickupDate: v.pickupDate ?? null,
      reportedDate: v.reportedDate ?? null,
      pickupTrigger: v.pickupTrigger ?? null,
      samplerName: v.samplerName ?? null,
      visitDateTime: v.visitDateTime ?? null,
    };
    const existing = await repo.findPickupByCase(caseId);
    const saved = existing
      ? await repo.updatePickup(caseId, fields, actor.userId, requireVersion(input))
      : await repo.insertPickup(caseId, fields, actor.userId);
    const ctx = await repo.pickupContext(caseId);
    return buildPickup(caseId, ctx, saved);
  },
};

const MS_PER_DAY = 86_400_000;

/** Assemble the CasePickup view: derived context + computed TIME OF VERIFICATION (whole days between
 *  pickup and reported, null until both are set). */
function buildPickup(
  caseId: string,
  ctx: { bankName: string; pickupForDocuments: string },
  pickup: PickupRow | null,
): CasePickup {
  let timeOfVerificationDays: number | null = null;
  if (pickup?.pickupDate && pickup.reportedDate) {
    const diff = Date.parse(pickup.reportedDate) - Date.parse(pickup.pickupDate);
    if (!Number.isNaN(diff)) timeOfVerificationDays = Math.max(0, Math.floor(diff / MS_PER_DAY));
  }
  return {
    caseId,
    bankName: ctx.bankName,
    pickupForDocuments: ctx.pickupForDocuments,
    timeOfVerificationDays,
    pickup,
  };
}
