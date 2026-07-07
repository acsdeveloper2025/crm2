# ADR-0092: Client Setup hub + onboarding workbook import

- **Status:** Proposed (owner sign-off pending — §UX-8 checkbox below)
- **Date:** 2026-07-08

## Context

The [admin master-data UX audit](../audit/admin-masterdata-ux-2026-07-07/ADMIN_MASTERDATA_UX_AUDIT.md)
(2026-07-07) measured what it costs to onboard **1 client · 2 products · 3 units · 1 pincode · 2 field
users** today: **≈27 page visits / ≈35 form submissions across 6 admin pages**, in a dependency order
(Clients/Products → CPV link → CPV units → Rate Type Assignments → Rates → Commission Rates) the UI never
states. Failures surface downstream as an empty or mislabeled picker instead of at the step that caused
them (**UX-1**). The spreadsheet path is no better: up to **6 separate imports** in the right order (two
uploads on the CPV page alone), and Rate Types has no import at all (**UX-2**).

The audit also found that rate-type availability for a (client, product, unit) combo and the (client,
product) CPV link are **UX-gated only** — the 0012 eligibility trigger was dropped in mig 0013 and nothing
server-side replaced it. A direct-API or per-module import create can produce an operationally-dead row
(**UX-8**).

The [reviewed design spec](../specs/2026-07-07-client-setup-hub-design.md) (Revision 1, folding a 3-lens
adversarial review — CTO/arch, Design/governance, Security/RBAC, all SHIP_WITH_FIXES) is the source of
truth for mechanics; this ADR records the decision and governance boundary, not a re-derivation.

## Decision

Build two additive things, both composing existing endpoints/forms — no duplicate form logic, no new
resolution semantics, no migration.

