# C2 — Catalog Dependency Chain (Client → Product → CPV → Verification-Unit enablement)

**Audit-only.** Maps the catalog dependency chain a bulk Case-Creation importer (ADR-0059) must replicate. Read-only; nothing changed.

Scope: the chain that must **pre-exist** before a case/task can be created — Client, Product, the `client_products` (CPV) link, and `client_product_verification_units` (the "CPV units" enablement). Plus the verification-unit master fields that drive a task's required fields.

> The case-creation API takes **numeric ids and UUIDs only** — there is NO code→entity resolution anywhere in `cases/*`. A spreadsheet import that carries human CODES must do all the lookups itself, exactly as the existing CPV-link import does (`apps/api/src/modules/cpv/import.ts`).

---

## The dependency graph

```
 SPREADSHEET COLUMN        RESOLVE (code→id)             MUST PRE-EXIST                CREATE-TIME GATE
 ─────────────────         ────────────────────          ──────────────────            ─────────────────────────
 Client Code  ───────────► clients.code (UNIQUE) → id     clients row, USABLE           cases.client_id FK (0010)
        │                  via clientService.options()    (is_active ∧ eff_from≤now)     → 400 INVALID_REFERENCE if id absent
        ▼
 Product Code ───────────► products.code (UNIQUE) → id    products row, USABLE          cases.product_id FK (0010)
        │                  via productService.options()   (PRODUCTS ARE GLOBAL —         → 400 INVALID_REFERENCE if id absent
        │                                                  not client-scoped)
        ▼
 (client_id, product_id) ─► client_products              client_products row for        *** NO GATE AT CASE CREATE ***
   PAIR                      (uq_client_products UNIQUE)   the (client,product) pair      cases.create does NOT verify the
        │                                                  ── REQUIRED for tasks,         CP link exists (only the two single
        │                                                     NOT for the bare case      FKs). A case with no CP link is creatable
        ▼                                                                                 but can hold ZERO tasks.
 Verification Unit Code ──► verification_units.code        cpvu row enabling THAT unit    *** THE CPV-ENABLEMENT GATE ***
   (per task)               (UNIQUE) → id                  for THAT client_product        addTasks: repo.allUnitsEnabled(...)
        │                   via VU options()               (uq_cpvu UNIQUE), USABLE        → 400 UNIT_NOT_ENABLED
        ▼                                                                                  (case create itself adds NO tasks)
 case_tasks.verification_unit_id  ─────────────────────────────────────────────────────► FK → verification_units(id) (0010)
```

**One-line answer to the critical question:** YES — a task's verification unit MUST be CPV-enabled for the case's client+product. The gate is `caseService.addTasks` → `repo.allUnitsEnabled(clientId, productId, unitIds)` → `400 UNIT_NOT_ENABLED`. You CANNOT create a task for a non-enabled unit. But note: **case creation and task creation are two separate API calls** — `POST /cases` creates the bare case (no CPV check), and `POST /cases/:id/tasks` adds the units (CPV-checked). An importer that wants "case + its tasks" must do both, and the CPV gate only fires on the second.

---

## 1 — Client

| Aspect | Detail |
|---|---|
| **Case reference** | `cases.client_id integer NOT NULL REFERENCES clients(id)` — `db/v2/migrations/0010_cases.sql:12`. By **numeric id**, never code. |
| **API field** | `CreateCaseSchema.clientId: positiveInt` — `packages/sdk/src/cases.ts:366`. No code path. |
| **FE create form picker** | `GET /api/v2/clients/options` → `Option[]` {id, code, name} — `apps/web/src/features/cases/CaseCreatePage.tsx:56-59`. Auto-selects when the actor's scoped portfolio leaves exactly one (`:66-68`). |
| **RESOLVE (importer)** | `clients.code` (UNIQUE, `0002:8`) → id. Pattern: `clientService.options()` returns USABLE rows; build `Map(code→id)` — see `cpv/import.ts:49-50`. |
| **PRE-EXIST + active gate** | The `options()` source returns ONLY **USABLE = `is_active AND effective_from <= now()`** (`clients/repository.ts:70-79`, ADR-0017). An inactive/future-dated client code will NOT resolve via options → preview error "unknown client code". The raw FK (`cases.client_id`) does not itself check active/effective — a stale id that exists would still insert — so the importer must enforce USABLE-only itself (the existing CPV import does, by resolving only through `options()`). |
| **Error if missing** | importer-side: "unknown client code" in preview (per CPV-import model). API-side fallback if a bad id is passed directly: `repo.create` catches FK violation → `400 INVALID_REFERENCE` (`cases/repository.ts:441-443`). |

