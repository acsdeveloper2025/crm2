# Plan — Clients (+ Products) CREATE_PAGE_STANDARD retrofit (2026-07-12)

Roll-out page 1 of the CREATE_PAGE_STANDARD sweep. **Audit-first gate passed; owner picked all three
recommended options** (retrofit-in-place · Clients + Products together · client-side friendly duplicate
message). Reference pattern: rate/commission multi-location (ADR-0093, `docs/CREATE_PAGE_STANDARD.md`).

## Audit verdict (what actually applies to a *singular* client)

Clients is **not a modal** — `ClientsPage.tsx` wraps the shared `MasterDataCrud` **inline DataGrid**
(ADR-0051, already the non-modal shape the standard wants). Entity = `code` + `name` + `effectiveFrom`
only (no GST/contact — out of scope; that would be new schema). Blast radius of the shared component +
shared import = **Clients + Products only** (Rate Types build their own import; the rest don't use
MasterDataCrud).

| # | Standard item | Verdict |
|---|---|---|
| 1 Multi-add / fan-out | **N/A** — a client has no fan-out axis |
| 2 Row-wise result screen | **N/A** — single create lands in the grid; import already has a per-row result table |
| 3 Duplicate hint before save | **REINTERPRET** — inline "code already exists" (no picker). Today shows the RAW code `CLIENT_CODE_EXISTS`; the API body carries only `{ error: code }` (middleware drops `AppError.message`, `http/app.ts:162`) → plain-English text built **client-side** |
| 4 Success + error toasts | **APPLIES — missing** — create/edit/(de)activate are silent; errors inline-only, no toast |
| 5 RBAC-gate write buttons | **Server ✅ / client ⚠️** — every write = `MASTERDATA_MANAGE` server-side; no client-side affordance gating (buttons show for a read-only user → 403 on click) |
| 6 CREATE_PAGE_STANDARD look | **N/A** — inline grid is ADR-0051-blessed; step cards add nothing for code+name |
| 7 Import sampleRows + templateNotes | **APPLIES — missing** — shared spec sets only `sample`; no `sampleRows`, no Notes sheet |
| 8 Reviews | 6-lens + logicality before push |

## Scope (this slice) — purely additive UI-parity + import-template fill

**No schema change · no migration (next mig stays 0117) · no new ADR** (ADR-0093 +
CREATE_PAGE_STANDARD already cover it; "existing pages retrofit opportunistically" is in the standard).

### Task A — `apps/web/src/components/MasterDataCrud.tsx` (Clients + Products, shared)
- Green success toast on create / save / activate / deactivate (sonner `toast.success`).
- Red error toast + inline on failure; new module-level `friendlyMasterError()` maps
  `*_CODE_EXISTS` → `A <entity> with code "X" already exists.`, keeps existing `CODE_LOCKED` /
  `STALE_UPDATE` copy, unknown codes fall through to the raw code (never swallowed). **Exported +
  export-style unit test.**
- Client-side RBAC: `has('masterdata.manage')` (`useAuth`) gates the write surface — omit the Import
  button, the Activate/Deactivate actions column, `selectable`+bulk actions, and `inlineEdit` when the
  user can't manage (server still enforces; this is affordance parity). Export/search/filters stay.

### Task B — `apps/api/src/modules/shared/masterDataImport.ts` (Clients + Products, shared)
- Add `MASTER_IMPORT_SAMPLE_ROWS` (one per shape: dated row + blank-`effectiveFrom` = now row) and a
  static `masterTemplateNotes(resource)` Notes sheet; wire both onto the spec `masterDataImportSpec`
  returns. Leave `MASTER_IMPORT_SAMPLE` untouched (onboarding + tests read it).

## Gates
- Per-task: web export-style test for `friendlyMasterError`; API tests for clients + products templates.
- Full `pnpm verify` (`DATABASE_URL=…:5433/crm2_test LC_ALL=C`).
- Browser-verify on crm2_dev: create a duplicate client → red toast + inline plain-English; create a
  new client → green toast; download the import template → 2 sample rows + Notes sheet; confirm a
  read-only user sees no write buttons (or reason about the gate if no such user seeded).
- 6-lens + logicality review, adversarially verified, before push. Then repeat for the next page.
