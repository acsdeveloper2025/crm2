# Rate-Type Assignments → CREATE_PAGE_STANDARD (multi-add) — build plan

**Date:** 2026-07-13 · **Kickoff:** [2026-07-13-rate-type-assignments-multi-add-kickoff.md](./2026-07-13-rate-type-assignments-multi-add-kickoff.md)
**Owner decision (2026-07-13):** **Fork B** (fix the `(client, product?, unit?)` slot → pick-many rate
types → one row per rate type) · **red/rule-blocked chips = N/A** (amber-only; nothing blocks a valid pick).

## Why Fork B
- 1:1 with the shipped rate/commission multi-location pages (one fan-out axis).
- Faithful to ADR-0067's "the available set for a slot" model.
- Reuses the existing CPV-scoped unit picker; amber hints are exact & cheap.
- Full-matrix onboarding is already served by import + the ADR-0092 Client-Setup workbook, so the
  interactive page needn't be a 2D matrix filler.

## Governance
**Additive** under ADR-0093 (bulk-endpoint pattern, explicitly rolled out to master-data pages) +
ADR-0067 (model) + `docs/CREATE_PAGE_STANDARD.md`. **No migration** (schema already allows N rows/slot,
NULLS-NOT-DISTINCT key). **No new ADR** required (owner may request a one-line note in ADR-0093's
rollout list). `/api/v2` additive; **mobile untouched**.

## All-8 mapping
| # | Item | Status | Work |
|---|------|--------|------|
| 1 | Multi-add merged create page | APPLIES | new `RateTypeAssignmentCreatePage` (Fork B) |
| 2 | Row-wise result screen | APPLIES | Created/Skipped/Error rows styled like list |
| 3 | Picker duplicate hints | APPLIES | **amber** = rate type already active on slot (would skip); **red N/A** |
| 4 | Toasts + inline alert | APPLIES / PARTIAL(list) | `friendlyRateTypeAssignmentError` map; green/red toast + `role=alert`; fix list deactivate toast |
| 5 | RBAC-gate write controls | ALREADY-PRESENT | keep `canManage = has('masterdata.manage')` |
| 6 | CREATE_PAGE_STANDARD look | APPLIES | step cards + sticky bar + pick-many |
| 7 | Import/export | PARTIAL | add `sampleRows` (per shape) + `templateNotes`; engine + per-row partial-success already present |
| 8 | Reviews | APPLIES | full 6-lens + logicality, adversarially verified |

## New endpoint (the only additive surface)
`POST /api/v2/rate-type-assignments/bulk` — one slot + `rateTypeIds[]`; SAVEPOINT-per-row over
`rateTypeIds`, one wrapping txn; **pre-read the slot's active rate-type set**:
- picked ∩ active → **EXISTS** (skip, never touched)
- picked − active → upsert (`ON CONFLICT DO UPDATE SET is_active=true`; new **or reactivate**) → **CREATED**
- `23503` → **ERROR** `INVALID_ASSIGNMENT_REF`
Returns 200 `{ results: {rateTypeId, status, assignmentId, error}[], createdCount, existsCount, errorCount }`.
Cap `MAX_BULK_RATE_TYPE_ASSIGNMENTS`. Guard `masterdata.manage` (mirrors single create).

## Slices (per-task review gates)
1. SDK contract → 2. API bulk (repo/service/controller/route) → 3. import seams → 4. API tests →
5. FE create page (+route, slim RecordPage to detail-only) → 6. FE list toast → 7. FE tests + e2e →
8. `pnpm openapi` → 9. `pnpm verify` → 10. browser-verify performed action → 11. 6-lens + logicality
reviews (adversarial) → 12. memory/registry/master-§8 at ship.

## Reference (mechanics to copy)
`RateCreatePage.tsx` (step cards, amber/red pick-many, sticky bar, result rows, `createFriendlyError`) ·
`rates/{repository,service,controller,routes,import}.ts` (SAVEPOINT-per-row bulk, `sampleRows`/
`buildRateTemplateNotes`). RTA is **simpler**: no amount/currency/effective-dating/OCC, no office/located
split, amber-only. Copy `StepCard`+`Field` verbatim (extract only if a 3rd create page appears).