## 2 — Product

| Aspect | Detail |
|---|---|
| **Case reference** | `cases.product_id integer NOT NULL REFERENCES products(id)` — `0010_cases.sql:13`. Numeric id. |
| **API field** | `CreateCaseSchema.productId: positiveInt` — `cases.ts:367`. |
| **FE picker** | `GET /api/v2/products/options` — `CaseCreatePage.tsx:60-63`. |
| **GLOBAL vs client-scoped?** | **Products are GLOBAL.** `products` is a flat master with a UNIQUE `code` (`0002:18`); `products.options()` is NOT scoped to a client (`products/repository.ts:70-79`). The client↔product relationship lives ONLY in the `client_products` link table. The FE create form picks client and product **independently** — it does NOT filter products by the chosen client. So "is this product valid FOR this client?" is enforced downstream at the CPV/task layer, NOT at product selection. |
| **RESOLVE** | `products.code` (UNIQUE) → id via `productService.options()`; `Map(code→id)` — `cpv/import.ts:49,51`. |
| **PRE-EXIST + active gate** | Same as client: `options()` → USABLE-only. |
| **Error if missing** | "unknown product code" (preview) / `400 INVALID_REFERENCE` (raw bad id). |

## 3 — CPV mapping (`client_products`) — the client↔product link

| Aspect | Detail |
|---|---|
| **What it is** | One row per (client, product) pair. `uq_client_products UNIQUE (client_id, product_id)` — `0002:33`. Has its own `is_active` + `effective_from` (ADR-0017). |
| **Required for the bare CASE?** | **NO.** `cases.create` (`cases/repository.ts:395-445`) inserts `client_id`/`product_id` with only their individual FKs — it does NOT look up or require a `client_products` row. **A case can be created for a (client, product) pair that has no CP link.** |
| **Required for TASKS?** | **YES, transitively.** A unit can only be CPV-enabled if a `client_products` row exists (the cpvu FK chains through it), so to add ANY task the CP link must exist + be active + in effect. With no CP link, `availableUnits` returns `[]` and `allUnitsEnabled` returns false for every unit → `400 UNIT_NOT_ENABLED`. |
| **What happens if it doesn't exist** | Case: creates fine but is a "shell" — zero addable tasks. Tasks: blocked `400 UNIT_NOT_ENABLED`. |
| **Importer implication** | If the import format is "one row = a case with its task units", the importer must **fail the row's tasks** (or the whole row) when the (client, product) CP link is missing/inactive. The bare-case-creatable-without-CP-link asymmetry is a real trap: an importer that only checks the two single FKs would silently create task-less shells. |
| **Resolve key (if importing CP links too)** | client code + product code → the link; existing path = `cpv/import.ts` (B-14), 409 `CLIENT_PRODUCT_EXISTS` on dup, USABLE-only resolution. |

## 4 — Verification-Unit enablement (`client_product_verification_units`, "CPV units") — THE create-time gate

