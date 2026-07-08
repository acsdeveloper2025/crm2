# Admin Master-Data Configuration UX Audit — 2026-07-07

**Scope (owner-requested, AUDIT-ONLY — no code changed):** the admin experience for configuring
**Clients → Products → CPV mapping → Rate Types → Rate Type Assignments → Rate Management →
Commission Rates**, including Excel/CSV import-export — reviewed across **frontend, backend, DB,
and every related ADR/rule file**.

**Method:** 4 parallel read-only audit agents (FE UX walk · BE API · DB schema/migrations ·
ADR+governance) + orchestrator cross-verification of every conflicting claim against code.
Conflicts found between agents were resolved by direct code reads (noted inline).

**Verdict in one line:** the pages are individually **consistent, pattern-compliant and
production-quality**, but the *chain* is the problem — onboarding one minimal client takes
**~27 page visits / ~35 form submissions across 6 pages in a dependency order the UI never
explains**, and the biggest levers are (a) a guided client-setup flow, (b) one multi-sheet
onboarding workbook import, (c) a handful of quick message/parity fixes.

---

## 1 — What the admin experiences today (end-to-end journey)

To fully onboard **1 client · 2 products · 3 units · 1 pincode · 2 field users**:

| # | Page | What the admin does | Visits | Submissions |
|---|------|--------------------|--------|-------------|
| 1 | `/admin/clients` | + Add row (inline: code, name) | 1 | 1 |
| 2 | `/admin/products` | + Add row × 2 | 1 | 2 |
| 3 | `/admin/cpv` | Link product form × 2 | 1 | 2 |
| 4 | `/admin/cpv` (expanded rows) | Enable unit form × (2×3) — one submission **per unit** | — | 6 |
| 5 | `/admin/rate-types` | (catalog is global — usually 0) | 0 | 0 |
| 6 | `/admin/rate-type-assignments/new` | full record page × (2×3) | 6 | 6 |
| 7 | `/admin/rates/new` | full cascading form × (2×3×1) | 6 | 6 |
| 8 | `/admin/commission-rates/new` | full cascading form × (2×2×3×1) | 12 | 12 |
| | **TOTAL** | | **~27** | **~35** |

≈ 20–30 min of manual navigation. The **dependency order is invisible**: nothing tells the admin
that CPV links must exist before unit pickers scope correctly, or that rate-type assignments must
exist before the Rate form's type picker populates — the failure surfaces *downstream* as an empty
or misleadingly-labeled picker.

**Dependency graph the admin must carry in their head:**

```
Clients ─┐
Products ┼→ CPV link → CPV units ──→ (scopes unit pickers everywhere, ADR-0074)
Rate Types ─→ Rate Type Assignments ─→ (gates Rate form's type picker, ADR-0067)
                                   └→ Rates (billing amounts, ADR-0071 Universal)
Users ────────────────────────────────→ Commission Rates (ADR-0050, un-gated picker)
```

**Import path today:** 6 of 7 entities have template→preview→confirm import (XLSX-only), but the
admin must run **up to 6 separate imports in the right order** (client-products and cpv-units are
two separate uploads on the same page); Rate Types has **no import/export at all**.

---

## 2 — Per-page experience (condensed; full detail in agent findings)

| Page | Pattern | Create | Edit | Import | Export | Notable friction |
|------|---------|--------|------|--------|--------|------------------|
| Clients / Products | MasterDataCrud inline grid | + Add row | inline cell (OCC ConflictDialog) | ✓ | ✓ | code createOnly not visually marked; blur = instant save |
| CPV (`CpvPage.tsx`) | hierarchical grid + expandable UnitManager | always-visible inline forms | Reschedule dialog (`effectiveFrom` only) | ✓ **two separate buttons** (links / units) | ✓ (+ Export Units) | one submission per unit (no multi-select); sub-table unpaginated; two-upload import |
| Rate Types (`RateTypesPage.tsx`) | inline grid (`createOnly` code) | + Add row | inline cell | ✗ **none** | ✗ **none** | only master-data page without import/export |
| Rate Type Assignments | grid + record page | `/new` form (CPV-scoped unit picker) | **none — immutable keys** (detail page read-only; deactivate+recreate) | ✓ | ✓ | no revise; no bulk-deactivate; silent all-units fallback when CPV link missing |
| Rate Management | grid + record page | `/new` cascading form (client→product→Field/Office→unit→pincode→area→type→₹) | Revise = amount+effectiveFrom only (asymmetric, by design ADR-0071) | ✓ | ✓ + History dialog | type-picker gating messages inconsistent/misleading; Field/Office toggle silently clears downstream; 409 overlap surfaces as generic "Save failed"; pincode dead-end |
| Commission Rates | grid + record page (manage-perm-gated) | `/new` form (user→dims→pincode→area→type→₹) | Revise = amount+effectiveFrom | ✓ | ✓ (display-only, not re-importable — IE-DEFER-7) | type picker offers OFFICE too (location rule differs); no list filters; TAT picker capped at 100; no most-specific-wins preview |

