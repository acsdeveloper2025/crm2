# ADR-0057: FIELD_REPORT renders v2-native device payloads (derive the verbose outcome label + recombine split periods at render time)

- **Status:** **Accepted · Shipped to prod 2026-06-22** (origin/main `836fed3`; pushed with the Issue-2 attachments fix; deploy gate green, blue-green deploy in progress). Owner-directed 2026-06-22 (owner + CTO). Verified end-to-end on a real device (live RESIDENCE submission → full v1-style narrative). Extends [ADR-0039](./ADR-0039-field-report-engine.md) (FIELD_REPORT engine); the engine itself is unchanged — this adds a render-time canonicalization shim. Aligns with [ADR-0054](./ADR-0054-v2-native-mobile-contract.md) (v2-native mobile contract). Touches a FROZEN engine — see [LONG_TERM_PROTECTION.md](../governance/LONG_TERM_PROTECTION.md).
- **Date:** 2026-06-22
- **Migrations:** none (no schema change; stored `form_data` is **never** mutated — the transform is read-time, in-memory only, on the loaded render context).

## Context — the bug (audit 2026-06-22)

The audit `docs/audit-2026-06-22/` found that the FIELD_REPORT **narrative renders empty for every real
device submission**, all 9 FIELD_VISIT types. Two systemic mismatches between the v2 mobile payload and the
v1-ported default templates (`packages/sdk/src/fieldReportDefaults.ts`):

1. **Outcome vocabulary.** Templates branch (strict `===`, helper `eq`) on v1 **verbose labels** —
   `"Positive & Door Open"`, `"Positive & Door Locked"`, `"Shifted & Door Open/Locked"`,
   `"NSP & Door Open/Locked"`, `"ERT"`, `"Untraceable"` (+ `"Positive"`/`"Negative"` for APF). The v2 app
   (post-ADR-0054 rewrite) submits one of **5 uppercase codes** in `verificationOutcome`
   (`POSITIVE`/`SHIFTED`/`NSP`/`ENTRY_RESTRICTED`/`UNTRACEABLE`) and **no** verbose label. The `outcome`
   column binds `<slug>.verificationOutcome` and resolves by plain dot-path (no normalization) → no branch
   ever matches → empty body. In v1 the **mobile** stored the full verbose label, so the v1 backend
   string-matched directly; the v2 mobile rewrite collapsed the label to a code.
2. **Period arity.** Templates read a single combined tenure token (`stayingPeriod` = `"6 Year"`); the v2
   device splits every tenure into `<base>Value` + `<base>Unit` and never emits the combined key → empty
   "for the last … years" clauses.

The unit tests are green because they feed v1-shaped fixtures (verbose label + combined period) the v2
device never sends. Verified against deployed code, the v1 source (`CRM-BACKEND`), and a real v1 dump.

Owner decision (2026-06-22): **build it all; reference the working v1 behavior; preserve the v1 8-way
door Open/Locked distinction** (option 3) rather than collapse templates to the 5 device codes. The device
still carries the door signal (`houseStatus: ['Open','Closed']` etc.), so the label is reconstructable.

## Decision

Add a **pure, read-time canonicalization** of the FIELD_REPORT render context (no stored-data change, no
device-contract change, no app re-release), applied in `fieldReports/service.ts` to a clone of the loaded
context **before** `renderNarrative`. The raw-fields section view (`buildSections`) is unchanged — it keeps
showing exactly what the device captured. The frozen FIELD_REPORT engine (resolver/renderer/templates) is
untouched.

### 1. Derive the verbose outcome label from `verificationOutcome` code + the per-type status field

Per the v1 contract (`CRM-BACKEND/src/utils/formTypeDetection.ts:469-501`,
`services/TemplateReportService.ts` `getTemplateKey`). For each form-type slug present in the blob, when
`verificationOutcome` is exactly one of the 5 device **codes**, overwrite it (in the clone) with the v1
verbose label; any other value (already a label, legacy/v1 data, admin-authored) is **left verbatim**
(idempotent, backward-compatible).

Door driver field per slug (door = `lc(status) === 'open'` → `" & Door Open"`, else `" & Door Locked"`):

| Slug | Status field | Family |
|---|---|---|
| residence | `houseStatus` | door (8-way) |
| office / builder / noc / dsa-connector | `officeStatus` | door (8-way) |
| business | `businessStatus` | door (8-way) |
| residence-cum-office | `resiCumOfficeStatus` | door (8-way) |
| property-individual | `flatStatus` (fallback `premisesStatus`) | piv (no Shifted) |
| property-apf | — | apf (verdict-driven) |

Code → label:
- `ENTRY_RESTRICTED` → `"ERT"`; `UNTRACEABLE` → `"Untraceable"` (no door variant, all families).
- door/piv families: `POSITIVE`→`"Positive"+door`, `SHIFTED`→`"Shifted"+door`, `NSP`→`"NSP"+door`.
- **APF:** `ENTRY_RESTRICTED`→`"ERT"`, `UNTRACEABLE`→`"Untraceable"`; otherwise the verdict
  `finalStatus || finalStatusNegative` — `lc` starts with `"negative"` → `"Negative"`, else `"Positive"`
  (Refer/Fraud render under the Positive branch via the `activityVerdict` helper; the Negative branch
  splits VACANT vs STOP internally via `apfVacant constructionActivity`). Also set
  `finalStatus = finalStatus || finalStatusNegative` so the Negative-form verdict reaches `final_status`.

### 2. Recombine split periods

For each base in `{stayingPeriod, shiftedPeriod, businessPeriod, workingPeriod, establishmentPeriod,
currentCompanyPeriod, oldOfficeShiftedPeriod}`: if the combined key is empty/absent and `<base>Value` is
non-empty, set `<base> = (\`${value} ${unit}\`).trim()`. The existing `pluralize` helper then finishes
("6 Year" → "6 Years"). Idempotent: an already-combined value is left untouched.

### 3. Test debt (closes audit AUDIT-4)

Add a **device-contract** test that builds a real v2 device-shaped blob per type (uppercase code + status
field + split `*Value`/`*Unit` + camelCase keys), runs canonicalize → `renderNarrative`, and asserts a
non-empty, v1-faithful narrative with the correct branch header. The existing `defaults.*.render.test.ts`
remain as template-layer unit tests (they validate the template renders given a canonical label).

## Consequences

- FIELD_REPORT narratives render correctly for live v2 device submissions, 8-way door distinction
  preserved, all 9 types, with no schema/contract/app change.
- Stored `form_data` stays verbatim (frozen contract intact); the transform is per-request and in-memory.
- Backward-compatible: any pre-existing verbose-label data renders unchanged (derivation is code-only).
- Idempotent and side-effect-free; raw-field section view unaffected.

## Alternatives considered

- **Collapse templates to the 5 device codes** (drop door Open/Locked) — simpler, but loses v1 report
  fidelity. Rejected by owner (option 3 chosen).
- **Change the mobile app to submit the verbose label again** — requires an app re-release and reverses
  ADR-0054's v2-native direction. Rejected (keep the device contract frozen; fix on the read side).
- **Normalize at ingest / store the derived label** — mutates stored data, violating the verbatim-storage
  freeze and coupling storage to template vocabulary. Rejected (derive at render).
