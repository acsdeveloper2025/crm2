import type { FieldReportSection, FieldReportField } from '@crm2/sdk';

/**
 * Build the display-ready raw-field sections for a task's submitted `form_data` (ADR-0039 R1 — the v1
 * `createComprehensiveFormSections` parity). GENERIC introspection of whatever the device submitted (no
 * per-type schema): one section per top-level form-type slug, its agent-keyed fields flattened to
 * `Label: value` rows. System/bulky keys (photos, attachments, geo, metadata) are skipped — photos live
 * in the Field Photos card (#7). Empty input → no sections.
 *
 * Device blob shape (per the verification-tasks ingest): `form_data[<slug>] = { formData: {...keyed
 * fields}, verificationOutcome, photos, attachmentIds, geoLocation, metadata }`. We surface the keyed
 * `formData` fields + `verificationOutcome`. Defensive: if a slug's value is already a flat object (no
 * nested `formData`), we flatten it directly.
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
    const fields = flatten(fieldsSource);
    // surface the evidence outcome alongside the keyed fields when present.
    const outcome = toValue(blob['verificationOutcome']);
    if (outcome !== null) fields.push({ label: 'Verification Outcome', value: outcome });
    if (fields.length) sections.push({ title: toLabel(slug), fields });
  }
  return sections;
}
