# Kickoff prompt — Rate Management multi-location add (AUDIT FIRST → design → build)

> Paste into a fresh session in `/Users/mayurkulkarni/Downloads/crm2`. Work as **CTO + multi-agent
> team** — spawn parallel reader agents for the audit, then task-brief → implementer → reviewer per
> `docs/governance/BUILD_METHOD.md`. **HARD GATE: audit + understanding first — present the audit's
> reading of the problem + a restatement + design options and get the owner's confirmation + pick
> BEFORE any feature code.** This is the exact playbook that just shipped the *commission*
> multi-location entry to prod (2026-07-11) — reuse it.

## The owner's ask (2026-07-11)

Rate Management — `https://crm.allcheckservices.com/admin/rates` → **"+ New Rate"** — adds ONE
client rate per save (one location at a time). The owner wants the SAME upgrade we just did for
commission rates: **add MANY at once**, and specifically:

1. **Multi-add** — set the rate once, apply it across MANY locations → one save creates one rate row
   per location (one create screen does both single + multi, like commission's merged
   `/admin/commission-rates/new`).
2. **Row-wise result screen** — after save, show the created rates as ROWS styled like the Rate list
   (not a blank panel), with a Created / Skipped / Error status per row.
3. **Duplicate checker + logic** — surface what already exists on the picker BEFORE saving; overlaps
   skip per-row (never overwrite) and are reported.
4. **Success + error notifications** — green toast on success, red toast + persistent inline
   `role="alert"` on error, plain-English messages (no raw codes).
5. **Gate the activate / deactivate buttons** — the list's write affordances must be RBAC-gated
   (mirror the server write guard).
6. **Same page design** — follow **`docs/CREATE_PAGE_STANDARD.md`** (step cards · pick-many hints ·
   sticky summary bar · result rows · toast+inline feedback) — the owner-approved pattern; the
   commission create page is the reference implementation.
7. **Excel + CSV import / export** — audit and fix the import template + **sample import file**
   (Excel AND CSV): required headers, one sample row per shape, proper duplicate/error handling on
   confirm, result screen. Export too.
8. **Reviews** — a multi-agent review (CEO / CTO / designer / security / coding-standard) AND a
   dedicated **logicality / illogicality** pass, adversarially verified, before push.

## The proven template — READ FIRST

The commission multi-location entry (LIVE on prod `ec2d071`, 2026-07-11) is the pattern to clone:
- **`docs/CREATE_PAGE_STANDARD.md`** — THE design contract for this work (owner-approved).
- Claude memory `feedback_create_page_design_standard.md` + `project_commission_bulk_location_2026_07_10.md`
  (the full build+review trail; the bulk endpoint, result screen, hints, one-type rule, toasts).
- Reference code: `apps/web/src/features/commissionRates/CommissionRateCreatePage.tsx` (create) +
  `CommissionRatesPage.tsx` (list) + `apps/api/src/modules/commissionRates/{repository,service,
  controller,routes}.ts` (`POST /commission-rates/bulk` = SAVEPOINT-per-row, per-row
  CREATED/EXISTS/ERROR; `GET .../lookups/territory`). Invoke `start-billing-work` to preload the
  billing/commission memory subset.

## Read in order first

1. `CLAUDE.md` → `PROJECT_INDEX.md` → `CRM2_MASTER_MEMORY.md` §8 (the row for the commission
   feature + the rate-management freeze rows). `docs/RATE_MANAGEMENT_FREEZE.md`.
2. ADRs (`docs/adr/`): **ADR-0050** (rate exact-key + most-specific-wins — FROZEN resolution) ·
   ADR-0048 (location-rank CASE) · **ADR-0071** (Universal = NULL product/unit; `rates_no_overlap`
   COALESCEs to -1) · ADR-0068 (`rate_type_id` FK / free-text client rate type) · ADR-0017
   (effective-from/USABLE) · ADR-0019 (OCC) · ADR-0036 (rate model). IMPORT_EXPORT_STANDARD.
3. Code (audit ground truth): `apps/api/src/modules/rates/{routes,controller,service,repository,
   import}.ts` · `packages/sdk/src/rates.ts` (`CreateRateSchema`, `RATE_EXISTS`) ·
   `apps/web/src/features/rateManagement/{RateManagementPage,RateRecordPage}.tsx` ·
   `apps/api/src/platform/billing/laterals.ts` (`RATE_LATERAL` — payout resolution; the feature must
   be pure ergonomics, zero resolution change) · the `rates_no_overlap` EXCLUDE migration.

