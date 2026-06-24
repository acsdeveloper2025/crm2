import type { FieldReportSection, FieldReportField } from '@crm2/sdk';
import { SECTION_MAP } from './sectionMap.js';
import { PERIOD_BASES } from './canonicalize.js';

/**
 * Build the display-ready raw-field sections for a task's submitted `form_data` (ADR-0039 R1 — the v1
 * `createComprehensiveFormSections` parity). For a KNOWN form-type slug (one of the 9 in `SECTION_MAP`),
 * emit v1-style ordered, grouped, human-labelled sections per the spec
 * (`docs/engineering/field-report-section-grouping-2026-06-22.md`); any submitted key the map does not
 * place falls into a trailing "Additional Details" section so NO field is ever lost (the audited
 * never-lose-a-field invariant). For an UNKNOWN/custom slug, fall back to the generic single-section
 * flatten (one section titled from the slug). System/bulky keys (photos, attachments, geo, metadata)
 * are skipped — photos live in the Field Photos card (#7). Empty input → no sections.
 *
 * Device blob shape (per the verification-tasks ingest): `form_data[<slug>] = { formData: {...keyed
 * fields}, verificationOutcome, photos, attachmentIds, geoLocation, metadata }`. We surface the keyed
 * `formData` fields + the raw `verificationOutcome`. Defensive: if a slug's value is already a flat
 * object (no nested `formData`), we use it directly.
 */

// System/envelope keys that ride alongside the agent's fields (confirmed against live v1
// form_submissions.submission_data — see 2026-06-16-v1-report-mapping.md §1) — never displayed.
const SKIP_KEYS = new Set([
  'photos',
  'attachments',
  'attachmentids',
  'geolocation',
  'metadata',
  'formdata',
  'formtype',
  'submissionid',
  'submittedat',
  'submittedby',
  'verification',
  'verificationimages',
]);

/** camelCase / snake_case → "Title Case" (e.g. customerName → "Customer Name"). */
export function toLabel(key: string): string {
  const spaced = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
  return spaced
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Render a leaf value to a display string. Primitives → String; arrays of primitives → ", "-joined;
 * nested objects / arrays-of-objects return null here so they're dropped.
 *
 * WONTFIX (verified 2026-06-18 vs v1 real data — `acs_db_final_version.sql`): dropping nested
 * objects/object-arrays loses NO agent answer. The device form catalog is flat by construction — every
 * field in `LegacyFormTemplateBuilders.ts` is type text/number/select/multiselect/date/textarea/etc.,
 * never an object/group/table field (see `FormFieldTemplate.type`, crm-mobile-native types/api.ts:389).
 * A full scan of all 93 `form_submissions.submission_data` + 92 `cases.verification_data` blobs: the
 * agent-answer leaves under `.formData` are exclusively int / string / list-of-primitives — ZERO nested
 * objects and ZERO arrays-of-objects. The only nested values that exist are envelope/geo metadata
 * (`geoLocation`, `verification`, `submissionLocation` {lat,long,accuracy,timestamp}, `metadata`,
 * `photos`) — all in SKIP_KEYS or under the skipped `verification` key, and surfaced by the Field Photos
 * card, not here. So this projection only ever drops metadata, never a submitted field.
 */
function toValue(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) {
    const parts = v.filter((x) => x !== null && x !== undefined && typeof x !== 'object').map(String);
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof v === 'object') return null;
  return String(v);
}

/**
 * Recombine the device's split tenure fields (`<base>Value` + `<base>Unit`) into the combined `<base>`
 * token the section map keys, and drop the consumed split keys so they don't spill into the trailing
 * "Additional Details" catch-all (audit A2026-0623-01). Returns a shallow clone — the stored blob is
 * never mutated (verbatim-storage freeze). Mirrors the narrative-path recombine in canonicalize.ts so
 * the raw-sections and narrative report surfaces agree.
 */
function recombinePeriods(src: Record<string, unknown>): Record<string, unknown> {
  const out = { ...src };
  for (const base of PERIOD_BASES) {
    if (toValue(out[base]) !== null) continue; // already combined (legacy/v1) → leave splits verbatim
    const val = toValue(out[`${base}Value`]);
    if (val === null) continue;
    const unit = toValue(out[`${base}Unit`]);
    out[base] = unit !== null ? `${val} ${unit}` : val;
    delete out[`${base}Value`];
    delete out[`${base}Unit`];
  }
  return out;
}