UI-pattern consistency is genuinely good: one DataGrid everywhere, shared ImportModal, shared
ConflictDialog (OCC), Universal rendered as the word "Universal" everywhere, CPV-scoped pickers per
ADR-0074. The system *feels* coherent page-by-page; it's the cross-page flow that costs.

---

## 3 — Enforcement reality (what's actually guarded where)

Cross-verified — including one agent-conflict resolved by direct migration read:

| Invariant | UI | API/service | DB |
|---|---|---|---|
| Unique codes (client/product/unit/rate-type) | inline error | 409 | ✅ UNIQUE |
| CODE_LOCKED once referenced (ADR-0020) | friendly message | 409 | app-checked |
| One Universal (NULL) row per parent (CPV, RTA) | — | 409 idempotent re-activate | ✅ UNIQUE NULLS NOT DISTINCT (migs 0096/0101) |
| No overlapping effective-dated rates | ⚠️ generic "Save failed" | 409 RATE_EXISTS | ✅ EXCLUDE gist `rates_no_overlap` (mig 0098, COALESCE(dim,-1)) |
| No overlapping commission rates | ⚠️ generic | 409 | ✅ EXCLUDE `commission_rates_no_overlap` (mig 0079) |
| OCC on edits | ConflictDialog | version guard | ✅ version cols |
| **Rate's type ∈ assignments for the combo** | ✅ picker-gated (`/rate-types/available`) | ❌ **not enforced** | ❌ **not enforced** — the 0012 eligibility trigger was **dropped in 0013** ([0013_rate_management_flatten.sql:10-11,67](../../../db/v2/migrations/0013_rate_management_flatten.sql)); a direct API create can carry any (or an unknown) type code |
| Rate's (client,product) has a CPV link / client_products row | ✅ picker-scoped only | ❌ | ❌ no FK to client_products |
| OFFICE commission needs no location; FIELD does | partial | ✅ zod refine | — |
| Cascading deactivation (client → its rates/CPV/RTA) | — | ❌ none | ❌ none |

**Implication:** the admin config chain is a **UX-suggested, not system-enforced** pipeline.
Fine for a careful admin in the UI; direct-API or import mistakes can create operationally-dead
rows (rate for an unlinked product; rate whose type resolves to NULL) with no warning.
(Note: `CreateRateSchema.clientRateType` is the *contract* string; storage resolves it to the
`rate_type_id` FK per ADR-0068 — an unknown code resolves to NULL silently on the repo path.)

**DB agent claims corrected during synthesis:** the "rates eligibility trigger" it reported is
gone since 0013 (verified above); everything else in its constraint map held up.

---

## 4 — Import/Export coverage matrix (verified against code)

| Entity | Import (XLSX-only) | Export (XLSX/CSV) | Round-trip | Universal rows |
|---|---|---|---|---|
| Clients | ✓ | ✓ | lossless | n/a |
| Products | ✓ | ✓ | lossless | n/a |
| Client-Products (links) | ✓ (client/product codes) | ✓ (+unit_count) | lossless | n/a |
| CPV units | ✓ (3 codes; **Universal NOT expressible** — `unitCode` is required in the ImportSpec, `cpv/import.ts:98,106`; UI-only) | ✓ | lossless for specific units | ✓ kept in export; unimportable |
| Rate Types | ✗ | ✗ | — | n/a |
| Rate Type Assignments | ✓ (blank product/unit = Universal) | ✓ ("Universal" literal) | lossless | ✓ |
| Rates | ✓ (codes + pincode+area) | ✓ | lossless (currency incl.) | ✓ (blank = Universal) |
| Commission Rates | ✓ (username + codes + pincode/area) | ✓ **display-only** | ✗ export ≠ import shape (**IE-DEFER-7**, documented) | ✓ |