**1. Client Setup hub** (`GET /admin/client-setup`, `page.masterdata` gate, nav item first in
Administration): a client picker + 5-step stepper (Products/CPV → CPV units → Rate types → Rates →
Commission) that **embeds the existing pages** (`CpvPage`, `RateTypeAssignmentsPage`, `RateManagementPage`,
`CommissionRatesPage`) via one additive **controlled `clientId?` prop** (wires into each page's `DataGrid`
`filters`, hides the page's internal picker) plus an additive `?returnTo=` param the 4 record pages honor
on save/cancel instead of hard-navigating away. Both are no-ops when absent — standalone routes are
unchanged. A per-step **completeness checklist** (client-side `totalCount` reads off existing list
endpoints, no new aggregator for v1) makes the dependency order visible instead of memorized. Commission's
count is `masterdata.manage`-gated (shows "—", fires no request for non-SA viewers). Steps are navigable
out of order — a stepper, not a linear wizard.

**2. Onboarding workbook import** (`POST /api/v2/clients/:id/onboarding-import?mode=preview|confirm`,
`GET /api/v2/clients/:id/onboarding-template`, both `masterdata.manage`): one 5-sheet XLSX (Products · CPV
· RateTypeAssignments · Rates · CommissionRates), each sheet's columns identical to that module's existing
import template, processed **strictly in dependency order** through the **unchanged per-module `resolve`
functions**. The one named exception: the CPV sheet gets a **workbook-only additive delta** to the
CPV-unit `ImportSpec` making `unitCode` optional (blank/`'UNIVERSAL'` → NULL, mirroring the RTA import
pattern) so Universal CPV — the common onboarding shape — becomes expressible; the standalone single-sheet
CPV import keeps its strict `required` spec. Cross-sheet code resolution uses **per-entity pending
projections** (pending product **codes**, pending CPV link **pairs** from the sheet's own phase-1, pending
assignment **tuples**) matched at code level in preview, then a real rebuild-and-confirm per sheet so later
sheets see the prior sheet's committed rows. Preview honesty is bounded: valid-pending is conditional on
the prerequisite committing **and being USABLE** at confirm time (future `Effective From` referenced
downstream ⇒ preview warning). New workbook-only invariants: **`CLIENT_MISMATCH`** (any row's `Client Code`
≠ the `:id` target = row error, both preview and confirm) and an **unknown-rate-type row error** on the
CommissionRates sheet (closes the silent-NULL resolve for this new surface only). Size caps: per-sheet
**and total** rows capped at `importThreshold()` (10 000, 413 "split the file") since this is a
synchronous interactive flow, not the background-job tier. The CPV sheet drives two write paths
(`client_products` link create + `client_product_verification_units` unit create), so it writes **two**
`import_log` rows — a 5-sheet workbook produces 6 audit rows.

**What this does NOT change:**
- Every existing page's route, pattern, copy, inline-grid-vs-record-page split (ADR-0051), and OCC
  (ADR-0019) — the hub reuses them unchanged; standalone behavior is byte/behavior-identical when the new
  `clientId?`/`returnTo` params are absent.
- Resolution semantics: Universal = NULL storage rendered as "Universal" (ADR-0069/0071/0074),
  billing-by-location / commission-by-exact-key / most-specific-wins (ADR-0050/0071), effective-from/USABLE
  gating (ADR-0017) — all untouched; the workbook resolves codes→ids via the same `resolve` closures the
  single-sheet imports already use.
- No `service_zone_rules` or eligibility-trigger revival — the 0012 trigger stays dropped; any new
  enforcement (§UX-8 below) is a service-layer check, never a DB trigger.
- No new package, no new DataGrid, no new import engine, no new picker component. No migration.
- `/api/v2` stays additive-only; no endpoint here is consumed by `crm-mobile-native`.

## UX-8 decision — rate-type / CPV-link enforcement

The spec's §5 matrix (three options — keep-UX-gate / enforce-400 / warn-only) concludes:

**Recommendation: (b) strict row errors on the NEW workbook-import surface only** —
`RATE_TYPE_NOT_ASSIGNED` and `CPV_LINK_MISSING` (plus the unknown-rate-type-code check above) refuse a
dead row at preview/confirm, resolved against the same-workbook RateTypeAssignments sheet via the pending
overlay. **(a) unchanged for existing endpoints** — the direct-API create path and every per-module
single-sheet import stay UX-gated only; tightening them would narrow `/api/v2`'s accepted inputs on
surfaces with existing (or future, e.g. mobile) consumers, which the additive-only rule exists to prevent.

**Honest residual:** this leaves the direct-API create path, the per-module single-sheet imports, **and**
the §4.7 "genuinely huge catalog" escape hatch (which explicitly routes big imports away from the
workbook) still able to create an operationally-dead row. Accepted as the cost of not breaking existing
consumers; option (c) (additive `warnings[]` field on the per-module imports) is the named future
tightening if the owner later wants signal there without a breaking change.

**Owner checkbox (pick one):**
- [ ] Accepted — option (b)-for-workbook / (a)-for-existing-endpoints, as recommended
- [ ] Prefer option (a) everywhere (no new enforcement anywhere, including the workbook)
- [ ] Prefer option (c) everywhere (warn-only, no refusal anywhere)

## Consequences

### Positive
- Collapses the ≈27-visit/≈35-submission onboarding journey to one guided page and/or one file upload,
  addressing UX-1 and UX-2 directly.
- The workbook's `CLIENT_MISMATCH` + strict rate-type checks make the newest, highest-blast-radius bulk
  path (a multi-sheet import) safer than every existing import path, without touching them.
- Zero new packages, zero migration, zero mobile surface — pure composition + one additive service check
  scoped to a brand-new endpoint.

### Negative
- Real build cost: **≈5–6 sessions** post sign-off (S1–S6 per the spec §8) — larger than the plan's
  original "~2–3 session" estimate, re-costed after the adversarial review surfaced the engine seams below.
- The hub is a **second entry point** to the same 6 pages — every future change to those pages' client
  filtering/nav-on-save must consider the hub's controlled-prop contract, not just the standalone route.
- The workbook engine needs real new seams, not pure reuse: an optional sheet-selector through
  `parseImportFile`/`runImportPreview`/`runImportConfirm` (today hard-reads `worksheets[0]`), a
  `buildWorkbookTemplate(specs[])` builder, a 5-panel `ImportModal` extension, and the CPV Universal-delta
  spec — each is a small, tested, additive change, but it is real surface, not a free wrapper.

## Alternatives Considered
- **Wizard-as-modal** (linear dialog trapping the admin through steps) — can't embed full record
  pages/grids, forces linear order, duplicates form chrome.
- **Per-page checklists only** (progress banner on each existing page, no hub) — cheaper but doesn't
  collapse the page-hopping journey; a strict subset of what the hub gives.
- **CSV-zip instead of a workbook** (5 zipped CSVs) — needs a new unzip dependency and multi-file upload
  UX where one native multi-sheet XLSX needs neither.
- **Setup-status aggregator, v1** — deferred: client-side `totalCount` fan-out is cheap and already exists;
  build the aggregator only if a future dashboard needs counts across many clients at once.

## Related ADRs
- ADR-0017 — effective-from/USABLE gating the workbook's pending-row honesty bound relies on.
- ADR-0019 — OCC/concurrency standard the embedded pages keep unchanged.
- ADR-0050 — commission exact-match/most-specific-wins semantics, untouched by the workbook.
- ADR-0051 — inline-grid vs record-page split; governs the Step-0 "＋ New client" link-out, not an inline form.
- ADR-0064/0067/0068/0069 — rate-type catalog, assignment model, and FK conversion the hub's Step 2 and UX-8 build on.
- ADR-0071 — rate Universal product/unit model the Rates step and workbook Rates sheet reuse as-is.
- ADR-0074 — CPV Universal semantics; source of the workbook-only CPV-unit import delta.
