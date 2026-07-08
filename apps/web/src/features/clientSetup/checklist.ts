/**
 * Client Setup hub (ADR-0092 S3) — completeness checklist. Pure, testable without React; the hub
 * page wires these to 4 shared-root TanStack queries (checklist.ts has no query/fetch code itself).
 */

/** `null` = unknown/not-fetchable (query loading, errored, or gated off) → chip renders "—", never a
 *  fabricated 0. */
export interface SetupCounts {
  cpvLinks: number | null;
  cpvUnits: number | null;
  rateTypeAssignments: number | null;
  rates: number | null;
  commissionRates: number | null;
}

export type StepState = 'blocked' | 'incomplete' | 'complete' | 'skipped';

const isPositive = (n: number | null): boolean => n !== null && n > 0;

/**
 * Step 1 (Products & CPV units) never blocks. Step 2 (Rate types) and step 4 (Commission rates)
 * block on `cpvLinks === 0` (no client-product link to hang a rate type / commission rate off of);
 * step 3 (Rates) blocks on `cpvUnits === 0` (rates are per verification unit). `null` (unknown) never
 * blocks — only a confirmed zero does; a non-blocked step is 'complete' when its own count(s) are
 * known-positive, else 'incomplete' (a null count is honestly reported as incomplete, not complete).
 * Step 4 is 'skipped' outright when the viewer lacks `masterdata.manage`, regardless of counts.
 */
export function deriveStepStates(c: SetupCounts, canManage: boolean): Record<1 | 2 | 3 | 4, StepState> {
  const step1: StepState = isPositive(c.cpvLinks) && isPositive(c.cpvUnits) ? 'complete' : 'incomplete';
  const step2: StepState =
    c.cpvLinks === 0 ? 'blocked' : isPositive(c.rateTypeAssignments) ? 'complete' : 'incomplete';
  const step3: StepState = c.cpvUnits === 0 ? 'blocked' : isPositive(c.rates) ? 'complete' : 'incomplete';
  const step4: StepState = !canManage
    ? 'skipped'
    : c.cpvLinks === 0
      ? 'blocked'
      : isPositive(c.commissionRates)
        ? 'complete'
        : 'incomplete';
  return { 1: step1, 2: step2, 3: step3, 4: step4 };
}

/** Step 1's unit count = sum of `unitCount` over the client's client-products (no per-client
 *  cpv-units endpoint exists — spec §3.3).
 *  ponytail: sums the first 500 links only (the hub reads page=1&limit=500 = server MAX_PAGE_SIZE);
 *  paginate to totalCount if any client ever exceeds 500 CPV links. */
export function sumUnitCounts(items: { unitCount: number }[]): number {
  return items.reduce((sum, i) => sum + i.unitCount, 0);
}

/** Chip glyph + tone per step state (mirrors the `STATUS_META` lookup-table pattern in
 *  @crm2/ui-theme): amber dot = incomplete, green check = complete, muted + lock = blocked/skipped. */
export const STEP_STATE_META: Record<StepState, { glyph: string; className: string }> = {
  complete: { glyph: '✓', className: 'text-success' },
  incomplete: { glyph: '•', className: 'text-warning' },
  blocked: { glyph: '🔒', className: 'text-muted-foreground' },
  skipped: { glyph: '🔒', className: 'text-muted-foreground' },
};

/** Per-step chip text: step 1 is `links · units`, steps 2-4 a single count; `null` renders "—". */
export function stepChipLabel(stepId: 1 | 2 | 3 | 4, c: SetupCounts): string {
  const fmt = (n: number | null): string => (n === null ? '—' : String(n));
  if (stepId === 1) return `${fmt(c.cpvLinks)} · ${fmt(c.cpvUnits)}`;
  if (stepId === 2) return fmt(c.rateTypeAssignments);
  if (stepId === 3) return fmt(c.rates);
  return fmt(c.commissionRates);
}
