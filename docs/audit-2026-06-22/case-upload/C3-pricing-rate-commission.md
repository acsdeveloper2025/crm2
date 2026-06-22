# C3 — Pricing dependencies (Rate / Commission / Rate-types) through the bulk Case-Import lens (ADR-0059)

**Audit date:** 2026-06-22 · **Scope:** does case/task creation REQUIRE a rate or commission to exist, or are amounts resolved later (assignment/billing)? · **Mode:** READ-ONLY, no code changed.

## TL;DR — the one decision that matters for the importer

| Pricing value | When resolved | Gates creation? | Import row carries it? |
|---|---|---|---|
| **Client rate / `client_rate_type`** (billing LABEL) | **Read-time only** — live subquery from `rates`, never stamped on the task | **NO.** A case/task with no matching `rates` row is created fine; the rate column just reads `null` | **MUST NOT** — auto-resolved, no column |
| **Client rate AMOUNT** | Billing/MIS read-time (commission/rate laterals) | **NO** | **MUST NOT** |
| **`field_rate_type`** (commission KEY LOCAL/OGL) | **Create/assign time** — auto-derived from the **assignee's** commission | **YES, but only for an ASSIGNED FIELD task** (`assigneeId` + `visitType=FIELD`). Derivation null ⇒ `NO_FIELD_COMMISSION` 400 | **MUST NOT** (server-derived). Unassigned/OFFICE rows never hit it |
| **Commission AMOUNT** | Completion time (stamped) / billing read-time | **NO** at create | **MUST NOT** |

**Bottom line:** Case creation itself touches **zero** pricing. The ONLY pricing gate in the whole create path is the **`NO_FIELD_COMMISSION`** block, and it fires **only when a row both (a) names an assignee AND (b) is a FIELD visit**. An import that creates cases + **unassigned (PENDING)** tasks — or OFFICE tasks, or KYC/desk tasks — never touches a rate or commission and can never be blocked on pricing. Pricing is otherwise a pure read-time concern (billing/MIS), decoupled from creation.

---

## 1. Client rate (`rates` / RateManagementPage) — billing LABEL, never stamped, never gates

`client_rate_type` is **resolved live at read-time**, not stamped on the task at create. It appears as a correlated subquery inside the task-view column list:

- `apps/api/src/modules/cases/repository.ts:246-258` — `TASK_VIEW_COLS` selects `client_rate_type` via `(SELECT r.client_rate_type FROM rates r WHERE r.client_id=… AND r.product_id=… AND r.verification_unit_id=ct.verification_unit_id AND r.is_active … ORDER BY <location CASE-rank> LIMIT 1)`. **Null when no active rate exists for the CPV** (header comment, `repository.ts:240`). It is computed every time a task is read — never written to `case_tasks`.
- There is **no `client_rate_type` column on `case_tasks`** and **no `rates` lookup** in `cases.repository.create` (`repository.ts:395-445` — INSERT covers case + applicants + audit only) or in `addTasks` / `assignTask` INSERTs. A missing client rate therefore **DEFERS to billing** and surfaces as a blank rate label/amount, never an error at create.
- `clientRateType` storage is a **free-text varchar snapshot**, NOT FK-validated against the `rate_types` lookup: `packages/sdk/src/rates.ts:59` `z.string().trim().min(1).max(60)`; the rates IMPORT passes it through verbatim (`apps/api/src/modules/rates/import.ts:22,35,115` — `z.string().optional()`). The `rate_types` table only feeds the Rate-Management dropdown; `0014_rate_types_lookup.sql:1-4` says explicitly "stores the chosen code (snapshot)… This table only supplies the dropdown options." So the client rate-type is a label, not a resolvable entity, and it is **out of scope for a case-import row** (it lives on the `rates` table, set when a rate is configured — not per case).

**Verdict:** the client rate (existence, type, amount) **DEFERS** entirely. A bulk case-import row neither carries nor needs any client-rate value, and a missing rate never blocks an import row.

## 2. Field rate type (ADR-0056) — the ONE create-time pricing gate

`case_tasks.field_rate_type` (the commission KEY, enum `LOCAL`/`OGL`, plus server-stamped `OFFICE`) **is** stamped at create/assign and **is** derived from the assignee's commission.

### Derivation functions (the "find the derivation" answer)
- **Assign-at-create (new task):** `deriveFieldRateTypeForNewTask` — `cases/repository.ts:204-234`. Reads the case's client/product + the chosen location, queries `commission_rates` for the **assignee** (`user_id = $1`), active, `field_rate_type IS NOT NULL AND <> 'OFFICE'`, with Universal-able client/product/unit dims and a location set `IN (areaId, pincodeId, case.area, case.pincode)`; most-specific `ORDER BY … LIMIT 1`. Returns `null` if the executive has no matching commission row.
- **Assign an existing task (single + bulk):** `deriveFieldRateTypeForTask` — `cases/repository.ts:166-200`. Same logic keyed off the persisted task's location.