| Aspect | Detail |
|---|---|
| **What it is** | One row per (client_product, verification_unit) — `uq_cpvu UNIQUE (client_product_id, verification_unit_id)` — `0001:84`. FK `client_product_id → client_products` (wired in `0002:37-41`), FK `verification_unit_id → verification_units` (`0001:80`). Own `is_active` + `effective_from`. |
| **FE dropdown source (task unit picker)** | `GET /api/v2/cases/available-units?clientId=&productId=` — `apps/web/src/features/cases/AddTasksForm.tsx:83-87`. Backed by `caseService.availableUnits` → `repo.availableUnits` (`cases/repository.ts:494-506`). Returns ONLY the CPV-enabled, **USABLE** units: `cpvu.is_active AND cp.is_active AND vu.is_active AND vu.effective_from<=now() AND cp.effective_from<=now() AND cpvu.effective_from<=now()`. So the FE physically cannot offer a non-enabled unit. |
| **API create-time gate (the authoritative one)** | `caseService.addTasks` — `cases/service.ts:203-228`. Line **207-210**: `repo.allUnitsEnabled(cp.clientId, cp.productId, unitIds)` → if false, `throw AppError.badRequest('UNIT_NOT_ENABLED')`. `cp` comes from `repo.clientProductOf(caseId)` (`service.ts:204`) = the case's stored client_id/product_id. |
| **`allUnitsEnabled` SQL** | `cases/repository.ts:550-562`: counts DISTINCT enabled units matching `cp.client_id=$1 AND cp.product_id=$2 AND cpvu.is_active AND cp.is_active AND cp.effective_from<=now() AND cpvu.effective_from<=now() AND vu.id = ANY($3)`; returns true iff count == `new Set(unitIds).size`. |
| **Can you create a task for a non-enabled unit?** | **No.** The gate is server-side and authoritative (not just FE). Non-enabled, deactivated CP link, future-dated, or a unit not enabled for *this* client+product → `400 UNIT_NOT_ENABLED`. |
| **⚠️ GATE ASYMMETRY (importer-relevant defect/edge)** | `allUnitsEnabled` (`repository.ts:550-562`) does **NOT** check `vu.is_active` or `vu.effective_from`, whereas the FE picker `availableUnits` (`494-506`) **DOES**. Consequence: if a verification unit row is deactivated/future-dated but its cpvu enablement row is still active+in-effect, the FE will hide the unit, but a direct API `addTasks` call (which an importer makes) will **PASS** the gate and create the task. An importer must NOT rely on `allUnitsEnabled` to reject a deactivated VU master — it should resolve units through `availableUnits` semantics (or VU `options()` USABLE-only) to match the manual-flow behavior. Flag for ADR-0059. |

## 5 — Verification Unit master (`verification_units`) — fields that drive a task's required fields

Source: `db/v2/migrations/0001_verification_unit_registry.sql:17-67`, `packages/sdk/src/verificationUnit.ts`.

| Field | Type / values | Why it matters to task creation |
|---|---|---|
| `code` | varchar(64) UNIQUE, UPPER_SNAKE, immutable (`0001:19`) | The resolve key for an importer (code→id). |
| `kind` | `FIELD_VISIT` \| `KYC_DOCUMENT` \| `DESK_DOCUMENT` (`0001:24`, sdk `KINDS`) | The single biggest driver. Determines whether the task is a field visit (needs address + location + assignee from FIELD pool + commission) or a desk/KYC doc task (no address, OFFICE/KYC pool). The 9 mobile-hardcoded FIELD_VISIT units are `is_system` (locked). |
| `worker_role` | `FIELD_AGENT` \| `KYC_VERIFIER` (`0001:26`) | The assignee pool. FIELD_VISIT⇒FIELD_AGENT; KYC_DOCUMENT⇒KYC_VERIFIER (DB CHECK `0001:54-66`, sdk invariants `verificationUnit.ts:83-109`). |
| `required_form_code` | varchar(64), NULL for doc-only (`0001:30`) | The form schema the field app renders. NOT NULL is required for FIELD_VISIT. |
| `required_photos` / `required_gps` | int / bool | FIELD_VISIT ⇒ photos≥5, gps=true (drives mobile capture, not case-create input). |
| `is_active` / `effective_from` | bool / timestamptz | USABLE gate (ADR-0017). See the gate-asymmetry note in §4. |
| `is_system` | bool (ADR-0056, mig 0086) | The 9 locked FIELD_VISIT units; read-only (no edit/deactivate). Relevant only to VU admin, not case import — but an importer should treat their codes as the stable canonical set. |
| `sort_order` | int | Only affects picker ordering. |

**Visit-type / address coupling (the task-side conditional an importer must mirror):** `AddTasksSchema` (`cases.ts:410-457`) — `address` is REQUIRED only when `visitType === 'FIELD'` (`:442-445`); `visitType` is required when `assigneeId` is set (`:446-449`); a FIELD assign-at-create requires `areaId + pincodeId` (`:450-453`). Note `visitType`/`assigneeId` are NOT the VU's `kind` — they are the dispatch choice at task-add time; the importer chooses them (assign-later ⇒ omit all → task born PENDING).

---

## Required / conditional summary (import lens)