Notes: ~~import accepts XLSX only~~ **CORRECTION 2026-07-08: CSV import has worked since the repo's
first commit** — the engine magic-byte-sniffs the format (`format.ts:159`), strips BOM (`:147`),
parses RFC-4180 (`:110-142`), and ImportModal already accepted `.csv` (`:190`). The audit (and two
of its agents) were misled by `format.ts:6`'s stale doc comment "XLSX only for now"; UX-14 is
RETRACTED (Batch 2 added 11 pinning tests + dual-format browser proof instead). Export does XLSX +
CSV with the streaming WorkbookWriter (don't-regress, `9a29cdb`) + CWE-1236
formula guards. Preview mode gives per-row errors; confirm persists valid rows (partial import).
Export ≤ view-perm rule holds; commission export is deliberately `masterdata.manage`-gated.
Earlier memory claims that Universal rows were dropped by INNER JOINs are **stale — since fixed**
(LEFT JOINs verified by the BE agent).

---

## 5 — Governance boundaries (what a simplification may/may not touch)

**Frozen / needs superseding ADR + CTO + owner:** rate-type FK catalog + assignment model
(ADR-0064/67/68/69) · client-vs-field rate-type split + resolution (ADR-0050: billing by location,
commission by exact key, most-specific-wins ADR-0071) · NULL=Universal semantics (0069/0071/0074) ·
effective-from/USABLE model (ADR-0017) · inline-grid vs record-page form split (ADR-0051) · OCC
(ADR-0019) · one DataGrid + one import engine + export-≤-view (DATAGRID/IMPORT_EXPORT standards) ·
additive-only `/api/v2`.

**Freely buildable (no ADR):** new columns, better messages/validation feedback, picker refinement,
saved views, bulk actions following the existing pattern, help text, form section re-organization
that keeps field semantics.

**Grey zone (CTO/ADR because it's a new *pattern*):** a guided setup wizard/hub page; a combined
multi-sheet workbook import; server-side enforcement of availability (tightens an existing
endpoint's accepted inputs — behavior change on `/api/v2`).

Open registry items in this domain: **B-14** universal import engine formalization (per-module
specs exist; the standalone `@crm2/import-engine` package was never built — current shared
`platform/import` engine is the de-facto implementation) · **IE-DEFER-7** commission export↔import
shape · **ADR-0059** case bulk import (Proposed, unbuilt — adjacent, not master-data).

---

## 6 — Findings (ranked) & recommendations

Severity = admin-experience impact. Disposition column = **PENDING owner review** (audit-only).

| ID | Sev | Finding | Recommendation | Effort | ADR? |
|----|-----|---------|----------------|--------|------|
| **UX-1** | HIGH | **Onboarding chain: ~27 visits / ~35 submissions**, dependency order invisible, failures surface downstream as empty/mislabeled pickers | **Client Setup hub/wizard**: one page, client-scoped, walks Products → CPV units (multi-select) → rate types per combo → rates grid → commission; each step composes the existing endpoints + shows a completeness checklist. Biggest single lever (est. → ~1 page / ~8 logical steps) | L | **Yes** (new UX pattern) |
| **UX-2** | HIGH | Six separate imports (two on the CPV page alone) to bulk-onboard one client; order-of-operations knowledge required | **One "client onboarding workbook"**: single multi-sheet XLSX (Products · CPV · RTA · Rates · Commission) imported in one sequenced preview→confirm run, resolving codes sheet-to-sheet. Complements UX-1 for spreadsheet-first admins | L | **Yes** (import-engine extension) |
| **UX-3** | HIGH | Rate form's type-picker gating messages are inconsistent/misleading ("Pick client, product & unit first" when the combo *is* picked but has zero assignments); silent all-units fallback in RTA form when CPV link missing | Distinct states: "No rate types assigned for this combination → [Assign now]" deep-link; RTA form warns "(client, product) has no CPV link" | S | No |
| **UX-4** | HIGH | 409 overlap (`RATE_EXISTS`/`COMMISSION_RATE_EXISTS` from the EXCLUDE constraints) surfaces as generic "Save failed" | Map to friendly message: "An active rate for this combination overlaps [window] — revise or end-date it first", link to the row | S | No |
| **UX-5** | MED | Rate Types page is the only master-data page with **no import/export** | Add ImportButton + export via the shared engine (19-row catalog today, so value is parity/backup more than volume) | S | No |
| **UX-6** | MED | CPV unit enabling = one submission per unit; no multi-select; sub-table unpaginated | Multi-select unit picker (one bulk POST), paginate sub-table | S–M | No |
| **UX-7** | MED | Pincode→area cascade dead-ends silently when a pincode isn't in `locations` (Rates + Commission forms) | "Pincode not found" inline message + (optional) in-form add-location dialog for `masterdata.manage` | S (msg) / M (dialog) | No |
| **UX-8** | MED | Rate-type availability & CPV linkage **not enforced server-side** (verified: 0013 dropped the 0012 trigger; no FK to client_products; unknown type code resolves to NULL silently) | Decide: (a) accept as UX-gate (document), or (b) enforce 400 `RATE_TYPE_NOT_ASSIGNED` / warn on create+import. (b) tightens `/api/v2` accepted inputs → treat as ADR-level decision | M | **Yes if (b)** |
| **UX-9** | MED | Field/Office toggle silently clears unit/pincode/area/type mid-form | Confirm dialog or disable toggle once downstream fields are filled | S | No |
| **UX-10** | MED | Commission page: no list filters; type picker offers OFFICE alongside FIELD types with different location rules; no most-specific-wins preview; TAT picker `limit=100` | Add client/user filters (parity with Rates); group/annotate OFFICE in picker; optional "which rule wins" preview panel; raise/paginate TAT query | S–M | No |
| **UX-11** | LOW | RTA rows immutable (deactivate+recreate to fix a wrong type — 2 ops) + no bulk-deactivate (parity gap with rates/clients/products) | Keep immutable keys (consistent model); add bulk-deactivate; optionally an "replace type" convenience that does deactivate+create atomically | S | No |
| **UX-12** | LOW | `createOnly`/CODE_LOCKED immutability not visually indicated (code cells look editable) | Lock icon / muted style on immutable cells | S | No |
| **UX-13** | LOW | Rate History dialog not exportable | Export button in HistoryDialog (CSV) | S | No |
| **UX-14** | ~~LOW~~ **RETRACTED 2026-07-08** | ~~Import accepts XLSX only~~ — FALSE: CSV import pre-existed since the first commit (magic-byte sniff; the stale `format.ts:6` doc comment misled the audit) | Behavior now pinned by 11 engine tests + dual-format browser round-trip (Batch 2 T10); doc-comment fix spun out | — | — |
| **UX-15** | INFO | Deactivating a client does not cascade (its CPV/RTA/rates stay active-but-dead) | Document; optionally a "deactivate client + dependents" guided action later | — | Later |

### Suggested sequencing (if/when owner greenlights build)
1. **Quick-win batch (UX-3, 4, 5, 9, 11, 12, 13; ~1 slice):** messages, 409 mapping, rate-types
   import/export, toggle guard, bulk-deactivate parity, lock icons, history export. No ADR, no mig,
   all additive.
2. **Bulk-entry batch (UX-6, 7, 10, 14):** CPV multi-select, pincode UX, commission filters, CSV import.
3. **Strategic (UX-1 + UX-2, one ADR):** Client Setup hub + onboarding workbook — this is where the
   27-visit journey actually collapses; design both around the same sequenced-resolve service so
   the wizard and the workbook share one backend path. UX-8 enforcement decision rides along.

---

## 7 — Cross-checks performed during synthesis
- **Correction (2026-07-08, from the Batch-3 spec adversarial review):** the original "blank unit = Universal" claim for CPV-unit *import* was wrong — the ImportSpec requires `unitCode` (`cpv/import.ts:98,106`), so a Universal (NULL-unit) CPV row **cannot be imported today**, only created in the UI. Matrix row fixed above; this strengthens UX-2/UX-6.
- 0012 eligibility trigger: **dropped in 0013** (both trigger + `rate_type_eligibility` table) — DB-agent claim corrected.
- Import formats: **XLSX-only** (`platform/import`), CSV is export-side only — FE-agent claim corrected.
- Universal rows in exports: **retained** (LEFT JOINs) — stale memory claim (2026-06-26 deferral) corrected; since fixed.
- Rates contract vs storage: `clientRateType` code in SDK contract; `rate_type_id` FK in DB (ADR-0068) — both agents partially right.

*Sources: 4 agent reports (FE `apps/web/src/features/*`; BE `apps/api/src/modules/*` + `platform/import|export`; DB `db/v2/migrations/0001–0116`; ADR/rules `docs/adr/*`, `DATAGRID_STANDARD`, `IMPORT_EXPORT_STANDARD`, `DESIGN_AND_STACK_FREEZE`, `RESPONSIVE_DESIGN_STANDARD`, `CONCURRENCY_AND_EDITING_STANDARD`, `LONG_TERM_PROTECTION`, `COMPLIANCE_GAPS_REGISTRY`).*