### Where it's stamped + where it BLOCKS
| Path | Stamp / block site | Block condition | Error |
|---|---|---|---|
| Add-tasks assign-at-create | `cases/repository.ts:613-628` | `assignee && visitType==='FIELD' && !fieldRateType` (no explicit value) AND derivation returns null | **`NO_FIELD_COMMISSION` (400)**, `repository.ts:623` |
| Single assign (`assignTask`) | `cases/repository.ts:854-859` | `visitType==='FIELD' && !fieldRateType` AND derivation null | **`NO_FIELD_COMMISSION` (400)**, `repository.ts:857` |
| Bulk assign | `tasks/service.ts:272-282` (calls `caseRepository.assignTask`) | same; caught per-row | per-row status `NO_FIELD_COMMISSION`, count in `noFieldCommissionCount` (`service.ts:259,277,291`) |
| OFFICE task | INSERT `CASE WHEN $7::varchar='OFFICE' THEN 'OFFICE' …` (`repository.ts:641`); assign `repository.ts:866` | n/a — **auto-stamped 'OFFICE', never blocks** | — |
| **Unassigned (PENDING) task** | `field_rate_type` stays **NULL** | guard requires `assignee` (`repository.ts:614`) — **never reached** | — |

### Key gate properties for the importer
- **Conditional, not universal:** the block fires **only** when a row is `assigneeId` + `visitType=FIELD`. The schema enforces `assigneeId ⇒ visitType` and `FIELD assign ⇒ areaId + pincodeId` (`packages/sdk/src/cases.ts:446-453`).
- **Explicit override exists** but the web never sends it; `fieldRateType` (enum `LOCAL`/`OGL`, `cases.ts:82,435`) bypasses derivation if present (`repository.ts:613-614`, `854`). The enum has **no OFFICE** — OFFICE is server-only.
- **DB column:** `case_tasks.field_rate_type` is **nullable** with CHECK `IN ('LOCAL','OGL','OFFICE')` or NULL (`db/v2/migrations/0084_office_field_rate_type.sql:19`). So a PENDING task with NULL is legal.
- **Derivation is alignment-safe:** it mirrors `COMMISSION_LATERAL` minus the field-rate-type and tat-band equalities, so a successfully derived band is guaranteed to resolve a commission amount downstream (`repository.ts:157-164,191-195`). It does **not** consult `rates` — only `commission_rates`.

**Verdict:** `field_rate_type` is **auto-derived (MUST NOT be in the import file)** and is the **only pricing value that can BLOCK an import row** — and only for assign-at-create FIELD rows.

## 3. Commission rates (`commissionRates`, ADR-0046/0050) — required only to assign a FIELD task

- A commission row is **REQUIRED** for a task to be **created-as-assigned-FIELD** (or assigned later as FIELD) — that's exactly the `NO_FIELD_COMMISSION` gate above. It is **NOT** required to create a case, an unassigned task, an OFFICE task, or a KYC/desk task.
- The commission AMOUNT is **computed lazily** (point-in-time / completion-stamped), never at create — `commissionRates/service.ts` only does CRUD + import; no create-time consumption. The amount is resolved by the billing/MIS laterals, and per memory (commission rebuild) is stamped at completion via `stampCommissionSnapshot`, not at case/task creation.
- Commission dims (ADR-0046/0050): `user_id` (required), `field_rate_type` (LOCAL/OGL/OFFICE), Universal-able `client_id`/`product_id`/`verification_unit_id`, required `location_id`, optional `tat_band`. Resolution = most-specific wins (`commissionRates/repository.ts`; mirrored in the derivation order-by `repository.ts:186-195`).
- **Importer implication:** if the import is to **assign FIELD tasks**, the chosen executive must **already** have a commission row at the case/task location (PRE-EXIST) or the row 400s. If the import only creates PENDING/OFFICE tasks, commission existence is irrelevant — it becomes a later concern at the (separate) assignment step.

## 4. Rate types (`rateTypes`) — two different enums, one seeded, one FK-free

There are **two unrelated "rate type" concepts** — do not conflate them:

| Concept | Values | Storage | Resolve for import? |
|---|---|---|---|
| **Client rate type** (billing label) | `rate_types` lookup: LOCAL/OGL/OUTSTATION + numbered 1-5 variants (`db/v2/migrations/0014_rate_types_lookup.sql:19-24`) | **free-text varchar snapshot** on `rates.client_rate_type`, NOT FK-validated (`packages/sdk/src/rates.ts:59`; dropdown-only table, migration header) | N/A for case-import — lives on `rates`, not on a case/task |
| **Field rate type** (commission key) | enum `LOCAL`/`OGL` (`packages/sdk/src/cases.ts:82`) + server-stamped `OFFICE` | `case_tasks.field_rate_type` varchar, CHECK-constrained (`0084:19`) | **server-derived, never in the file** |

- `rateTypes` module is a **read-only managed dropdown list** (`rateTypes/service.ts:1-6`, `rateTypes/repository.ts:4-12`, route `GET /rate-types`). It is **not** consulted anywhere in the case/task create or assign path. It feeds only the Rate-Management UI.
- The FIELD enum (LOCAL/OGL) is the only rate-type the case/task path uses, and it is derived, not chosen by the operator.

