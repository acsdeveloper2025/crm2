# Kickoff — CREATE_PAGE_STANDARD for **Rate-Type Assignments** (AUDIT FIRST → design → build)

> Paste into a fresh session in `/Users/mayurkulkarni/Downloads/crm2`. Work as **CTO + multi-agent
> team** — spawn parallel reader agents for the audit, then task-brief → implementer → reviewer per
> `docs/governance/BUILD_METHOD.md`. **HARD GATE: audit + understanding first — present the audit's
> reading, a restatement of the ask, and 2–3 design options, and get the owner's confirmation + pick
> BEFORE any feature code.** This is the exact playbook that shipped the *rate* + *commission*
> multi-location entries and the 4-page master-data roll-out (all live on prod `6c556cd`, 2026-07-12). Reuse it.

## The owner's ask

Bring **Rate-Type Assignments** (`https://crm.allcheckservices.com/admin/rate-type-assignments`) up to
the full CREATE_PAGE_STANDARD — **all 8 items apply** (unlike the 4 singular master-data pages just
shipped, where fan-out was N/A):

1. **Multi-add on one merged create page** — set the shared values once, add many at once (one screen
   does single + multi, like `/admin/rates/new`).
2. **Row-wise result screen** — after a batch save, created records as ROWS styled like the list, with a
   Created / Skipped / Error status per row.
3. **Duplicate hints on the picker BEFORE save** — amber = would skip (already assigned), red =
   rule-blocked (untickable, tooltip names the rule).
4. **Success + error notifications** — green toast on success; red toast + persistent inline
   `role="alert"` on error; plain-English (no raw codes).
5. **RBAC-gate the activate/deactivate (write) controls** on the list, mirroring the server guard.
6. **CREATE_PAGE_STANDARD look** — `docs/CREATE_PAGE_STANDARD.md` (step cards · pick-many hints · sticky
   summary bar · result rows · toast+inline feedback).
7. **Fixed Excel + CSV import/export** — correct headers, **one sample row per shape** (`sampleRows`) +
   a live **"Notes"** worksheet (`templateNotes`), proper duplicate/error handling + result screen.
8. **Reviews** — a multi-agent 6-lens review (CEO/CTO/designer/security/coding-standard) AND a dedicated
   **logicality/illogicality** pass, adversarially verified (build + verify per finding), before push.

## ⚠️ WHY this one is the rate/commission treatment, NOT the Clients treatment

The 4 pages just shipped (Clients+Products, Verification Units, Departments+Designations, Rate Types)
were **singular entities** — no fan-out axis — so #1/#2/#3-chips were N/A. **Rate-Type Assignments is a
MATRIX/fan-out entity**: an assignment declares that a **rate type is available for a
`(client, product, unit)` slot** (`productId`/`verificationUnitId` nullable = Universal, ADR-0071;
NULLS-NOT-DISTINCT composite key). That IS a fan-out axis — like rate→locations / commission→territory.
So **all 8 items genuinely apply**, and the design/mechanics reference is the **rate & commission
multi-location create pages**, not the inline-grid Clients treatment.

## ⚠️ THE ARCHITECTURAL FORK the audit MUST resolve first (owner decision)

The current create is **single-assignment** (`RateTypeAssignmentRecordPage.tsx` → one
client+product+unit+rateType → `POST /api/v2/rate-type-assignments`). The merged multi-add page needs a
**fan-out axis** — and there are a few, so the audit must surface them as the first owner decision (like
the rate session surfaced "fan one rate across locations"):
- **(A) Fix the client → pick MANY rate types × MANY `(product, unit)` combos** → fan across the
  cartesian → one assignment row per (product, unit, rateType).
- **(B) Fix the `(client, product, unit)` slot → pick MANY rate types** (the "available set" for that
  slot — the set-the-set model) → one row per rate type.
