# Rate Type Assignment — Universal + v2-table redesign — implementation plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. The migration's `UNIQUE NULLS NOT DISTINCT` swap is the load-bearing re-run item — CTO owns it inline; the 3× `migrations.rerun.test.ts` is the arbiter.

**Goal:** Make `rate_type_assignments` product/unit **Universal-able** (NULL = all, rendered "Universal") and redesign `/admin/rate-type-assignments` as a v2-styled **per-unit table** with the rate-type selection inline beside each unit. Availability resolves as a **union-with-wildcards**. Spec: [`docs/specs/2026-06-25-rate-type-assignment-universal-redesign-design.md`](../specs/2026-06-25-rate-type-assignment-universal-redesign-design.md). **ADR-0069** (amends ADR-0067), **mig 0096** (verify next-free at build).

**Sequencing (owner decision at build):** this layers on the **unpushed Phase C** `available` resolver. Either bundle onto the Phase C branch `feat/rate-type-fk-conversion`, or push Phase C first then branch off the updated origin/main. Default if unstated: **bundle on the Phase C branch** (no extra prod push).

---

## Task 1: ADR-0069
Create `docs/adr/ADR-0069-rate-type-assignment-universal.md` (Accepted; **amends ADR-0067**). Decision: product/unit Universal-able via NULL (rendered "Universal", consistent with the live commission model — rejected a stored marker/retrofit); availability = union-with-wildcards; per-unit table UI. Index in `docs/adr/README.md`. Commit.

## Task 2: Migration 0096 + re-run guard (CTO INLINE — load-bearing)
**Files:** create `db/v2/migrations/0096_rate_type_assignment_universal.sql`; edit `migrations.rerun.test.ts`.
- [ ] **Step 1 — extend the rerun test (RED):** after the Phase B/`rate_type_assignments` assertions, assert `product_id`/`verification_unit_id` are NULLABLE and the unique constraint is `NULLS NOT DISTINCT` (query `pg_constraint`/`information_schema`), surviving the 3× apply.
- [ ] **Step 2 — write 0096** (idempotent, re-run-safe):
  - `ALTER TABLE rate_type_assignments ALTER COLUMN product_id DROP NOT NULL;` + same for `verification_unit_id` (no-op if already nullable).
  - Swap the unique constraint: `DROP CONSTRAINT IF EXISTS uq_rate_type_assignment;` then guarded `ADD CONSTRAINT uq_rate_type_assignment UNIQUE NULLS NOT DISTINCT (client_id, product_id, verification_unit_id, rate_type_id)` (guard on `pg_constraint` absence). PG18 supports `NULLS NOT DISTINCT`.
  - `idx_rta_combo` unchanged (NULL-tolerant).
- [ ] **Step 3 — iterate** via `DATABASE_URL=…:5433/crm2_test LC_ALL=C pnpm --filter @crm2/api exec vitest run migrations.rerun --coverage.enabled=false` until 3 passes clean + assertions hold. (Re-run note: the DROP/ADD-constraint must be idempotent — `ADD` guarded on absence; the `DROP NOT NULL` is naturally idempotent.)
- [ ] **Step 4 — commit** `feat(db): mig 0096 rate_type_assignments product/unit Universal-able (NULLS NOT DISTINCT) — ADR-0069`.

## Task 3: SDK + API (CTO inline for the resolver; subagent-assist on the rest)
- **SDK** `BulkSetRateTypeAssignmentsSchema`: `productId` + `verificationUnitId` → `posInt.nullable()` (null = Universal). Schema test for the nullable case. Keep `RateTypeAssignment` (the rows can carry null product/unit + null code/name for those).
- **`rateTypeAssignments/repository.ts`:**
  - `bulkSet`: the upsert + complement-deactivate must match NULLs — use `product_id IS NOT DISTINCT FROM $2` / `verification_unit_id IS NOT DISTINCT FROM $3` (so a Universal combo dedupes); `ON CONFLICT` relies on the NULLS-NOT-DISTINCT constraint.
  - `listForCombo` → **`listForClientProduct(clientId, productId|null)`**: return active assignments for (client, product|null) across all units (join `rate_types` code/name; null unit = the Universal-unit row). The admin page groups by `verificationUnitId` (null → All-units row).
