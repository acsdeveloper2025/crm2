# Verification Unit Registry — Implementation Spec (Build Step 1)
**Status:** BUILD (architecture frozen — no redesign). Materializes the registry from `FINAL_DATA_MODEL_FREEZE`.
**Files:** `migrations/0001_verification_unit_registry.sql` (DDL) · `seed/verification_units.seed.sql` (9 field + 59 KYC).
**Decisions baked in** (from `FINAL_PRE_BUILD_CHALLENGE`): subtype payload = separate typed tables (later steps) · form schema = `required_form_code` (config + code) · PII/DPDP = `pii_sensitive` from day 1.

---

## 1. Catalog (the 17 attributes)
The full catalog is the seed. Summary:
- **68 units** = 9 `FIELD_VISIT` (Residence…Property-Individual) + 59 `KYC_DOCUMENT` (PAN, Aadhaar, GST, ITR, Bank Statement, …).
- **Field profile:** FIELD_AGENT · TERRITORY_AUTO · form required · ≥5 photos · GPS · AGENT_COMMISSION · FIELD_RATE · FIELD_NARRATIVE report · REVISIT_PARENT_RATE.
- **KYC profile (all 59 identical):** KYC_VERIFIER · DESK_POOL · no form/photos/GPS · document attachment · CLIENT_INVOICE · NONE commission · KYC_DOCUMENT report · RECHECK_FRESH_RATE · `pii_sensitive` for IDENTITY+FINANCIAL.
- **Result set:** uniform `Positive/Negative/Refer/Fraud` (overridable per unit).

## 2. PostgreSQL tables (DDL = `0001_…sql`)
- `verification_units` — the catalog (+ 3 CHECK constraints enforcing the field/KYC invariants + non-empty result_set).
- `client_product_verification_units` — CPV enablement, UNIQUE(client_product_id, verification_unit_id).
- (Tasks/results/billing tables arrive in Build Steps "Case/Task creation" — out of scope for Step 1.)

## 3. Seed data structure (`seed/verification_units.seed.sql`)
- 9 explicit field INSERTs; 59 KYC via one `INSERT … SELECT … FROM (VALUES …)` applying the shared profile. Idempotent (`ON CONFLICT (code) DO NOTHING`). Sanity queries at the file foot (expect FIELD_VISIT=9, KYC_DOCUMENT=59).

## 4. API contract (`/api/v2`)
Permission: `verification_unit.manage` (SA) for writes; `case.view`/`page.masterdata` for reads. All responses camelCase.

| Method · Path | Purpose | Perm |
|---|---|---|
| `GET /verification-units?kind&category&active&q` | list catalog (filterable) | read |
| `GET /verification-units/:code` | one unit (full 17 attrs) | read |
| `POST /verification-units` | create unit | `verification_unit.manage` |
| `PUT /verification-units/:id` | update unit | `verification_unit.manage` |
| `PATCH /verification-units/:id/active` `{isActive}` | activate/deactivate | `verification_unit.manage` |
| `GET /client-products/:cpId/verification-units` | CPV enablement state | read |
| `PUT /client-products/:cpId/verification-units` `{enabledUnitIds[]}` | set enablement | `verification_unit.manage` |
| `GET /cases/:caseId/available-units` | units enabled for this case's client+product (the Add-Unit picker source) | `case.view` |

**Unit DTO:** `{ id, code, name, description, version, category, kind, workerRole, assignmentMethod, requiredFormCode, requiredPhotos, requiredGps, requiredAttachments, resultSet, reviewRequired, billingProfile, commissionProfile, reportTemplateType, reverificationRule, piiSensitive, isActive, sortOrder, createdBy, updatedBy }`.
**Versioning:** editing a unit's policy bumps `version`; Tasks snapshot `(verificationUnitId, version)` at creation so in-flight work keeps its policy (report/billing integrity). `mis_fields` was removed at the build gate — per-client MIS column mapping lives in the MIS-template module, not on the unit.

## 5. Admin UI screens (Master Data → Verification Units)
Follows the locked list-page shell (5 stat cards + URL filters + xlsx export):
1. **Verification Units list** — stats (Total · Active · Field · KYC · PII-sensitive); filters (kind/category/active/search); table (code · name · category · kind chip · worker · billing · active); row → Edit; Activate toggle.
2. **Edit/Create dialog** — fields per the DTO; **`kind` drives conditional defaults + locks** the invariant fields (selecting FIELD_VISIT auto-sets photos≥5/gps/form-required/commission; KYC_DOCUMENT auto-sets the KYC profile) so the UI can't author an invalid unit.
3. **CPV Enablement matrix** — client × product → checkbox grid of units; bulk enable/disable; writes `client_product_verification_units`.

## 6. Validation rules (service layer — mirror the DDL CHECKs)
- `code` UPPER_SNAKE, unique, immutable after create.
- `kind ∈ {FIELD_VISIT, KYC_DOCUMENT, DESK_DOCUMENT}`; `worker_role` consistent (FIELD_VISIT→FIELD_AGENT, KYC_DOCUMENT→KYC_VERIFIER).
- **FIELD_VISIT invariant:** photos≥5 · gps=true · form_code NOT NULL · billing=AGENT_COMMISSION · report=FIELD_NARRATIVE · reverif=REVISIT_PARENT_RATE.
- **KYC_DOCUMENT invariant:** photos=0 · gps=false · attachments non-empty · billing=CLIENT_INVOICE · commission=NONE · report=KYC_DOCUMENT · reverif=RECHECK_FRESH_RATE.
- `result_set` non-empty.
- `pii_sensitive` defaults true for IDENTITY/FINANCIAL (DPDP) — overridable.
- CPV: cannot enable an inactive unit; cannot disable a unit with active tasks on that client+product (FK guard, added when tasks land).

---
**Build order from here:** Registry (this) → Master Data screens → Case creation → Task creation → Verification Workspace → Report generation → Pipeline → MIS & Billing → remaining Admin. Architecture is frozen; this is build material.