- **(C) Hybrid** — pick-many rate types + pick-many `(product,unit)` combos in two step-cards.
This decides the whole page shape. Note memory references a past **"bulk set-the-set" `POST /bulk`
(atomic replace, no OCC)** — but current routes show `POST /` (single) + `bulk-deactivate` only, no
`POST /bulk`. **The audit must reconcile the current bulk/create model** and decide whether to add a
`POST /rate-type-assignments/bulk` (SAVEPOINT-per-row, EXISTS=skip — the `/rates/bulk` pattern).

## The proven template — READ FIRST (the design/style/layout reference)

The rate multi-location entry (prod `34ba19d`) + commission (prod `5d729c3`) + the 4-page roll-out:
- **`docs/CREATE_PAGE_STANDARD.md`** — THE design contract (owner-approved) · **`docs/adr/ADR-0093-*.md`**
  — the multi-location-bulk + one-slot-one-type pattern (additive; no mig, no ADR needed for UI-parity).
- **Design/style/layout reference code (study these closely — the owner named them):**
  - `apps/web/src/features/rateManagement/RateCreatePage.tsx` — merged single+multi create: step cards,
    pincode→area **pick-many tick-list with amber/red existing-data hints**, **sticky summary bar**
    (live count + value echo), **row-result** screen, `createFriendlyError`, toast+inline.
  - `apps/web/src/features/rateManagement/RateManagementPage.tsx` (list toasts + RBAC gating) +
    `RateRecordPage.tsx` (revise-only).
  - `apps/web/src/features/commissionRates/CommissionRateCreatePage.tsx` + `CommissionRatesPage.tsx` +
    `CommissionRateRecordPage.tsx`.
  - Backend: `apps/api/src/modules/rates/{repository,service,controller,routes,import}.ts` —
    `POST /rates/bulk` **SAVEPOINT-per-row** (23P01→EXISTS skip-never-overwrite), `sampleRows` /
    `buildRateTemplateNotes` seams.
- Claude memory: `feedback_create_page_design_standard.md`, `project_rate_bulk_location_2026_07_11.md`,
  `project_commission_bulk_location_2026_07_10.md`, `project_clients_create_page_standard_2026_07_12.md`.

## Read in order first

1. `CLAUDE.md` → `PROJECT_INDEX.md` → `CRM2_MASTER_MEMORY.md` §8 (the rate/commission + 4-page roll-out
   rows) → `docs/CREATE_PAGE_STANDARD.md` → `docs/adr/ADR-0093-*.md`.
2. Governance/model ADRs for this entity: **ADR-0067** (rate-type assignments + set-the-set + the
   `/rate-types/available` resolver) · **ADR-0068** (`rate_type_id` FK) · **ADR-0050** (rate-type
   resolution) · **ADR-0071** (Universal product/unit = NULL) · **ADR-0070** (verification unit).
3. Code (audit ground truth):
   - FE: `apps/web/src/features/rateTypeAssignments/RateTypeAssignmentsPage.tsx` (list) +
     `RateTypeAssignmentRecordPage.tsx` (current **single**-assignment record page + its `.test.ts`).
   - API: `apps/api/src/modules/rateTypeAssignments/{routes,controller,service,repository,import}.ts`
     (already has import/export via `buildTemplate`/`runImportPreview`/`runImportConfirm` + a
     FK-resolving `buildRateTypeAssignmentSpec`, + `bulk-deactivate`).
   - SDK: `packages/sdk/src/rateTypeAssignments.ts` (create schema: `clientId`+`rateTypeId` required,
     `productId`/`verificationUnitId` nullable = Universal).

## Audit scope (parallel readers; orchestrator cross-verifies)

1. **Current create/edit/list/import flow** — the record page is single-assignment: what's the exact
   payload, the pickers (client/product/unit CPV-scoped via `/cpv-units/available`, rate-type via
   `/rate-types/options?active=true`)? Is there any activate (routes show deactivate + bulk-deactivate;
   line ~33 says "re-creating a combo re-activates it" — confirm the reactivate-by-recreate model)?