- **`rateTypes/repository.ts` `available`** (the Phase-C-wired resolver): change exact-match → **union**: `WHERE a.client_id=$1 AND (a.product_id IS NULL OR a.product_id=$2) AND (a.verification_unit_id IS NULL OR a.verification_unit_id=$3) AND a.is_active AND rt.is_active AND rt.effective_from<=now()` → `SELECT DISTINCT rt.id, rt.code, rt.category ... ORDER BY rt.sort_order, rt.code`.
- **Controllers/services:** `listForClientProduct` validates clientId (required) + productId (optional/nullable); `bulkSet` validates via the nullable schema. Integration tests: Universal-product + Universal-unit assignment → `available` for a specific combo returns the union; bulk-set a Universal row + a specific row, confirm both resolve; the existing combo tests still pass. OpenAPI regen + contract test.

## Task 4: Web — per-unit table page (subagent-assist, CTO reviews)
Rewrite `apps/web/src/features/rateTypeAssignments/RateTypeAssignmentsPage.tsx`:
- Header: Client `<select>` (required) + Product `<select>` with first option **"All products (Universal)"** (value → null). Via `/clients/options`, `/products/options`.
- Once client + product chosen, load `api<RateTypeAssignment[]>('GET', '/api/v2/rate-type-assignments?clientId=&productId=')` (omit productId when Universal) + `rateTypes.list()` (the catalog) + `/verification-units/options` (the unit rows).
- v2-styled **table**: a search box; first row "**All verification units (Universal)**" (unit → null); then a row per active verification unit (`code — name`). Each row: an **inline rate-type multi-select** (chips of the catalog; pre-checked = that row's current assigned `rateTypeId`s from the load). "(none)" when empty.
- **Save** (one button): for each row whose set changed vs the loaded state, `POST /rate-type-assignments/bulk { clientId, productId|null, verificationUnitId|null, rateTypeIds }`; on success invalidate + "Saved".
- **"Universal"** rendered as the literal word everywhere a null dim appears. RBAC self-guard (`page.masterdata`); loading/empty/error (Hexagon + Retry); tokens only; no `any`/suppressions. Update/replace the Phase B e2e (`rateTypeAssignments.spec.ts`) for the new table (assign a unit's rate type + a Universal row → Save → reload → persisted).

## Task 5: Gate + review + browser-verify + STOP
- Full `DATABASE_URL=…:5433/crm2_test LC_ALL=C pnpm verify` + 3× rerun + full Playwright e2e.
- Adversarial review (DB: the constraint swap re-run safety; Security/CTO: the union resolver only widens; Design: the new table). Disposition in registry.
- Browser-verify on `crm2_dev` (apply 0096 first): assign LOCAL to a Universal-product row + OGL to a specific unit → confirm the Rate-Management picker's `available` for that combo shows the union; confirm the table shows "Universal" (never NULL). Update memory (project + MEMORY.md + §8 + registry). **STOP for owner push approval.**

## Build order
Task 1 (ADR) → **Task 2 (migration — CTO inline, the crux)** → Task 3 (resolver inline + SDK/repo subagent-assist) → Task 4 (web subagent-assist, CTO reviews) → Task 5 (gate, review, browser-verify, STOP). Foundation + the union resolver stay with the CTO; the page + the non-resolver repo edits fan out.

## DON'T-REGRESS
Money path (billing/commission, COMMISSION_LATERAL, EXCLUDEs) UNCHANGED — only `available` (the picker gate) becomes a union. Existing assignments (all non-NULL) stay valid. `available` must only WIDEN (never narrow) — a regression test guards it. Universal rendered "Universal" everywhere (never NULL). Migration idempotent + re-run-safe (the NULLS-NOT-DISTINCT swap is the load-bearing item; `migrations.rerun.test` proves it). Mobile/SDK string contracts unchanged. Commit author Mayur, no AI trailer; never push without explicit OK.
