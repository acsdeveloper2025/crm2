# Rate-Type Management — Phase C Implementation Plan (FK conversion + picker wiring)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. The migration (Task 2) is the load-bearing risk — the CTO owns it inline; the 3× `migrations.rerun.test.ts` is the TDD arbiter.

**Goal:** Make `rate_types` the FK source of truth. Add `rate_type_id integer REFERENCES rate_types(id)` to `rates` / `commission_rates` / `case_tasks`, backfill from the existing string/enum columns (auto-promoting orphan free-text `client_rate_type` into the catalog first), swap the two `*_no_overlap` EXCLUDE terms + drop the `case_tasks` string CHECK, **DROP the 3 old string columns in the SAME migration**, and wire the 3 pickers — all while keeping billing/commission **resolution unchanged** (only the value source becomes a FK) and the **mobile + SDK contracts byte-unchanged** (contracts keep emitting `clientRateType`/`fieldRateType` strings, now JOINed from the catalog code).

**Numbers (owner-confirmed collision-proof):** **ADR-0068**, **migration 0094**. Off origin/main `9ca1832`, branch `feat/rate-type-fk-conversion`.

**Spec:** [`docs/specs/2026-06-25-rate-type-management-design.md`](./../specs/2026-06-25-rate-type-management-design.md) §3.3 (FK conversion), §6 (resolution preserved). Builds on Phase A (catalog, mig 0092) + Phase B (assignment, mig 0093, both LIVE).

---

## ⚠️ The load-bearing risk — migration re-run safety (READ FIRST)

Prod re-runs the WHOLE migration set verbatim on every deploy. Phase C drops `rates.client_rate_type`, `commission_rates.field_rate_type`, `case_tasks.field_rate_type` **in place**. Several earlier migrations re-execute and would resurrect / clobber, traced through the actual SQL:

| Migration | What re-fires after Phase C | Guard Phase C must add |
|---|---|---|
| **0011** `case_tasks` | `IF NOT EXISTS field_rate_type → ADD distance_band + chk_case_task_distance_band`. After the drop, `field_rate_type` is gone → block re-fires, resurrects `distance_band` + stale CHECK. | Add `AND NOT EXISTS rate_type_id` to the guard (no-op once the FK exists). |
| **0012** `rates` | `ADD COLUMN IF NOT EXISTS rate_type_id` (no-op when present) + recreates the eligibility trigger + `rates_no_overlap`/`idx_rates_resolve` (all `IF NOT EXISTS` → skip). | Harmless **except** it depends on 0013's drop not firing — see 0013. |
| **0013** `rates` | (a) `IF NOT EXISTS client_rate_type → ADD rate_type varchar + rebuild rates_no_overlap on COALESCE(rate_type,'')`: after the drop, `client_rate_type` gone → resurrects `rate_type`. (b) **line 41 `DROP COLUMN IF EXISTS rate_type_id` UNCONDITIONAL** → drops Phase C's new FK. (c) **line 49 `DROP TABLE rate_types CASCADE` UNCONDITIONAL** → drops the managed catalog (+ CASCADE `rate_type_assignments` + Phase C's FK constraints), then 0014/0092 rebuild it with **reset IDENTITY ids** → Phase C's FK values dangle. | (a) guard the `client_rate_type` block additionally on `AND NOT EXISTS rate_type_id`. (b) guard line 41 on `IF EXISTS client_rate_type` (only the pre-Phase-C dead column). (c) guard line 49 on `IF NOT EXISTS rate_types.category` (only the pre-Phase-A catalog; the managed one has `category`). |
| **0058 / 0079** `commission_rates` | 0079 `IF NOT EXISTS field_rate_type → ALTER rate_type DROP NOT NULL + rebuild commission_rates_no_overlap on COALESCE(rate_type,'')`: after the drop, `field_rate_type` gone → ERROR (`rate_type` doesn't exist) / resurrection. | Add `AND NOT EXISTS rate_type_id` to 0079's guard. |
| **0083** renames | `IF EXISTS rate_type → RENAME …`. After Phase C, neither `rate_type` nor the renamed col exists → all `IF EXISTS` are false → no-op. **Safe as-is** (verify in the rerun test). | none expected — confirm via the test. |
| **0084** `case_tasks` CHECK | `IF EXISTS chk_case_task_field_rate_type → DROP; ADD CHECK (field_rate_type IN …)`. After Phase C the column is gone → `ADD CONSTRAINT … field_rate_type` ERRORS. | Guard the whole block on `IF EXISTS case_tasks.field_rate_type` (skip once the column is dropped). |

**The 3× rerun test (`apps/api/src/platform/__tests__/migrations.rerun.test.ts`) is the arbiter.** Phase C INVERTS its column assertions (old string cols GONE, `rate_type_id` present) and ADDS: catalog id-stability + `rate_type_assignments` survival + the EXCLUDEs keyed on `rate_type_id`. Iterate the guards until 3 consecutive passes are clean AND the assertions hold. **This is non-negotiable — a wrong guard = a prod outage.**

---

## Task 1: ADR-0068
Create `docs/adr/ADR-0068-rate-type-fk-conversion.md` (Accepted; relates ADR-0064/0067; **supersedes ADR-0050 §"client_rate_type is a free-text label"** fully — the value is now a FK). Decision: FK `rate_type_id` on rates/commission_rates/case_tasks, in-place column drop in mig 0094, resolution preserved (billing display-only JOIN, commission matches by id incl. OFFICE-id branch), the earlier-migration re-run guards (incl. the newly-found 0013 catalog-drop guard — a latent Phase-A/B data-loss bug this closes), contracts keep emitting the string codes via JOIN (mobile/SDK unaffected). Index ADR-0068 in `docs/adr/README.md`. Commit.

## Task 2: Migration 0094 + re-run guards (CTO INLINE — the crux, TDD via rerun test)
**Files:** create `db/v2/migrations/0094_rate_type_fk_conversion.sql`; edit `0011`, `0013`, `0079`, `0084` (re-run guards); edit `migrations.rerun.test.ts`.

- [ ] **Step 1 — invert + extend the rerun test (RED first).** Replace the lines that assert `rates→client_rate_type`, `case_tasks→field_rate_type`, `commission_rates→field_rate_type` with: `rates`/`case_tasks`/`commission_rates` each contain `rate_type_id` and NOT the old string col (`task_assignment_history` KEEPS `field_rate_type` — audit, not converted). ADD: (a) `rate_types` row count stable + a known code keeps its id across the 3 passes (id-stability); (b) `rate_type_assignments` table still exists after 3 passes; (c) `rates_no_overlap`/`commission_rates_no_overlap` survive; (d) the FK constraints `rates.rate_type_id→rate_types`, etc. exist. Run → RED.
- [ ] **Step 2 — write `0094` (in one transaction, strict order):**
  1. **Auto-promote** orphan rate labels: `INSERT INTO rate_types (code, name, is_active) SELECT DISTINCT UPPER(client_rate_type), UPPER(client_rate_type), true FROM rates WHERE client_rate_type IS NOT NULL ON CONFLICT (code) DO NOTHING;` (idempotent; commission/case_tasks codes are already LOCAL/OGL/OFFICE = in catalog).
  2. **Add** `rate_type_id integer REFERENCES rate_types(id)` (NULLABLE) to `rates`, `commission_rates`, `case_tasks` (`ADD COLUMN IF NOT EXISTS`).
  3. **Backfill** each: `UPDATE <t> SET rate_type_id = (SELECT id FROM rate_types WHERE code = UPPER(<t>.<oldcol>)) WHERE rate_type_id IS NULL AND <oldcol> IS NOT NULL;` (null old → null id; KYC legitimately null).
  4. **Swap the EXCLUDEs** (drop + guarded re-add): `rates_no_overlap` term `COALESCE(client_rate_type,'')` → `COALESCE(rate_type_id,-1)`; `commission_rates_no_overlap` term `COALESCE(field_rate_type,'')` → `COALESCE(rate_type_id,-1)`. (btree_gist already enabled; int in gist is fine — 0012 used `COALESCE(rate_type_id,-1)`.)
  5. **Drop** `chk_case_task_field_rate_type` (`DROP CONSTRAINT IF EXISTS` — FK supersedes the enum CHECK).
  6. **Drop** the 3 old columns: `ALTER TABLE rates DROP COLUMN IF EXISTS client_rate_type; … commission_rates DROP COLUMN IF EXISTS field_rate_type; … case_tasks DROP COLUMN IF EXISTS field_rate_type;` (KEEP `task_assignment_history.field_rate_type`).
  All steps idempotent (`IF NOT EXISTS`/`IF EXISTS`/guarded constraint add) so 0094 itself re-runs clean.
- [ ] **Step 3 — add the re-run guards** to the earlier migrations per the table above (0011, 0013 [×3: client_rate_type block, line-41 rate_type_id drop, line-49 catalog DROP TABLE], 0079, 0084). Each guard makes the block no-op once Phase C's state is present, while still running correctly on a fresh DB (pass-1 ordering: the guards key on markers that only appear AFTER 0094, so fresh-DB pass-1 behaves exactly as today up to 0094, then 0094 converts).
- [ ] **Step 4 — iterate via the rerun test** (`DATABASE_URL=…:5433/crm2_test LC_ALL=C pnpm --filter @crm2/api exec vitest run migrations.rerun --coverage.enabled=false`) until 3 passes are clean + all assertions hold. **Also** manually apply the full set 3× to a scratch DB and `\d rates`/`\d case_tasks`/`\d commission_rates` to eyeball the final schema (belt + suspenders for a money migration).
- [ ] **Step 5 — commit** `feat(db): mig 0094 rate_type_id FK conversion + re-run guards (0011/0013/0079/0084) — ADR-0068`.

## Task 3: Resolution SQL (CTO INLINE — money path) — `apps/api/src/platform/billing/laterals.ts` + `cases/repository.ts` TASK_VIEW
- **RATE_LATERAL** + the mirrored **TASK_VIEW_COLS** subquery: `SELECT rt.code AS client_rate_type, r.amount … FROM rates r LEFT JOIN rate_types rt ON rt.id = r.rate_type_id WHERE … ORDER BY <unchanged ladder>`. **WHERE/ORDER unchanged** (location ladder + id DESC) — only the projected value switches from the string col to the JOINed code. LEFT JOIN preserves KYC null-rate rows (code → null).
- **COMMISSION_LATERAL**: replace `cmr.field_rate_type = ct.field_rate_type` with `cmr.rate_type_id = ct.rate_type_id`; the OFFICE branch `OR (ct.field_rate_type = 'OFFICE' AND cmr.location_id IS NULL)` → `OR (ct.rate_type_id = (SELECT id FROM rate_types WHERE code = 'OFFICE') AND cmr.location_id IS NULL)`. id=id ⟺ code=code (1:1 FK) ⇒ **resolution identical**. Everything else (tat band, location ladder, point-in-time, ORDER) unchanged.
- TDD: the existing `billing.commission` + billing integration tests are the guard — they MUST stay green (same amounts). Add a case asserting the bill/commission resolve identically post-conversion (LOCAL + OFFICE + KYC-null).

## Task 4: Derive + writes (CTO INLINE — money path) — `cases/repository.ts`, `tasks/repository.ts`
- **deriveFieldRateTypeForTask / …ForNewTask**: read `cmr.rate_type_id` via `JOIN rate_types rt` → return `rt.code` (still a code, so the history write + API shape are unchanged); `WHERE … rt.code <> 'OFFICE' …` (replaces `field_rate_type <> 'OFFICE'`), location ladder + `(tat_band IS NULL) DESC` tie-break unchanged.
- **addTasks / assignTask / reassignRevokedTask writes**: `case_tasks.rate_type_id = (SELECT id FROM rate_types WHERE code = CASE WHEN <visit_type> = 'OFFICE' THEN 'OFFICE' ELSE <derived_code> END)` (null derived → null id). The **`task_assignment_history` INSERT keeps writing the CODE** to its `field_rate_type` varchar (audit unchanged).
- **TASK_VIEW / TASK_SELECT_BASE** (`cases` + `tasks` repos): `ct.field_rate_type` → `(SELECT code FROM rate_types WHERE id = ct.rate_type_id) AS field_rate_type` (or a LEFT JOIN) so `CaseTaskView.fieldRateType` stays the code string.

## Task 5: Repos read/write switch (rates + commissionRates) — subagent-assist, CTO reviews
- **rates/repository.ts**: list/search (`client_rate_type ILIKE` → `rt.code ILIKE` via JOIN), `RATE_VIEW_COLS` (JOIN rt.code AS client_rate_type), create/revise (resolve the SDK `clientRateType` code → `rate_type_id`; null → null), history tuple-match (`COALESCE(rate_type_id,-1)` or `rt.code`).
- **commissionRates/repository.ts**: list/search + view (JOIN rt.code AS field_rate_type), create/revise (resolve `fieldRateType` code → `rate_type_id`).
- Integration tests for both stay green (shape unchanged — the string fields still come back).

## Task 6: SDK + web pickers — subagent-assist, CTO reviews
- **SDK:** keep `Rate.clientRateType` / `CommissionRate.fieldRateType` / `CaseTaskView.clientRateType`/`.fieldRateType` as string codes (JOIN-sourced). **Retire `COMMISSION_RATE_TYPES`** from the Commission write path: `CreateCommissionRateSchema.fieldRateType` → a trimmed-uppercase string (any active catalog code; the FK + a service check enforce validity → 400 on a bad code). Keep `FIELD_RATE_TYPES` (case derive). OpenAPI regen.
- **Commission `CommissionRateRecordPage.tsx`**: replace the hardcoded `COMMISSION_RATE_TYPES` `<option>` map with **all active catalog rows** via `client.rateTypes.list()` (`/rate-types/options?active=true`) — NOT combo-gated (commission dims are Universal-able). Value = `code`.
- **Rate Management `RateRecordPage.tsx`**: switch the client-rate-type select from `/rate-types/options` to the **assignment-gated** `/rate-types/available?clientId&productId&verificationUnitId` (Phase B's resolver) once the combo is chosen (falls back to empty + an actionable "assign in Rate Type Assignments" hint when none). Value = `code`.
- **Case creation `AddTasksForm.tsx`**: unchanged (ADR-0056 derives server-side; the rate-preview already surfaces codes).

## Task 7: Gate + review + browser-verify + STOP
- **Mobile-safety re-confirm:** `sync/repository.ts` SYNC_SELECT + `sync/service.ts` toMobileTask carry NO `field_rate_type`/`client_rate_type`/`rate_type_id` → FK conversion is invisible to the device (verified in recon; re-assert).
- Full `DATABASE_URL=…:5433/crm2_test LC_ALL=C pnpm verify` (api integration on Postgres — billing/commission/rates/cases/tasks suites) + OpenAPI contract test + full Playwright e2e.
- **Adversarial review** (Security · Arch+DB [migration re-run + money path] · Design) before commit; disposition in registry §RTA-C.
- **Browser-verify the bill/commission round-trip on `crm2_dev`** (apply 0094 manually first): seed a rate + a commission via the catalog-backed pickers, run an OFFICE + a FIELD task through assign→complete, confirm the per-location bill ₹ + commission ₹ resolve to the SAME values as before (catalog-JOINed codes shown). Confirm a rate_types admin edit now SURVIVES (the 0013-guard fix).
- Update memory (project file + MEMORY.md + §8 + registry). **STOP for owner push approval.**

## Build order
Task 1 (ADR) → **Task 2 (migration — CTO inline, the crux)** → Task 3 + 4 (resolution + derive/writes — CTO inline, money path) → Task 5 + 6 (repos + SDK/web — subagent-assist on disjoint files, CTO reviews) → Task 7 (gate, review, browser-verify, STOP). Foundation + money path stay with the CTO; only the mechanical repo/SDK/web switches fan out.

## DON'T-REGRESS
Resolution byte-identical (only the value source → FK; LEFT JOIN preserves KYC nulls; OFFICE-id branch = code branch). Contracts keep emitting `clientRateType`/`fieldRateType` strings → mobile/SDK/web unaffected. The migration re-run guards (esp. 0013 catalog DROP + line-41 FK drop) MUST keep the catalog ids stable + `rate_type_assignments` data intact — proven by `migrations.rerun.test.ts`. `task_assignment_history.field_rate_type` stays a varchar (audit). No `any`/ts-suppress/console.*; commit author Mayur, no AI trailer; never push without explicit OK.