2. **The matrix / fan-out model** — the composite key `(client, product?, unit?, rateType)` with
   Universal NULLs (NULLS-NOT-DISTINCT); what does an assignment MEAN (availability, consumed by the
   Rate Management picker); the current bulk model (`bulk-deactivate` only? is there a `POST /bulk`?).
   This decides fork A/B/C.
3. **All-8 mapping** — for a fan-out matrix entity map #1–#8 APPLIES / PARTIAL / ALREADY-PRESENT (expect
   most APPLY; import/export + record route + bulk-deactivate ALREADY-PRESENT → partial retrofit).
4. **Duplicate + rule surfacing** — before-save hints: amber = combo already assigned (would EXISTS-skip),
   red = rule-blocked (e.g. an inactive/invalid rate type, or a CPV-unavailable unit for the client×product).
   What are the real block rules (CPV scoping, active rate type)? Cheapest correct realization.
5. **Import/export** — the FK-resolving spec exists; does the template have `sampleRows` (one per shape:
   client-only Universal, +product, +product+unit) + `templateNotes`? Partial-success per-row? CSV+XLSX?
   Fix like rate/scope (`sampleRows`/`templateNotes`).
6. **Governance** — expect **additive** (ADR-0093 + CREATE_PAGE_STANDARD cover the pattern; ADR-0067
   defines the model). Expect **no migration**; expect **no new ADR** UNLESS a new `POST /bulk` endpoint
   or a resolution/rule change is a frozen-decision touch — confirm, don't assume. `/api/v2` additive,
   never break mobile.

## Deliverable of the audit phase (STOP for owner sign-off)

A compact findings note + a restatement of the ask + the **fan-out fork (A/B/C) with a recommendation +
cost** + a per-checklist-item APPLIES/PARTIAL/PRESENT table + any open owner decisions (esp. the
fan-out axis, whether to add `POST /bulk`, and the block-rule set for red chips). **Owner picks the fork
+ scope; only then** write the task plan and build slice-by-slice with per-task review gates.

## Standing rules (unchanged — same as the roll-out)

Cave mode (minimal tokens) · **ask before push/deploy/tag/merge/live-DB** (the build itself = autonomous
CTO: decide + execute, don't ask per-step) · commits author `Mayur Kulkarni
<mayurkulkarni786@gmail.com>`, conventional, **NO AI / Co-Authored-By trailer**, never `--no-verify`,
secret-sweep before push · gates: per-task tests → full `pnpm verify`
(`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/crm2_test LC_ALL=C`) → **browser-verify the
performed action** on crm2_dev (`.claude/launch.json` — start `api` (:4000) + `web` (:5273) SEPARATELY,
not the combined `stack` which forces both onto one PORT; admin/admin123; the web dev server drops
sometimes — restart it; session tokens expire in 15 min — re-login) · **⚠️ `pnpm verify` ≠ CI: it does
NOT run Playwright e2e** — after any FE label/text/DataGrid change, run the affected e2e
(`cd apps/web && CI= pnpm exec playwright test e2e/<spec>.spec.ts`) or you'll green-verify then red-CI
(this bit the roll-out once — a datagrid enum-filter pinned an old label) · regen `pnpm openapi` after
any route change · `/api/v2` additive-only, never break mobile · update `CRM2_MASTER_MEMORY.md` §8 +
`docs/COMPLIANCE_GAPS_REGISTRY.md` + the Claude memory at ship · **6-lens + logicality review,
adversarially verified (build + verify per finding), before push** — an empty review result is NOT a
clean review; agents can die at a usage limit → re-run and REUSE cached results. **LESSON from the VU
retrofit: an inline-only review MISSED a major silent-data-loss bug — run the FULL multi-agent 6-lens
for this, not inline reasoning.** · keep the SDD ledger / plan doc under `docs/plans/`.