| Column | Resolve | Required? | Pre-exist (error if missing) | Blocks vs Defers | Cardinality |
|---|---|---|---|---|---|
| **Client Code** | `clients.code`→id, USABLE-only | **Required** (case) | clients row active+in-effect; else "unknown client code" (preview) / `400 INVALID_REFERENCE` | **BLOCKS** the case row | 1 client / case (case header) |
| **Product Code** | `products.code`→id, USABLE-only; GLOBAL | **Required** (case) | products row active+in-effect | **BLOCKS** the case row | 1 product / case |
| **(client,product) CP link** | derived from the two codes | **CONDITIONAL** — not for the bare case; **required for ANY task** | `client_products` row active+in-effect; else units empty → `400 UNIT_NOT_ENABLED` on add-tasks | Bare case: DEFERS (creatable shell). Tasks: **BLOCKS** | 1 link / pair |
| **Verification Unit Code** (per task) | `verification_units.code`→id | **Required per task** | cpvu enablement for THIS client_product, active+in-effect; else `400 UNIT_NOT_ENABLED` | **BLOCKS** the task | **N units / case** — each unit = 1+ task rows (no unique(case,unit); a unit may repeat — Zion "NO OF" count). One flat spreadsheet row likely = one task; a case = many rows grouped by case key. |
| **Applicant (per task)** | `case_applicants.id` (UUID, created with the case) | Required per task | task's `applicantId` must belong to THIS case → `400 INVALID_APPLICANT` (`service.ts:211-213`) | **BLOCKS** the task | N applicants / case; each task targets one |

---

## Open questions for ADR-0059

1. **Two-call shape.** Manual flow = `POST /cases` then `POST /cases/:id/tasks`. The CPV gate only fires on the second call. Will the importer reuse these two services (recommended — keeps the gate) or write a new combined path? If new, it must replicate `allUnitsEnabled` + applicant-ownership + assignee-eligibility checks (`service.ts:207-223`).
2. **Shell-case policy.** A case with a (client,product) pair that has no CP link is creatable but task-less. Should the importer reject such rows up front (recommended) rather than create empty shells?
3. **VU gate asymmetry (§4).** `allUnitsEnabled` ignores `vu.is_active`/`vu.effective_from`; `availableUnits` honors them. The importer should resolve units through USABLE semantics so a deactivated VU master is rejected (matching the manual UI), not silently accepted by the raw gate. Worth fixing the gate itself under ADR-0059 or a follow-up.
4. **Code casing.** `verification_units.code` is UPPER_SNAKE-constrained; client/product codes are free varchar(64) but compared exactly in the resolve `Map`. The importer must define whether code matching is case-sensitive (current CPV import is exact-match).
5. **Effective-dating.** All four entities (client, product, CP link, cpvu) carry `effective_from`. A future-dated link won't resolve through `options()`/`availableUnits`. Confirm the importer rejects (not silently skips) future-dated dependencies.

## File:line anchors

- Case create flow + CPV gate: `apps/api/src/modules/cases/service.ts:174-228` (`create` :174-177, `addTasks` + `allUnitsEnabled` gate :203-228, `availableUnits` :189-191).
- Case repo: `apps/api/src/modules/cases/repository.ts` — `create` :395-445, `clientProductOf` :447-453, `availableUnits` :494-506, `allUnitsEnabled` :550-562, `caseApplicantIds` :565-568, `addTasks` :575-686.
- Schemas: `packages/sdk/src/cases.ts` — `CreateCaseSchema` :364-384, `AddTasksSchema` :410-459. `packages/sdk/src/verificationUnit.ts` — master DTO :30-62, invariants :64-109.
- Catalog repos: `apps/api/src/modules/clients/repository.ts:70-79` (`options`), `apps/api/src/modules/products/repository.ts:70-79` (`options`), `apps/api/src/modules/cpv/repository.ts` (CP + cpvu CRUD, dup→409).
- Existing code→id resolve model: `apps/api/src/modules/cpv/import.ts:46-83` (`buildClientProductSpec`).
- FE pickers: `apps/web/src/features/cases/CaseCreatePage.tsx:56-71` (client/product options), `apps/web/src/features/cases/AddTasksForm.tsx:83-87` (available-units).
- DB: `db/v2/migrations/0001_verification_unit_registry.sql:17-87` (VU master + cpvu), `0002_clients_products_cpv.sql` (clients/products/client_products, uniques + FKs), `0010_cases.sql:9-72` (cases + case_tasks FKs).
