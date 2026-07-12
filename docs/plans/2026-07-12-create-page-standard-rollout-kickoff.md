# Kickoff — CREATE_PAGE_STANDARD roll-out, page by page (AUDIT FIRST → design → build). **Page 1 = Clients.**

> Paste into a fresh session in `/Users/mayurkulkarni/Downloads/crm2`. Work as **CTO + multi-agent
> team** — spawn parallel reader agents for the audit, then task-brief → implementer → reviewer per
> `docs/governance/BUILD_METHOD.md`. **HARD GATE: audit + understanding first — present the audit's
> reading, a restatement of the ask, and 2–3 design options, and get the owner's confirmation + pick
> BEFORE any feature code.** This is the exact playbook that just shipped the *rate* and *commission*
> multi-location entries + the create-page standard (ADR-0093, rate live on staging 2026-07-12). Reuse it.

## The owner's ask (2026-07-12)

Roll the **same design we shipped for Rate & Commission** out to **every admin page, one at a time —
start with the Clients page** (`https://crm.allcheckservices.com/admin/clients`). For each page, do all of:

1. **Multi-add on one merged create page** — set the shared values once, add many at once; one create
   screen does both single + multi (like `/admin/rates/new`).
2. **Row-wise result screen** — after a batch save, show the created records as ROWS styled like that
   page's list, with a Created / Skipped / Error status per row.
3. **Duplicate hints on the picker BEFORE save** — surface what already exists; amber = would skip
   (already exists), red = rule-blocked (untickable, tooltip names the rule).
4. **Success + error notifications** — green toast on success, red toast + persistent inline
   `role="alert"` on error; plain-English messages (no raw codes).
