# Kickoff prompt — Commission multi-location bulk entry (AUDIT FIRST → design → build)

> Paste into a fresh session in `/Users/mayurkulkarni/Downloads/crm2`. Work as **CTO + multi-agent
> team** (master/orchestrator agent spawning parallel reader agents for the audit, then task-brief →
> implementer → reviewer SDD per `docs/governance/BUILD_METHOD.md` and the batch pattern proven in
> `docs/plans/2026-07-07-admin-masterdata-ux-simplification-plan.md` + the Batch-3 build).
> **HARD GATE: audit + understanding first — no feature code until the owner confirms the audit's
> reading of the problem and picks a design option.**

## The owner's problem (2026-07-08, verbatim intent)

- Commission Rates today: the create form takes **ONE `Location Pincode` + ONE `Area`** per save —
  one commission-rate row per (pincode, area).
- A field employee often covers **many pincodes with many areas at the SAME amount**. Adding them
  one at a time is a hectic process.
- Want: select **multiple pincodes and multiple areas** that share one amount → **one save** that
  creates **one row per (pincode, area)** — storage and payout resolution unchanged; everything else
  (user, rate type, client, product, unit, TAT band, currency, effective-from) identical across the
  batch.
- Owner's explicit instruction: *"just do audit for this and understand what i am saying"* —
  present the audit + your restatement of the ask back to the owner BEFORE designing or building.

## Read in order first

1. `CLAUDE.md` → `PROJECT_INDEX.md` → `CRM2_MASTER_MEMORY.md` §8 (as of 2026-07-08:
   `main` = `prod` = `cb0a5d2`, Batch 3 hub + onboarding workbook LIVE on staging + prod, all green).
2. Claude memory: `MEMORY.md` + `project_billing_commission_split_2026_07_03` ·
   `project_commission_periodic_export_2026_07_01` · `project_admin_masterdata_ux_audit_2026_07_07`
   (UX-10 commission-picker work, batch method, agent gotchas). The `start-billing-work` skill
   preloads the billing/commission memory subset — invoke it.
3. ADRs (`docs/adr/`): **ADR-0050** (commission exact-key + most-specific-wins — **FROZEN**
   resolution) · ADR-0048 (location-rank CASE) · ADR-0068 (`rate_type_id` FK) · ADR-0071/0074
   (Universal = NULL dims) · ADR-0081 (commission periodic export) · ADR-0086 (billing ⟂ commission
   split) · ADR-0017 (effective-from/USABLE) · ADR-0019 (OCC).
4. Code (the audit's ground truth):
   - `apps/api/src/modules/commissionRates/{routes,controller,service,repository,import}.ts` —
     create path, the DB **no-overlap EXCLUDE** (PG `23P01` → `COMMISSION_RATE_EXISTS`), location
     resolve (`findByPincodeArea`), which columns form the identity key.
   - `apps/web/src/features/commissionRates/CommissionRateRecordPage.tsx` — the pincode→area
     cascade (pincode type-ahead ≥2 digits, Area select gated on pincode; **OFFICE rate types are
     location-less** — the multi-location feature only applies to FIELD-category types) +
     `eligibleUsers.ts` (picker = FIELD_AGENT + KYC_VERIFIER only, shipped 2026-07-08).
   - `apps/api/src/platform/billing/laterals.ts` `COMMISSION_LATERAL` — how (pincode, area) rows
     resolve at payout; the feature must be pure ergonomics (N identical rows), zero resolution change.
   - Locations model: **one pincode → MANY areas** (unique on pincode+area);
     `/locations/pincodes?q=` + `/locations?pincode=` cascade endpoints.
   - Bulk precedents to REUSE, not reinvent: `POST /cpv-units/bulk` (SAVEPOINT loop, per-row
     CREATED/REACTIVATED/ERROR statuses — UX-6), RTA `POST /bulk` + `/bulk-deactivate`,
     `platform/bulk.ts` `parseBulkIds`.

## Audit scope (spawn parallel readers; orchestrator cross-verifies conflicting claims)

1. **End-to-end flow today**: form → `CreateCommissionRateSchema` → `service.create` → repo insert
   + EXCLUDE key (exact columns incl. `location_id`, `tat_band`) → payout resolution → revise/OCC →
   import path (the XLSX import is already row-per-line — an existing bulk workaround; say so).
2. **Pain quantification**: rows needed for a realistic agent (1 agent × 1 rate type × N pincodes ×
   M areas each), so the fix's value is stated in numbers like the UX-1 audit did.
3. **The design nuance to get RIGHT**: areas belong to a SPECIFIC pincode — "multi-pincode ×
   multi-area" is **NOT a free cross-product**. The selection UX must be per-pincode area sets
   (pick a pincode → tick its areas → add to a basket; repeat) and/or whole-pincode shortcuts
   ("all areas of 400001"). Surface this trap to the owner explicitly with options.
4. **Overlap handling**: batch creation will hit per-row 409 `COMMISSION_RATE_EXISTS` where an
   active overlapping rate already exists — recommend per-row status reporting (CPV-bulk precedent)
   vs all-or-nothing, with a defended pick.
5. **Governance check**: bulk-action parity / additive bulk endpoint = "Free (no ADR)" per the
   2026-07-07 audit's boundary mapping (CPV + RTA bulk shipped without ADRs); ADR-0050 resolution
   stays untouched. Expected: **no migration** (next mig stays `0117`), **no ADR** (next is `0093`
   if one becomes necessary after all). Confirm rather than assume.
6. **Adjacent surfaces** to keep coherent (note, don't gold-plate): commission import + the
   onboarding-workbook CommissionRates sheet (already row-per-line), periodic export, and whether
   Rate Management wants the same multi-location entry later (note only).

## Deliverable of the audit phase (STOP here for owner sign-off)

A compact findings note + a restatement of the owner's ask in your own words + 2–3 design options
with a recommendation and cost estimate — e.g. (a) basket UI on the record page + additive
`POST /commission-rates/bulk` with per-row statuses; (b) "save & add another (location only)"
repeat-flow; (c) grid-side row duplication. Owner picks; only then write the task plan and build
slice-by-slice with per-task review gates.

## Standing rules (unchanged)

Cave mode · ask before push/deploy/live-DB (build itself = autonomous CTO) · commits author Mayur,
conventional, NO AI trailer, never `--no-verify` · gates: per-task tests → full `pnpm verify`
(`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/crm2_test LC_ALL=C`) → browser-verify
the performed action on crm2_dev (:54329, admin/admin123; launch entries in `.claude/launch.json`)
· web tests are export-style ONLY (no RTL/jsdom); e2e lives in `apps/web/e2e/` and runs in CI, not
local verify · `/api/v2` additive-only; never break mobile · update
`CRM2_MASTER_MEMORY.md` §8 + registry + Claude memory at ship · known agent gotchas: implementers
stall on "waiting for background test run" (instruct synchronous-only, nudge via SendMessage) and
can die at usage limits AFTER finishing (controller verifies + commits); keep the SDD ledger
mirrored outside `/tmp` (a worktree got wiped mid-build on 2026-07-08 — commits survived via the
shared object store, but the ledger copy saved the day).