**Verdict:** no rate-type column belongs in a case-import row. The client rate-type is `rates`-resident free text; the field rate-type is server-derived.

## 5. Importer column map — what a case/task row must / must-not carry (pricing only)

| COLUMN | RESOLVE | REQUIRED? | PRE-EXIST (+ error) | BLOCKS vs DEFERS | CARDINALITY |
|---|---|---|---|---|---|
| *(no client-rate column)* | — | **OMIT** | client rate looked up at billing read-time; absence ⇒ blank label/amount | **DEFERS** | n/a |
| *(no `clientRateType` column)* | — | **OMIT** | label lives on `rates`, snapshot free text; not a case attribute | **DEFERS** | n/a |
| *(no `fieldRateType` column)* | server-derives from assignee commission | **OMIT** (explicit override exists but file must not set it) | for an **assigned FIELD** row, the assignee MUST have a matching active `commission_rates` row at the location → else **`NO_FIELD_COMMISSION` 400** | **BLOCKS** — but only the assign-at-create FIELD row; PENDING/OFFICE rows DEFER | 0/1 per assigned-FIELD task |
| *(no commission column)* | computed lazily (completion/billing) | **OMIT** | only needed if the row is assigned FIELD (see above) | **BLOCKS if assigned-FIELD, else DEFERS** | n/a |

### Net rule for ADR-0059
1. **Pricing carries ZERO columns** in a case-import row. Every pricing value is either read-time (client rate/amount, commission amount) or server-derived (`field_rate_type`).
2. **The only pricing-driven import failure is `NO_FIELD_COMMISSION`**, and it is reachable **only if the importer supports assign-at-create AND the row is FIELD + has an assignee**. Recommended posture: import cases + **PENDING tasks** (no assignee) → pricing can never block a row; assignment (and thus the commission requirement) happens later in the normal assign flow. If assign-at-create is in scope, the importer must surface `NO_FIELD_COMMISSION` as a per-row, non-fatal validation error (mirror `bulkAssign`'s per-row status, `tasks/service.ts:252-292`) and require the assignee's commission to PRE-EXIST.
3. **Do not add any rate-type/amount column to the template** — they would be ignored at best, or (if wired) duplicate authoritative master data (`rates`/`commission_rates`) and violate the read-time-resolution model.

---

## Open questions for ADR-0059
1. **Does the bulk importer create tasks assigned, or PENDING?** If PENDING-only, pricing is a non-issue (no gate). If assign-at-create is wanted, `NO_FIELD_COMMISSION` becomes a real per-row failure mode and the file must pre-validate that each assignee has a commission at the row's location.
2. **Per-row vs all-or-nothing on `NO_FIELD_COMMISSION`?** `addTasks` currently runs all tasks in **one transaction** (`cases/repository.ts:600` `withTransaction`) and **throws** on the first `NO_FIELD_COMMISSION` (`repository.ts:623`), rolling back the whole batch — unlike `bulkAssign`, which is per-row tolerant. A bulk case-import that uses assign-at-create would inherit the all-or-nothing throw; ADR-0059 must decide whether to preview-validate pricing per row before confirm (recommended, matching the rates/commission import preview pattern, `rates/service.ts:174-186`).
3. **Should the importer offer a client-rate/commission existence *warning* (not block)?** Even though missing rates don't block creation, a case whose CPV has no active `rates` row will bill blank. A non-fatal preview warning could be valuable — but it is advisory, never a hard gate.

## File:line anchors
- Case create touches no pricing: `apps/api/src/modules/cases/repository.ts:395-445`
- Client rate read-time resolution (never stamped): `apps/api/src/modules/cases/repository.ts:240-258`
- Field-rate derivation (assign-at-create / existing): `apps/api/src/modules/cases/repository.ts:204-234` / `166-200`
- `NO_FIELD_COMMISSION` block sites: `apps/api/src/modules/cases/repository.ts:614,623` (new) · `855,857` (assign) · `tasks/service.ts:277` (bulk per-row)
- Add-tasks schema (pricing fields optional/derived): `packages/sdk/src/cases.ts:410-457` (`fieldRateType` `:435`, refines `:446-453`)
- Create-case schema (no pricing fields): `packages/sdk/src/cases.ts:364-384`
- FIELD/CLIENT rate-type enums: `packages/sdk/src/cases.ts:82` · `packages/sdk/src/rates.ts:59`
- `ratePreview` (display-only, both sides): `apps/api/src/modules/cases/repository.ts:513-547` / `service.ts:193-201`
- `field_rate_type` column CHECK (nullable): `db/v2/migrations/0084_office_field_rate_type.sql:19`
- `rate_types` seed (dropdown-only, snapshot): `db/v2/migrations/0014_rate_types_lookup.sql:1-24`
- Rate / commission import resolve pattern to mirror: `apps/api/src/modules/rates/import.ts:66-130` · `apps/api/src/modules/commissionRates/import.ts`
