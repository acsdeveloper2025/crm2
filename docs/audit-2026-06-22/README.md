# Verification-form field-mapping audit — 9 FIELD_VISIT types × 4 layers (2026-06-22)

**Type:** AUDIT (read-only). Nothing changed. Findings + gap matrix + a prioritized fix plan; owner
decides before any change. Architecture is FROZEN — fixes that touch the contract need an ADR.

**Scope:** the 9 mobile-hardcoded, `is_system`-locked FIELD_VISIT units — RESIDENCE, OFFICE,
RESIDENCE_CUM_OFFICE, BUSINESS, BUILDER, NOC, DSA_CONNECTOR, PROPERTY_APF, PROPERTY_INDIVIDUAL — end to
end across four layers + the field-photo lat/long→resolved-address chain.

Layer detail lives in the sibling files:
- [layer1-mobile-capture.md](layer1-mobile-capture.md) — what the app captures + submits, per type
- [layer2-backend.md](layer2-backend.md) — submit endpoint, storage, read-models, photo→geocode chain
- [layer3-frontend.md](layer3-frontend.md) — web display of fields, narrative, and photos
- [layer4-template-mapping.md](layer4-template-mapping.md) — the FIELD_REPORT template field-key mapping (the crux)

---

## TL;DR

Three of the four layers are **sound**. The field-photo lat/long→address chain is **sound end to end**.
The **FIELD_REPORT narrative generator (Layer 4) is broken for every real device submission** — not by a
per-field key drift (those are ~100% correct camelCase), but by **two systemic payload-shape mismatches**
between what the v2 mobile app submits and what the ported-from-v1 default templates expect. The unit
tests are green because they feed v1-shaped fixtures the v2 device never sends.

**Raw captured fields always display** (the web flattens every primitive generically), so data is never
lost — only the polished prose report comes out blank. The break is **latent until an admin activates a
FIELD_REPORT template prefilled from the shipped defaults** (the report-layouts admin offers a one-click
"use default" — `apps/web/src/features/reportLayouts/ReportLayoutsPage.tsx:374-378`).

---

## Per-type × per-layer matrix

Legend: ✅ PASS · ⚠️ PARTIAL · ❌ FAIL

| Type | L1 Mobile capture | L2 Backend contract/storage | L3 FE raw-field display | L4 FIELD_REPORT narrative | Photo lat/long+address |
|---|---|---|---|---|---|
| RESIDENCE | ✅ | ✅ | ✅ | ❌ | ✅ |
| OFFICE | ✅ | ✅ | ✅ | ❌ | ✅ |
| RESIDENCE_CUM_OFFICE | ✅ | ✅ | ✅ | ❌ | ✅ |
| BUSINESS | ✅ | ✅ | ✅ | ❌ | ✅ |
| BUILDER | ✅ | ✅ | ✅ | ❌ | ✅ |
| NOC | ✅ | ✅ | ✅ | ❌ | ✅ |
| DSA_CONNECTOR | ✅ | ✅ | ✅ | ❌ | ✅ |
| PROPERTY_APF | ⚠️ | ✅ | ✅ | ❌ | ✅ |
| PROPERTY_INDIVIDUAL | ✅ | ✅ | ✅ | ❌ | ✅ |

- **L1** ✅ all (APF ⚠️: emits a dual verdict — `finalStatus` + `finalStatusNegative`). GPS is mandatory on
  capture; every photo carries `latitude/longitude/accuracy/timestamp` (`crm-mobile-native` `CameraService.ts:271-356`).
- **L2** ✅ all. The form body is stored **verbatim** as jsonb under `form_data[<slug>]` with no per-type
  transform, no field-drop, no key normalization (`apps/api/src/modules/cases/repository.ts:1413-1418`;
  permissive `z.record` schema `verification-tasks/service.ts:54`). One route/handler/schema/store for all
  9 slugs — fully uniform. Read-models expose full `form_data` + photos w/ `geoLocation` +
  `reverseGeocodedAddress`.