/** Flatten one object's primitive fields into display rows (skipping system/bulky keys). */
function flatten(obj: Record<string, unknown>): FieldReportField[] {
  const fields: FieldReportField[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (SKIP_KEYS.has(k.toLowerCase())) continue;
    const value = toValue(v);
    if (value !== null) fields.push({ label: toLabel(k), value });
  }
  return fields;
}

/**
 * Generic single-section fallback for an unknown/custom slug: flatten the agent fields under one
 * heading derived from the slug, then append the raw outcome row (the pre-SECTION_MAP behavior).
 */
function genericSection(
  slug: string,
  fieldsSource: Record<string, unknown>,
  outcome: string | null,
): FieldReportSection | null {
  const fields = flatten(fieldsSource);
  if (outcome !== null) fields.push({ label: 'Verification Outcome', value: outcome });
  return fields.length ? { title: toLabel(slug), fields } : null;
}

/**
 * Mapped grouping for a known slug: emit the spec's named sections in order, deduping each `ref` to one
 * row across the whole slug (first occurrence wins — the spec lists the primary/non-ERT field first).
 * The raw outcome row leads the first emitted section. Any submitted key the map never placed (and not
 * a system/bulky key) is collected into a trailing "Additional Details" section so no field is lost.
 */
function mappedSections(
  defs: ReadonlyArray<{ title: string; fields: ReadonlyArray<{ ref: string; label: string }> }>,
  fieldsSource: Record<string, unknown>,
  outcome: string | null,
): FieldReportSection[] {
  const sections: FieldReportSection[] = [];
  const placed = new Set<string>();
  for (const def of defs) {
    const fields: FieldReportField[] = [];
    for (const { ref, label } of def.fields) {
      if (placed.has(ref)) continue;
      const value = toValue(fieldsSource[ref]);
      if (value === null) continue;
      placed.add(ref);
      fields.push({ label, value });
    }
    if (fields.length) sections.push({ title: def.title, fields });
  }
  // Lead the first emitted section with the raw outcome (spec puts Verification Outcome first).
  if (outcome !== null) {
    const outcomeRow: FieldReportField = { label: 'Verification Outcome', value: outcome };
    if (sections.length) sections[0]!.fields.unshift(outcomeRow);
    else sections.push({ title: defs[0]?.title ?? 'Verification Outcome & Status', fields: [outcomeRow] });
  }
  // Never-lose-a-field: every remaining submitted key not in the map (and not a system key).
  // `verificationOutcome` is already surfaced as the leading outcome row (relevant only in the
  // flat-blob fallback where it sits in `fieldsSource`), so never re-emit it here.
  const extra: FieldReportField[] = [];
  for (const [k, v] of Object.entries(fieldsSource)) {
    if (placed.has(k) || SKIP_KEYS.has(k.toLowerCase()) || k.toLowerCase() === 'verificationoutcome')
      continue;
    const value = toValue(v);
    if (value !== null) extra.push({ label: toLabel(k), value });
  }
  if (extra.length) sections.push({ title: 'Additional Details', fields: extra });
  return sections;
}

export function buildSections(formData: Record<string, unknown> | null | undefined): FieldReportSection[] {
  if (!formData || typeof formData !== 'object') return [];
  const sections: FieldReportSection[] = [];
  for (const [slug, raw] of Object.entries(formData)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const blob = raw as Record<string, unknown>;
    // the agent-keyed fields live under `.formData`; fall back to the blob itself if absent.
    const keyed = blob['formData'];
    const fieldsSource =
      keyed && typeof keyed === 'object' && !Array.isArray(keyed) ? (keyed as Record<string, unknown>) : blob;
    // Recombine split tenure (<base>Value/<base>Unit → <base>) before mapping so named period rows
    // populate and the split keys don't leak into "Additional Details" (audit A2026-0623-01).
    const recombined = recombinePeriods(fieldsSource);
    const outcome = toValue(blob['verificationOutcome']);
    const defs = SECTION_MAP[slug];
    if (defs) {
      sections.push(...mappedSections(defs, recombined, outcome));
    } else {
      const generic = genericSection(slug, recombined, outcome);
      if (generic) sections.push(generic);
    }
  }
  return sections;
}
