# CRM2 — Build Gate: Verification Unit Registry Lock
**Status:** BUILD validation (no architecture redesign). Gate before Master Data / Cases / Tasks / Screens.
**Subject:** `db/v2/migrations/0001_verification_unit_registry.sql` · `seed/verification_units.seed.sql` · `REGISTRY_SPEC.md`.

---

## 1 — REGISTRY REVIEW (per column: KEEP / REMOVE / ADD)

| Column | Verdict | Purpose · consumers · validation · future impact |
|---|---|---|
| `id` | KEEP | PK; FK target for tasks/CPV/rates |
| `code` | KEEP | stable key (API/DB/seed); **validation:** UPPER_SNAKE, unique, immutable after create |
| `name` | KEEP | UI label, report header |
| `description` | **ADD ✅** | admin helptext; consumed by Master Data UI |
| `version` | **ADD ✅** | config-versioning — Tasks snapshot `(unit_id, version)` so a policy edit never rewrites in-flight work's billing/report rules. **Without it, editing a unit silently changes historical task behavior.** |
| `category` | KEEP | grouping + MIS bucket; consumers: UI, MIS |
| `kind` | KEEP | FIELD_VISIT/KYC_DOCUMENT/DESK_DOCUMENT → drives worker, gates, workspace mode, billing |
| `worker_role` | KEEP | assignment eligibility; CHECK-consistent with kind |
| `assignment_method` | KEEP | Pipeline assign logic (TERRITORY_AUTO/MANUAL/DESK_POOL) |
| `required_form_code` | KEEP | Workspace form render (field units); NULL for docs |
| `required_photos` | KEEP | submit gate (≥5 field, 0 KYC) |
| `required_gps` | KEEP | submit gate |
| `required_attachments` | KEEP | KYC document-required gate; consumed by submit validator |
| `result_set` | KEEP | decision pane options + report key; CHECK non-empty |
| `review_required` | KEEP | finalize step (always true v2; column allows future per-client optional review) |
| `billing_profile` | KEEP | billing engine path (commission vs invoice) |
| `commission_profile` | KEEP | commission engine (FIELD_RATE/NONE) |
| `report_template_type` | KEEP | report engine selector (FIELD_NARRATIVE vs KYC_DOCUMENT) |
| `reverification_rule` | KEEP | re-do verb (revisit vs recheck) |
| ~~`mis_fields`~~ | **REMOVE ✅** | **premature** — per-client MIS→bank-column mapping belongs in the MIS-template module (keyed per client), not on the unit. Speculative config; nothing in Case/Task/Pipeline consumes it. |
| `pii_sensitive` | KEEP | DPDP masking/encryption driver (IDENTITY/FINANCIAL); **must exist day 1** |
| `is_active` | KEEP | catalog availability |
| `sort_order` | KEEP | UI ordering |
| `created_by` / `updated_by` | **ADD ✅** | config audit (who changed the catalog) |
| `created_at` / `updated_at` | KEEP | timestamps |

**Applied at this gate:** +`description`, +`version`, +`created_by`, +`updated_by`; −`mis_fields`. (DDL + spec updated; seed unaffected — it lists explicit columns, all additions are nullable/defaulted.)

## 2 — MISSING FIELDS (before Cases/Tasks)
After the above, **nothing else is required on `verification_units`** for Cases/Tasks to be built. Confirmed by walking the Task-creation flow (§3): a Task needs only `verification_unit_id` (+ snapshotted `version` + rate). Rate is NOT a unit column (it lives in `rates(client+product+unit+rate_type)` — a Master-Data-phase table). Bank-specific unit codes are a per-CPV mapping (MIS phase), not a registry gap.

## 3 — TASK CREATION FLOW VALIDATION (no redesign)

**Sequence**
```
Operator → Web: pick Client → pick Product
Web → API:  GET /cases/available-units?clientId&productId   (CPV-enabled units only)
API → DB:   client_product_verification_units ⋈ verification_units WHERE is_active
Operator:   selects N Verification Units (+ address/applicant per unit)
Web → API:  POST /cases   { client, product, applicants, units:[{unitId, address, pincode,...}] }
API (tx):   INSERT case
            FOR each unit:
              resolve rate = rates(client, product, unitId, location, rate_type)  -- flat model, ADR-0018 (no zone/eligibility hop)
              INSERT task (case_id, verification_unit_id, unit_version, rate_snapshot, status)
              INSERT field_task_detail | kyc_task_detail (subtype stub)
            assignment: TERRITORY_AUTO(field→pincode/area) | DESK_POOL(KYC) | MANUAL
            COMMIT → recalc case status
Pipeline:   GET /pipeline → tasks (scoped) appear as rows
```
**API flow:** `GET /clients` → `GET /clients/:id/products` → `GET /cases/available-units` → `POST /cases` → `POST /tasks/:id/assign` (or auto) → `GET /pipeline`.
**DB flow:** `cases` 1—N `tasks(verification_unit_id, unit_version, rate_snapshot)` → typed `*_task_detail`; uniqueness = partial-unique `(case_id, verification_unit_id) WHERE active` → **N units/case naturally** (the v1 1-KYC cap is gone).
**RBAC flow:** `case.create` + `validateCaseCreationAccess` (client/product in scope) → assign gated by `case.assign` + `validateAssignmentTargetScope` (subtree only) → Pipeline rows filtered by `dataScope`.
**Verdict:** the frozen registry supports the full flow with **zero redesign** — the unit is a clean FK; CPV gates selection; active-unique allows multi-unit cases.