- **L3** ✅ all. `buildSections` (`fieldReports/sections.ts`) generically flattens **every** primitive form
  field to `Label: value` rows — no per-type gating, nothing dropped. Web renders sections + narrative
  (null-handled) + photos with image **and** coords **and** address + a null-address on-view fallback
  (`CaseDetailPage.tsx:1779-1906`).
- **L4** ❌ all — see findings F-1/F-2 below.
- **Photo chain** ✅ all: capture (lat/long, mandatory) → `case_attachments.geo_location` →
  `enqueueReverseGeocode` (async, BullMQ, 3-retry → DLQ, immutable write-back) →
  `case_attachments.reverse_geocoded_address` → read-model → FE renders both. Degrades gracefully to
  coords-only if the address is still pending/failed.

---

## Findings

### F-1 · Outcome-vocabulary mismatch → every FIELD_REPORT narrative body renders empty — ❌ CONFIRMED (P0/P1)

The templates branch on **v1 verbose labels** via strict `===`:
`"Positive & Door Open"`, `"Positive & Door Locked"`, `"Shifted & Door Open/Locked"`,
`"NSP & Door Open/Locked"`, `"ERT"`, `"Untraceable"`, plus `"Positive"`/`"Negative"` (APF).
(`packages/sdk/src/fieldReportDefaults.ts`; helper `eq` is `a === b`, `helpers.ts:306-310`.)

The v2 mobile app submits one of **5 uppercase CODES** in `verificationOutcome`:
`POSITIVE` / `SHIFTED` / `NSP` / `ENTRY_RESTRICTED` / `UNTRACEABLE`
(`selectedOutcome: LegacyOutcome`, `VerificationFormScreen.tsx:80`; submitted as
`verificationOutcome: selectedOutcome`, `FormSubmissionService.ts:81`; `getOutcomeLabel` produces the
verbose label **only for the picker display**, `VerificationFormScreen.tsx:251` — it is **not** what's
submitted). No `outcome` label key is sent.

The template's `outcome` variable resolves from `residence.verificationOutcome` by plain dot-path
(`fieldReportDefaults.ts:68-72`, `render.ts:15-23`) — no code→label normalization anywhere in the
backend (`fieldReports/repository.ts:52` loads `ct.form_data` verbatim). So `POSITIVE !== "Positive & Door
Open"` → **no `{{#eq outcome …}}` branch ever matches → the whole body renders empty** for all 9 types.

**Why the tests don't catch it:** every `defaults.*.render.test.ts` feeds the verbose label
(`ctx(formData, 'Positive & Door Open')`, `'Untraceable'`, …) — i.e. a payload the v2 device never emits.
The templates DO render correctly when fed v1 labels, so the suite is green and false-confident.

**Real-artifact corroboration:** the v1 dump (`acs_db_final_version.sql`) stored the verbose labels under
`outcome`/`verificationOutcome` (`"Positive & Door Open"` ×158, `"ERT"` ×102, `"Untraceable"` ×128, …).
The v2 mobile rewrite (`LegacyFormTemplateBuilders.ts` `normalizeOutcome`) collapsed these to 5 codes and
stopped emitting the label — that rewrite is where the regression entered.

Cardinality also diverges: residence/office/etc. templates carry 8 outcome branches
(Open/Locked × Positive/Shifted/NSP + ERT + Untraceable); the device exposes 5 codes (no Open-vs-Locked
distinction). APF is doubly broken — its richest branch keys on `"Negative"`, a value no device code maps
to.

### F-2 · Composite period-key arity → all tenure clauses render empty — ❌ CONFIRMED (P0/P1)

Templates read a **single** tenure value per `sourceRef`: `stayingPeriod`, `shiftedPeriod`,
`businessPeriod`, `workingPeriod`, `establishmentPeriod`, `currentCompanyPeriod`, `oldOfficeShiftedPeriod`
(consumed by the `pluralize` helper). The app splits every tenure into **two** fields —
`<period>Value` + `<period>Unit` (e.g. `stayingPeriodValue` + `stayingPeriodUnit`) — and never emits the
combined key. ~20 instances across 8 types resolve to `''` → empty "for the last … years" clauses. The
tests again mask it by feeding the combined `stayingPeriod: '6 Year'` the device never sends. (One
`sourceRef` can't read two keys, and there is no `concat` helper — so this needs a real fix, not just a
ref rename.)