## THE KEY DIFFERENCE from commission (get this right in the audit)

A **rate is a CLIENT bill rate, NOT per-user** — keys are `client (required) + product? + unit? +
location? + client_rate_type? → amount` (`packages/sdk/src/rates.ts`). There is **no user, so no
`user_scope_assignments` territory**. Therefore the multi-location picker is **NOT territory-scoped**
— it draws from the location catalog (pincode search → areas, as the current single form does), or
possibly the CPV-mapped set. The audit must nail: what is the location-picker's source for rates,
and what is the single axis that fans out (locations, at a shared amount, for a fixed
client+product+unit+rate-type). Everything else (client/product/unit/rate-type/amount/effective) is
picked once. Confirm with the owner whether a "one rate-type per (client, location)" rule applies
(commission got one; client rates may legitimately carry multiple rate types — DON'T assume, ask).

## Audit scope (parallel readers; orchestrator cross-verifies)

1. **End-to-end create flow today** — form → `CreateRateSchema` → `service.create` → repo insert +
   the `rates_no_overlap` EXCLUDE key (exact columns incl. `location_id`, COALESCE sentinels) → PG
   `23P01` → `RATE_EXISTS` 409 → payout via `RATE_LATERAL`. The import path (already row-per-line).
2. **Pain quantification** — rows for a realistic client (1 client × 1 product × 1 unit × N
   locations at one amount), stated in numbers.
3. **The location axis + picker source** — full catalog vs CPV-scoped; the cross-product trap
   (areas belong to a specific pincode — per-pincode area sets, like commission).
4. **Overlap / duplicate handling** — per-row `RATE_EXISTS` skip+report (commission-bulk precedent);
   whether a one-rate-type rule applies (owner decision).
5. **Activate/deactivate gating** — the list already computes `canManage = has('masterdata.manage')`
   and gates writes (RateManagementPage). VERIFY it's complete/correct (the owner's explicit
   concern; may already be satisfied — confirm, don't rebuild).
6. **Import/export** — the rate import template headers + sample content (Excel AND CSV): are they
   correct, discoverable, with a per-shape sample and error/duplicate handling? Fix like the
   scope-workbook/commission-import work (see `ImportSpec.sampleRows`/`templateNotes` seams).
7. **Governance** — bulk-create parity is additive/free (CPV/RTA/commission bulk shipped without
   ADRs; rate module ALREADY has `bulk-activate`/`bulk-deactivate`). Expect **no migration** (the
   EXCLUDE key already allows N distinct-location rows) and **no ADR** — confirm, don't assume.
   ADR-0050/0071 resolution stays untouched.
8. **Adjacent** (note, don't gold-plate): the onboarding-workbook Rates sheet, rate history/export,
   and whether Rate Management's single form should also get the CREATE_PAGE_STANDARD treatment.

## Deliverable of the audit phase (STOP for owner sign-off)

A compact findings note + a restatement of the ask in your own words + 2–3 design options with a
recommendation and cost estimate (e.g. (a) merged single+multi create page cloning
CommissionRateCreatePage + additive `POST /rates/bulk` with per-row statuses; …). Owner picks; only
then write the task plan and build slice-by-slice with per-task review gates.

## Standing rules (unchanged)

Cave mode · **ask before push/deploy/tag/merge/live-DB** (build itself = autonomous CTO) · commits
author `Mayur Kulkarni <mayurkulkarni786@gmail.com>`, conventional, **NO AI / Co-Authored-By
trailer**, never `--no-verify` · gates: per-task tests → full `pnpm verify`
(`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/crm2_test LC_ALL=C`) → browser-verify
the performed action on crm2_dev (:54329, admin/admin123; launch entries in `.claude/launch.json`;
Browser-pane tools — clear a stale `acs.forceLogout` localStorage flag before re-login, refill via
native setter + `form.requestSubmit()`) · web tests export-style ONLY (no RTL/jsdom); e2e in
`apps/web/e2e/` runs in CI · `/api/v2` additive-only; never break mobile · **`pnpm verify` flakes
locally on unrelated parallel suites under test-DB contention** — a failure on an untouched suite
(each passes alone; run the interacting suites together to confirm) is contention, not a
regression; CI has `retries:1` · regen `pnpm openapi` after any route change · update
`CRM2_MASTER_MEMORY.md` §8 + registry + Claude memory at ship · known agent gotchas: implementers
stall on "waiting for background test run" (instruct synchronous-only, nudge via SendMessage) and
can die at usage limits after finishing (controller verifies + commits); keep the SDD ledger
mirrored OUTSIDE `/tmp`.
