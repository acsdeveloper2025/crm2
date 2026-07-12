# Plan — Rate Types CREATE_PAGE_STANDARD retrofit (2026-07-12)

Roll-out **page 4 (final)**. Owner: BUILD. The *Clients* treatment for a code-keyed singular
inline-grid page with its own bespoke import.

## Audit verdict
`RateTypesPage` is a bespoke **inline DataGrid** (ADR-0051, not MasterDataCrud). Entity = `code` +
`name` + `description` + `category` (FIELD/OFFICE) + `sortOrder`. Unique key = `code`; dup =
`RATE_TYPE_EXISTS`. RBAC = `masterdata.manage`. `code` is create-only (immutable identity, the FK key);
`category` is editable. Own import (`RATE_TYPE_IMPORT_SPEC`). Singular → fan-out (#1/#2/#3-chips) N/A.
No bulk activate/deactivate. Applicable = #3-reinterpret (already inline), #4 toasts, #5 RBAC-gate, #7 import.

## Changes (additive — no schema, no migration, no ADR)
- `apps/web/src/features/rateTypes/RateTypesPage.tsx` — green success / red error toasts on
  create/save/(de)activate; new local `friendlyRateTypeError()` (`RATE_TYPE_EXISTS` is code-keyed but
  NOT `*_CODE_EXISTS`, so neither shared helper fits — kept local; exported + tested); client RBAC gate
  `canManage = has('masterdata.manage')` on the actions column / Import / inline-edit.
- `apps/api/src/modules/rateTypes/import.ts` — `RATE_TYPE_IMPORT_SPEC` gains `sampleRows` (one FIELD +
  one OFFICE, distinct codes) + `templateNotes`. **`effectiveFrom` is honored** — `CreateRateTypeSchema`
  keeps it (unlike VU's baseShape), so no VU-style discard trap.

## Frozen — untouched
`code` create-only (catalog/FK key); the FIELD/OFFICE `category` semantics that feed rate/commission
resolution. No bulk added (page has none).

## Gates
`pnpm verify` green (web +1 test `friendlyRateTypeError`; rateTypes api unchanged count).
Browser-verified crm2_dev: dup `LOCAL`→red inline "A rate type with this code already exists." + toast;
create `PONYRT`→row added + green toast; RBAC controls render for a manager. e2e `rateTypes.spec` only
checks inline-edit/createOnly (unaffected for a manager). 6-lens/CI e2e via the push.