### F-3 · Secondary per-field drifts — ⚠️ MEDIUM confidence (P2)

- `applicantStayingFloor` (RESIDENCE / RESIDENCE_CUM_OFFICE) — template+tests use this key for the floor
  clause; the residence mobile catalog appears to emit `addressFloor`. Likely a per-type ref mismatch →
  empty floor sentence. Confirm against the exact mobile residence form before fixing.
- `callConfirmation` missing for BUILDER/NOC — those templates call the 2-arg `callRemark`; the app does
  emit `callConfirmation` for the call branches, so verify whether it's actually absent for these two
  types.
- `finalStatusNegative` (APF) — captured by the app but no template ever prints it.
- `businessExistance` (misspelled) — a harmless unused twin of the consumed `businessExistsStatus`.

These are isolated and lower-severity; the raw-section view still shows them. They are **not** the cause of
the blank report — F-1 is. Treat as cleanup once F-1/F-2 are resolved.

---

## What is NOT broken (verified PASS)

- **Field capture & storage parity** — the long-standing "verbatim jsonb round-trip, no field loss" claim
  holds for the **raw** field set. The audit narrows it: parity is real at the storage + raw-display layer;
  the gap is in the **narrative template** layer only.
- **Field-photo lat/long + reverse-geocoded address** — full chain works, all 9 types, with graceful
  null-address fallback. No gap.
- **Frontend** — every captured field renders; narrative is rendered-when-present and null-handled; no
  per-type/state reachability gap.
- **Backend** — verbatim, uniform across all 9 slugs; unknown slug → 400.

---

## Open verification (needs prod/dev DB, not done in this audit)

1. **Active vs latent in prod:** `SELECT verification_type, is_active FROM report_layouts WHERE
   template_type='FIELD_REPORT'` on prod — if any active FIELD_REPORT layout exists (admin-created from the
   default), F-1/F-2 are **live** (blank reports now); if none, the defect is latent until first activation.
2. **End-to-end artifact:** run one real device submission per type through to `GET
   /cases/:id/tasks/:taskId/field-report` and diff the rendered `narrative` (expect empty body today).

---

## Prioritized fix plan (for owner decision — NOT executed)

All options keep the device contract frozen (no app change / no re-release) by mapping on the **CRM
backend** read side. They need an owner decision + ADR (the FIELD_REPORT engine is ADR-0039).

- **Fix-1 (F-1):** introduce a server-side outcome canonicalizer at render time — map the 5 device codes (+
  the door Open/Locked nuance, if the device carries a `*Status` field that distinguishes them) to the
  template branch labels before `buildContext`, OR add a Handlebars `eq`-with-normalization / an
  `outcomeMatches` helper, OR re-author the default templates to branch on the 5 codes. Decision needed:
  do we preserve the 8-way Open/Locked branching (requires deriving Open/Locked from a status field) or
  collapse templates to the 5 device codes?
- **Fix-2 (F-2):** add a `period`-composing resolver/helper (`{{pluralize (joinPeriod stayingPeriodValue
  stayingPeriodUnit)}}`) or a derived `*Period` column in the render context. Small, mechanical.
- **Fix-3 (F-3):** per-type ref corrections (`applicantStayingFloor`, `callConfirmation`) + drop/print
  `finalStatusNegative` — after F-1/F-2.
- **Test debt (cross-cutting):** the `defaults.*.render.test.ts` fixtures must feed the **real device
  payload** (codes + split period keys), and a contract test should assert the default templates render a
  non-empty body from a captured device blob — otherwise the suite will keep masking this class of bug.

Findings dispositioned in `docs/COMPLIANCE_GAPS_REGISTRY.md` § Section AUDIT-2026-06-22.
