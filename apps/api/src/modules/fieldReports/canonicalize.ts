import type { TaskRenderContext } from './repository.js';

/**
 * FIELD_REPORT render-time canonicalization (ADR-0057). The v2-native mobile contract (ADR-0054) submits
 * the outcome as one of 5 uppercase CODES + a per-type status field, and splits every tenure into
 * `<base>Value` + `<base>Unit`. The v1-ported default templates branch on the v1 VERBOSE labels
 * (`"Positive & Door Open"`, …) and read a single combined period token. Without this shim, no
 * `{{#eq outcome …}}` branch matches and every tenure clause renders empty.
 *
 * This rebuilds, for each form-type slug, the verbose label (from code + status field) and the combined
 * period tokens — on a CLONE of the loaded context, never on stored data (the verbatim-storage freeze
 * holds). It is pure, idempotent, and backward-compatible: a `verificationOutcome` that is already a
 * verbose label (legacy/v1 data, admin-authored) is left verbatim; only the 5 known codes are derived.
 * The raw-fields section view (sections.ts) is unaffected — it keeps showing exactly what was captured.
 */

/** The v2-native device outcome codes (ADR-0054). Only these are derived; anything else is left as-is. */
const OUTCOME_CODES = new Set(['POSITIVE', 'SHIFTED', 'NSP', 'ENTRY_RESTRICTED', 'UNTRACEABLE']);

/** Per-slug door-status field (v1 `formTypeDetection.ts:469-501`). `Open` (case-insensitive) → "Door
 *  Open", anything else (Closed/Locked/absent) → "Door Locked". property-apf has no door field (its
 *  Positive/Negative split is verdict-driven); property-individual uses flatStatus (fallback premises). */
const STATUS_FIELD: Record<string, string> = {
  residence: 'houseStatus',
  office: 'officeStatus',
  builder: 'officeStatus',
  noc: 'officeStatus',
  'dsa-connector': 'officeStatus',
  business: 'businessStatus',
  'residence-cum-office': 'resiCumOfficeStatus',
  'property-individual': 'flatStatus',
};

/** The 9 locked device form-type slugs canonicalize knows (the 8 door/piv families + property-apf —
 *  mirrors verification-tasks FORM_TYPE_SLUGS). Only these are derived; any other top-level key (a
 *  custom/admin template structure) is passed through verbatim so its `outcome` vocabulary is its own. */
const KNOWN_SLUGS: ReadonlySet<string> = new Set([...Object.keys(STATUS_FIELD), 'property-apf']);

/** Tenure bases the templates read combined; the device splits each into `<base>Value` + `<base>Unit`. */
const PERIOD_BASES = [
  'stayingPeriod',
  'shiftedPeriod',
  'businessPeriod',
  'workingPeriod',
  'establishmentPeriod',
  'currentCompanyPeriod',
  'oldOfficeShiftedPeriod',
] as const;

const str = (x: unknown): string => (x == null || typeof x === 'object' ? '' : String(x).trim());

const doorSuffix = (statusVal: unknown): string =>
  str(statusVal).toLowerCase() === 'open' ? ' & Door Open' : ' & Door Locked';

/** Derive the v1 verbose label for one (slug, code) from the form fields, or null to leave verbatim. */
function deriveLabel(slug: string, code: string, formData: Record<string, unknown>): string | null {
  if (code === 'ENTRY_RESTRICTED') return 'ERT';
  if (code === 'UNTRACEABLE') return 'Untraceable';
  if (slug === 'property-apf') {
    const verdict = (str(formData['finalStatus']) || str(formData['finalStatusNegative'])).toLowerCase();
    return verdict.startsWith('negative') ? 'Negative' : 'Positive';
  }
  const statusVal =
    slug === 'property-individual'
      ? str(formData['flatStatus']) || str(formData['premisesStatus'])
      : STATUS_FIELD[slug]
        ? formData[STATUS_FIELD[slug]!]
        : undefined;
  const prefix =
    code === 'POSITIVE' ? 'Positive' : code === 'SHIFTED' ? 'Shifted' : code === 'NSP' ? 'NSP' : null;
  return prefix == null ? null : prefix + doorSuffix(statusVal);
}

/** Return a render context whose form blob is canonicalized for the v1-vocabulary templates (ADR-0057).
 *  The input ctx is not mutated. */
export function canonicalizeRenderContext(ctx: TaskRenderContext): TaskRenderContext {
  const fd = ctx.formData;
  if (!fd || typeof fd !== 'object') return ctx;

  const outFd: Record<string, unknown> = {};
  for (const [slug, raw] of Object.entries(fd)) {
    if (!KNOWN_SLUGS.has(slug) || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      outFd[slug] = raw;
      continue;
    }
    const blob = { ...(raw as Record<string, unknown>) };
    const inner = blob['formData'];
    const innerObj =
      inner && typeof inner === 'object' && !Array.isArray(inner)
        ? { ...(inner as Record<string, unknown>) }
        : null;
    // the device keeps fields under `.formData`; fall back to the blob itself if that nesting is absent.
    const formData = innerObj ?? blob;

    // (1) outcome code → v1 verbose label (only the 5 known codes; everything else stays verbatim).
    const code = str(blob['verificationOutcome']).toUpperCase();
    if (OUTCOME_CODES.has(code)) {
      const label = deriveLabel(slug, code, formData);
      if (label) blob['verificationOutcome'] = label;
    }
    // APF: surface the negative-path verdict so `final_status` isn't dropped (v1 parity).
    if (slug === 'property-apf') {
      const verdict = str(formData['finalStatus']) || str(formData['finalStatusNegative']);
      if (verdict) formData['finalStatus'] = verdict;
    }
    // (2) recombine the split tenure fields into the combined token the templates read.
    for (const base of PERIOD_BASES) {
      if (str(formData[base])) continue;
      const val = str(formData[`${base}Value`]);
      if (!val) continue;
      const unit = str(formData[`${base}Unit`]);
      formData[base] = unit ? `${val} ${unit}` : val;
    }

    if (innerObj) blob['formData'] = innerObj;
    outFd[slug] = blob;
  }
  return { ...ctx, formData: outFd };
}