## 4 — TEST ARCHITECTURE (test-first, mandatory, built with code)
- **Runner:** vitest (matches v1). Every module ships its tests in the same PR — no "test phase later."
- **Layers:** unit (pure) · integration (HTTP + ephemeral Postgres) · db (DDL/constraint) · contract (DTO/zod) · seed-validation.
- **Ephemeral DB:** each integration run boots a throwaway Postgres, applies `db/v2/migrations/*` top-to-bottom, seeds, runs, drops (fixes the v1 "dump not restorable" gap).
- **Gate:** `test → build` in CI (no image without green tests), mirroring v1's branch protection.
- **Package structure validated:** `packages/{contracts→sdk, access, config, sdk, test-utils}` (see §7 for the contracts merge).

## 5 — `packages/test-utils` DESIGN
```
packages/test-utils/src/
├── factories/        # build valid domain objects with overrides (DB-agnostic)
│   ├── user.factory.ts        clients.factory.ts     product.factory.ts
│   ├── verificationUnit.factory.ts   case.factory.ts task.factory.ts assignment.factory.ts
├── builders/         # fluent multi-entity scenarios (a case WITH 3 units + assignments)
│   └── caseScenario.builder.ts
├── fixtures/         # static canonical data (the 9 field + sample KYC units, seed parity)
│   └── verificationUnits.fixture.ts
├── helpers/          # ephemeral DB up/down, migrate+seed, authHeaderForRole, apiClient
│   ├── testDb.ts   authHeaders.ts   httpClient.ts
└── assertions/       # domain assertions (assertUnitInvariant, assertScopeFiltered)
    └── registry.assertions.ts
```
**Responsibilities:** factories = one valid object + overrides; builders = wired scenarios; fixtures = deterministic seed parity; helpers = DB/auth/HTTP plumbing; assertions = reusable domain checks.
**Factories required:** Users · Clients · Products · **Verification Units** · Cases · Tasks · Assignments (all listed — implemented in this package).
**Example:**
```ts
const unit = verificationUnitFactory({ workerRole: 'KYC_VERIFIER', code: 'PAN_CARD' }); // valid KYC unit
const { case_, tasks } = caseScenarioBuilder().withClientProduct(cp).withUnits(['RESIDENCE','PAN_CARD']).build();
await assertUnitInvariant(unit);          // FIELD/KYC cross-field rules hold
```

## 6 — TEST MATRIX (Verification Unit Registry)
```
db/v2/__tests__/
├── unit/
│   ├── unitInvariants.test.ts        # field/KYC cross-field rules (service-layer mirror of CHECKs)
│   └── codeValidation.test.ts        # UPPER_SNAKE, unique, immutable
├── db/
│   └── registrySchema.test.ts        # migration applies clean; CHECK constraints reject bad rows
├── seed/
│   └── seedValidation.test.ts        # 9 FIELD_VISIT + 59 KYC_DOCUMENT; pii flags; idempotent re-run
├── integration/
│   └── verificationUnitsApi.test.ts  # CRUD + CPV enablement + available-units; RBAC (verification_unit.manage); not-found
└── contract/
    └── unitDto.contract.test.ts      # DTO/zod shape, camelCase, no leaked internal cols
```
| Layer | Must assert |
|---|---|
| Unit | every FIELD invariant (photos≥5/gps/form/commission), every KYC invariant; result_set non-empty |
| DB | DDL applies; CHECK `chk_vu_field_visit`/`chk_vu_kyc_document` reject violations |
| Seed | counts (9/59), `pii_sensitive` true for IDENTITY/FINANCIAL, `ON CONFLICT` idempotent |
| Integration | CRUD + CPV + available-units; SA can write, non-SA 403; scope on reads |
| Contract | DTO matches spec; deactivate/activate; cannot enable inactive unit |
**Coverage targets:** registry module **≥90% lines / 100% of the invariant branches** (correctness-critical). Global v2 floor **≥80%** lines (gate-enforced); 100% on billing/commission/scope paths as they land.

