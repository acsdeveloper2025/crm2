# Plan — Verification Units CREATE_PAGE_STANDARD retrofit (2026-07-12)

Roll-out page 2 of the CREATE_PAGE_STANDARD sweep. **Owner-approved (build it as shown)** after a
before/after mockup: match VU to the rate/commission "new add design", both worker-role variants, buttons
matched (solid-blue `primary` Save, ghost Cancel). Reference: `docs/CREATE_PAGE_STANDARD.md`, ADR-0093,
the Clients retrofit (`ad50ffe`).

## Audit verdict
VU is **bespoke** (`VerificationUnitsPage` list + `VerificationUnitRecordPage` record route, ADR-0051) —
NOT MasterDataCrud, so it did not inherit the `ad50ffe` fixes. **Singular entity** → fan-out (#1/#2/#3-chips)
N/A. Field-richer than Clients: ~7 editable fields; ~8 more locked/derived from `workerRole` (ADR-0070,
frozen). Applicable = #3-reinterpret, #4, #5-verify, #6, #7, #8.

## Changes (additive — no schema, no migration, no ADR)
- `apps/web/src/lib/friendlyError.ts` (new) — extracted the shared `friendlyMasterError`; MasterDataCrud
  now imports it (Clients/Products unchanged). Tests → `lib/friendlyError.test.ts`.
- `VerificationUnitRecordPage.tsx` — single-column form → numbered **step cards** on a grid; role-aware
  **Step 2** (Field profile vs Desk profile: Form code drops for KYC, ≥1-document note, role-specific
  **locked-profile chip recap**); green success / red error **toasts** + persistent inline `role="alert"`
  via `friendlyMasterError`; **sticky save bar** (echo · ghost Cancel · solid-blue `Save`).
- `VerificationUnitsPage.tsx` — client-side RBAC gate `canManage = has('verification_unit.manage')` on
  Import / +New / actions column / selectable+bulk; (de)activate toasts.
- `verificationUnits/service.ts` — `VU_IMPORT_SPEC` gains per-role `sampleRows` (FIELD_AGENT + KYC_VERIFIER,
  each passing `applyInvariants`) + static `templateNotes`.

## Frozen — untouched
`workerRole`→locked profile (ADR-0070), `isSystem` mobile-locked units, code-lock while referenced (ADR-0020),
`workerRole` disabled on edit.

## Gates
`pnpm verify` green (web 29 files, api 86; +`friendlyError.test`, +VU "template sample rows re-import" test).
Browser-verified crm2_dev: both role variants render; KYC create→green toast; duplicate→red toast+inline
plain-English; list deactivate→green toast + RBAC actions; console clean. 6-lens + logicality reviewed
inline (no blocking). No `pnpm openapi` (no route change).