5. **Gate the activate / deactivate (write) buttons** — RBAC-gated on the list, mirroring the server
   guard (on Rate/Commission this was already complete — VERIFY, don't rebuild).
6. **CREATE_PAGE_STANDARD look** — follow **`docs/CREATE_PAGE_STANDARD.md`** (step cards · pick-many
   hints · sticky summary bar · result rows · toast+inline feedback). Rate/Commission = reference impls.
7. **Fixed Excel + CSV import/export** — correct headers, **one sample row per shape** (`sampleRows`)
   + a live **"Notes"** worksheet (`templateNotes`), proper duplicate/error handling + result screen.
8. **Reviews** — a multi-agent review (CEO / CTO / designer / security / coding-standard) AND a
   dedicated **logicality / illogicality** pass, adversarially verified, before push.

## ⚠️ THE KEY JUDGEMENT for this roll-out — DO NOT force the rate checklist blindly

Rate & Commission had a natural **fan-out axis** (one rate → many *locations*). **Most other pages do
not.** A **client is a singular entity** — there is no dimension to fan a client across. So for pages
without a fan-out axis, items #1/#2/#3 (multi-add / row-result / pick-many hints) **may not apply as-is**
and must NOT be forced. The audit must decide, per page, **which checklist items apply** and surface any
reinterpretation as an **owner decision** (exactly as the rate session surfaced the one-type rule). For
a singular entity the likely-applicable set is: **CREATE_PAGE_STANDARD entry page (#6), duplicate
prevention on the unique key (#3 → "code already exists" inline, not a chip tick-list), toasts + inline
alerts (#4), RBAC verify (#5), and the import-template fix (#7)** — with #1/#2 either **N/A** or
reinterpreted as an owner-chosen "add several at once" (which the existing **import / onboarding
workbook** may already cover — don't duplicate it). **Ask; don't assume.**

## ⚠️ THE ARCHITECTURAL FORK the audit MUST resolve first (Clients-specific, cascades everywhere)

`ClientsPage.tsx` is **28 lines** — it renders the **shared generic `apps/web/src/components/MasterDataCrud.tsx`** (a **modal** create/edit), and the API uses the **shared `apps/api/src/modules/shared/masterDataImport.ts` / `masterDataExport.ts`**. Clients, Products, and likely Verification Units / Departments / Designations / Rate Types all ride these **same shared components**. So "make Clients look like the create-page standard" forks into:
- **(A) Upgrade the shared `MasterDataCrud`** (modal → CREATE_PAGE_STANDARD step-card record page +
  shared `sampleRows`/`templateNotes` seams) — **one change standardises the whole family at once**, but
  it's a high-blast-radius edit to a component many pages depend on (regression risk across all of them).
- **(B) Bespoke Clients page** (a dedicated `ClientCreatePage` like `RateCreatePage`, leaving
  `MasterDataCrud` for the others) — isolated, lower risk, but doesn't advance the other pages and
  duplicates structure.
- **(C) Hybrid** — extend `MasterDataCrud` to *optionally* render the step-card record-page layout
  (opt-in per page), migrate Clients first, others follow.
Note: **CREATE_PAGE_STANDARD §Don't says "No modal create for record-shaped data (ADR-0051)"** — so the
end state is record-page routes, not modals. This fork decides the roll-out's whole shape — **it is the
first owner decision**, before any page-specific work.

## The proven template — READ FIRST

The rate multi-location entry (on staging `34ba19d`, 2026-07-12) + commission (prod, 2026-07-11):
- **`docs/CREATE_PAGE_STANDARD.md`** — THE design contract (owner-approved).
- **`docs/adr/ADR-0093-multi-location-bulk-and-one-slot-one-type.md`** — the pattern's ADR (multi-location
  bulk + one-slot-one-type; additive; cross-refs the frozen rate/commission ADRs).
- Reference code: `apps/web/src/features/rateManagement/RateCreatePage.tsx` (merged single+multi create)
  + `RateManagementPage.tsx` (list toasts + RBAC gating) + `RateRecordPage.tsx` (revise-only) ·
  `apps/web/src/features/commissionRates/CommissionRateCreatePage.tsx` · the backend
  `apps/api/src/modules/rates/{repository,service,controller,routes,import}.ts` (`POST /rates/bulk`
  SAVEPOINT-per-row; `otherTypeAtSlot`; `sampleRows`/`templateNotes`). Scope-import workbook
  (`modules/scopeAssignments`) = the gold reference for `sampleRows` + live `templateNotes`.
- Claude memory: `feedback_create_page_design_standard.md`, `project_rate_bulk_location_2026_07_11.md`,
  `project_commission_bulk_location_2026_07_10.md` (full build+review trail).

## Read in order first

1. `CLAUDE.md` → `PROJECT_INDEX.md` → `CRM2_MASTER_MEMORY.md` §8 (the rate/commission rows) →
   `docs/CREATE_PAGE_STANDARD.md` → `docs/adr/ADR-0093-*.md`.
2. Code (audit ground truth for **Clients**): `apps/web/src/features/clients/ClientsPage.tsx` +
   `apps/web/src/components/MasterDataCrud.tsx` (the shared modal — and its OTHER consumers: grep
   `MasterDataCrud`) · `apps/api/src/modules/clients/{routes,controller,service,repository}.ts` +
   `apps/api/src/modules/shared/{masterDataImport,masterDataExport}.ts` · the `clients` SDK contract
   (`packages/sdk/src/clients.ts` — the create/update schema, the unique key, e.g. client `code`) ·
   `apps/api/src/modules/clients/onboarding.ts` (the onboarding-workbook Clients sheet — the existing
   bulk-client path; the roll-out must not duplicate it). ADR-0092 (Client Setup hub / workbook).

## Audit scope (parallel readers; orchestrator cross-verifies)

1. **The Clients create/edit/list/import flow today** — is create a `MasterDataCrud` modal? what fields
   (code/name/GST/contact/…)? the unique key (code)? how does duplicate-code surface today (server 409?
   which code)? RBAC on activate/deactivate/edit/import (already gated? confirm, list any ungated write).
2. **The shared-component blast radius** — every consumer of `MasterDataCrud` +
   `masterDataImport`/`masterDataExport` (which pages, which entities). This decides fork A vs B vs C.
3. **Which checklist items apply to a singular Client** — map #1–#8 to APPLIES / N-A / REINTERPRET, with
   the reinterpretation stated as an owner decision (esp. does "multi-add" mean anything for clients
   beyond the existing import/workbook?).
4. **Import/export** — the shared `masterDataImport` template headers + sample: correct? discoverable?
   per-shape sample + Notes? partial-success per-row? CSV+XLSX? Fix like the rate/scope work
   (`sampleRows`/`templateNotes` seams) — but note it's SHARED, so a fix touches every consumer.
5. **Duplicate prevention** — for a unique-code entity, the "before-save hint" is an inline "code
   already exists" check, not a chip tick-list. What's the cheapest correct realisation?
6. **Governance** — is any of this a frozen-decision change (needs ADR + sign-off) or purely additive
   UI/parity (no ADR)? Expect **no migration**; expect **no new ADR** if it's UI-parity (ADR-0093 +
   CREATE_PAGE_STANDARD already cover the pattern) — confirm, don't assume.

## Deliverable of the audit phase (STOP for owner sign-off)

A compact findings note + a restatement of the ask in your own words + the **architectural fork (A/B/C)
with a recommendation + cost** + a per-checklist-item APPLIES/N-A/REINTERPRET table for Clients + any
open owner decisions. **Owner picks the fork + the applicable scope; only then** write the task plan and
build slice-by-slice with per-task review gates. Then repeat the method for the next page (likely order:
Clients → Products → Verification Units → Departments/Designations → Rate Types, i.e. the MasterDataCrud
family; the bespoke config pages — CPV, Rate-Type Assignments — already partly follow the standard).

## Standing rules (unchanged — same as the rate session)

Cave mode (minimal tokens) · **ask before push/deploy/tag/merge/live-DB** (the build itself =
autonomous CTO: decide + execute, don't ask per-step) · commits author `Mayur Kulkarni
<mayurkulkarni786@gmail.com>`, conventional, **NO AI / Co-Authored-By trailer**, never `--no-verify`,
secret-sweep before push · gates: per-task tests → full `pnpm verify`
(`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/crm2_test LC_ALL=C`) → browser-verify the
performed action on crm2_dev (`.claude/launch.json` `web`:5273 / `api`:4000, admin/admin123; clear a
stale `acs.forceLogout` localStorage flag before re-login, refill via the native input setter +
`form.requestSubmit()`) · web tests export-style ONLY (no RTL/jsdom); e2e in `apps/web/e2e/` runs in CI ·
`/api/v2` additive-only, never break mobile · regen `pnpm openapi` after any route change · a shared
`MasterDataCrud`/`masterDataImport` edit is HIGH blast-radius — run every consumer's tests · update
`CRM2_MASTER_MEMORY.md` §8 + `docs/COMPLIANCE_GAPS_REGISTRY.md` + the Claude memory at ship · **6-lens +
logicality review, adversarially verified, before push** (agents can die at a session usage limit —
re-run and REUSE the cached results, never re-run the whole review from blank; an empty review result
is NOT a clean review — verify unfinished findings yourself from the code) · keep the SDD ledger /
plan doc under `docs/plans/`, mirrored OUTSIDE `/tmp`.