## 7 — PACKAGE VALIDATION (Day-1 only)
| Package | Verdict | Justification |
|---|---|---|
| `@crm2/contracts` | **MERGE → @crm2/sdk** | Day 1 has **one** web client (mobile = separate repo, out of scope). A standalone contracts package earns its keep only with ≥2 consumers; today the SDK can export the DTOs/zod. (Extract later only if mobile-v2 consumes — not a Day-1 concern.) |
| `@crm2/access` | **KEEP** | Permission codes + the **default-deny scope guard** are shared by api + web; central source prevents the cross-tenant-leak class. |
| `@crm2/config` | **KEEP** | One fail-fast env schema across api/worker/report/web — env drift is a real v1 prod-500 class. |
| `@crm2/sdk` | **KEEP** | Typed client the web app + tests call; absorbs contracts. |
| `@crm2/test-utils` | **KEEP** | Test-first is mandatory; factories/fixtures/db-harness shared by every test. |
**Day-1 packages = 4:** `access · config · sdk (incl. contracts) · test-utils`. (`ui` stays app-internal until a 2nd web consumer.)

## 8 — DATABASE EXECUTION DECISION
**Verdict: B — keep as source only (for any persistent/prod DB).** Justification: no v2 database exists yet; `clients`/`client_products`/`cases`/`tasks` aren't built; applying the registry alone to a real DB strands `client_product_verification_units.client_product_id` (no parent table) and front-runs the schema. **Accumulate migrations and apply the whole Master-Data schema together.** **Exception (required for test-first):** the migration IS applied — to an **ephemeral test database** in CI/local — so §6 runs now. So: **source-only for real DBs; live in the test harness.**

## 9 — BUILD READINESS
**YES** — development can proceed to Master Data → Cases → Tasks → Assignment → Verification Workspace **without redesigning Verification Units**, now that the gate fixes (+version/audit, −mis_fields) are applied. The §3 flow confirms the unit FK + CPV + active-unique cover the path. **Registry locked.**

## 10 — MASTER DATA IMPLEMENTATION PLAN (next phase only)
| Module | Tables | APIs | Services | Repositories | UI | Validation | Tests |
|---|---|---|---|---|---|---|---|
| **Verification Units** | `verification_units` (done) | `/api/v2/verification-units` CRUD + active | `VerificationUnitService` (invariant enforcement) | `verificationUnitRepo` | Units list + Create/Edit dialog (kind-driven defaults) | §1 invariants; code immutable | §6 matrix |
| **Clients** | `clients` | `/clients` CRUD + active + export | `ClientService` | `clientRepo` | Clients list-shell (5 cards) | name/code unique; scope | unit+integration |
| **Products** | `products`, `client_products` (C↔P) | `/clients/:id/products`, `/products` CRUD | `ProductService` | `productRepo` | Products list + client mapping | C↔P unique; active | unit+integration |
| **CPV Mapping** | `client_product_verification_units` (done) | `GET/PUT /client-products/:id/verification-units`, `GET /cases/available-units` | `CpvService` (enablement) | `cpvRepo` | CPV matrix (client×product → units) | can't enable inactive unit; can't disable with active tasks | integration (available-units gate) |
**Build order:** Verification Units API/UI → Clients → Products (+C↔P) → CPV matrix → `available-units` resolver (the bridge into Case creation). Each module ships its tests in the same PR.

---

# FINAL OUTPUT

1. **Registry Review:** KEEP all but `mis_fields`; ADD `version`, `description`, `created_by`, `updated_by`; REMOVE `mis_fields`. **Applied.**
2. **Missing Fields:** none remain for Cases/Tasks (rate is a separate table; bank-code mapping is CPV/MIS-phase).
3. **Task Creation Flow:** validated end-to-end (sequence/API/DB/RBAC) — **no redesign**; unit FK + CPV + active-unique cover it.
4. **Test Architecture:** vitest, 5 layers, ephemeral-DB integration, `test→build` gate, test-first mandatory.
5. **test-utils Design:** factories/builders/fixtures/helpers/assertions; 7 factories specified.
6. **Test Matrix:** 5 suites + coverage (registry ≥90% / 100% invariant branches; v2 floor ≥80%).
7. **Master Data Plan:** Verification Units · Clients · Products · CPV — tables/APIs/services/repos/UI/validation/tests defined.
8. **Package Validation:** KEEP `access·config·sdk·test-utils`; **MERGE `contracts`→`sdk`** (Day-1, one web client).
9. **Migration Decision:** **B** — source-only for real DBs; applied to ephemeral test DB for test-first.
10. **Build Readiness:** ✅ YES.

> ## ✅ "Verification Unit Registry is LOCKED. Proceed to Master Data implementation."

No architecture redesign · no new models · no new workflows · no further audits. Next: build the Verification Units API/UI + its test suite (test-first), then Clients → Products → CPV.

---
*Build gate — implementation readiness only. Gate fixes applied to the DDL + spec (uncommitted source). Registry locked.*
