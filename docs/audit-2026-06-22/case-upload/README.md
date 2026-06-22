# Bulk Case-Upload — Dependency & Field Audit (2026-06-22)

> Read-only multi-agent audit of the **entire case/task creation flow + every dependency**, to ground
> the bulk Case-Creation import design ([ADR-0059](../../adr/ADR-0059-case-creation-bulk-import.md)).
> Per-domain maps: `C1`–`C5` in this folder. Frozen build — nothing changed.

## The 5 domains audited
| | Domain | File |
|---|---|---|
| C1 | Case + Applicant + Task flow + cardinality + create contract | `C1-case-applicant-task-flow.md` |
| C2 | Catalog chain: Client → Product → CPV → Verification-Unit enablement | `C2-catalog-client-product-cpv.md` |
| C3 | Pricing: Rate management + Commission + Rate types (when they gate creation) | `C3-pricing-rate-commission.md` |
| C4 | Assignment: User + Scope + Area/Pincode + assignment-pool roles | `C4-assignment-user-scope-location.md` |
| C5 | Dedupe gate (search-first, cross-applicant, ADR-0053) | `C5-dedupe.md` |

## The dependency graph (what a case/task touches)

```
                 ┌─ Client Code ─→ clients.code (UNIQUE) ─────────┐
   CASE header ──┤                                                 ├─→ cases  (2 single FKs, NO CPV check)
                 └─ Product Code ─→ products.code (UNIQUE, GLOBAL)─┘
                         │
   (client,product) ─→ client_products link (REQUIRED for a task)
                         │
   TASK ── Unit Code ─→ verification_units.code, ENABLED via client_product_verification_units
                         │     └─ create-time gate: addTasks → allUnitsEnabled → 400 UNIT_NOT_ENABLED
                         ├─ Visit Type (FIELD/OFFICE)  ── FIELD ⇒ Address required (web)
                         ├─ Pincode + Area ─→ locations(pincode,area) UNIQUE   (only needed to ASSIGN)
                         ├─ field_rate_type  ── SERVER-DERIVED on FIELD assign (never in the file)
                         └─ Executive (username) ── OPTIONAL; assign-time only → pulls in:
                                   pool-role (FIELD→FIELD_AGENT) + hierarchy + territory scope + commission@location
   APPLICANT(s) (1→N) ── Name/Mobile/PAN/Company/Type  ── dedupe keys
                         └─ DEDUPE: searchDuplicates(name|pan|company|mobile, EXACT, ALL cases) per applicant
```

## The decisive findings (these shape the whole design)

1. **Import tasks PENDING (unassigned) and the hard dependencies vanish.** Pricing (C3) and assignment
   (C4) gates — `NO_FIELD_COMMISSION`, scope/pool/territory eligibility — fire **only when a FIELD task
   is assigned**. A PENDING task needs **no executive, no commission, no location, no scope**. ADR-0056's
   "FIELD location required at create" is a **web-form rule, not a server invariant** (C4). → **v1 imports
   PENDING tasks; assignment stays in the existing Pipeline bulk-assign.** This removes the scariest
   dependencies from the critical path.

2. **The importer MUST run dedupe itself (C5).** `caseService.create` does **no** dedupe — it trusts the
   payload's `dedupeDecision`; the gate is web-UI-only. Reuse `caseRepository.searchDuplicates` directly
   (scope-free, the same source the UI uses), per applicant, EXACT match on name/mobile/pan(/company).
   **Also dedupe WITHIN the file** — two new rows aren't in the DB yet, so `searchDuplicates` can't catch
   an intra-batch duplicate.

3. **The CPV-enablement gate is authoritative (C2).** A task's unit must be CPV-enabled for the case's
   client+product (`UNIT_NOT_ENABLED`). The importer validates this at preview (resolve unit code → id,
   check enablement with USABLE semantics — the raw `allUnitsEnabled` skips the VU active/effective gate,
   a latent defect; the importer should use the stricter `availableUnits` semantics).

4. **No pricing columns (C3).** `field_rate_type` is server-derived; `client_rate_type` + all amounts are
   read-time (billing/MIS). The file must **not** carry any rate/commission/rate-type value.

5. **Everything resolves by human CODE/NAME (C1/C2/C4).** The cases API takes numeric ids only — the
   importer does all lookups: `clients.code`, `products.code`, `verification_units.code` (all UNIQUE),
   `users.username`, and pincode+area → `locations` via the existing `findByPincodeArea` (rates import).

6. **Create is non-atomic (C1/C2).** `POST /cases` (case+applicants) and `POST /cases/:id/tasks` are
   separate transactions; a task failure after a case insert leaves a **task-less shell**. → the importer
   must create case+applicant+task in **one transaction** (a thin additive `createCaseWithTask` service
   composing the existing repo calls), so a row fully succeeds or fully fails.

## Recommended v1 row model (one row = one complete case)

| Column | Resolve | Required | Notes |
|---|---|---|---|
| Client Code | `clients.code`→id (USABLE) | ✅ | |
| Product Code | `products.code`→id (USABLE) | ✅ | global |
| Backend Contact No | as-is (10–15 digits) | ✅ | case header |
| Applicant Name | `toUpper` | ✅ | dedupe key |
| Applicant Mobile / PAN / Company | as-is | optional | dedupe keys; ≥1 identifier recommended |
| Applicant Type | enum | ✅ | APPLICANT (primary) in v1 |
| Verification Unit Code | `verification_units.code`→id, **CPV-enabled** | ✅ | `UNIT_NOT_ENABLED` if not |
| Visit Type | enum FIELD/OFFICE | ✅ | drives conditionals |
| Address | as-is | ✅ if FIELD | |
| Pincode + Area | `findByPincodeArea`→location id | ✅ if FIELD (so the task is assignable) | both-or-neither |
| Trigger | as-is | optional | |
| Target TAT | `tat-policies` bucket (ADR-0044) | optional | |
| Allow Duplicate (Y/N) + Dedupe Rationale | → `dedupeDecision`/`dedupeRationale` | conditional | see C5 mapping |

**Owner-confirmed scope (2026-06-22):** v1 supports **both** assignment modes (PENDING by default; an
**optional `Executive` column** assigns at import via the per-row-tolerant Pipeline `bulkAssign` path)
AND **multi-applicant / multi-task from v1** via a `Reference Number` group key + applicant discriminator
+ `Primary?` flag (one row per (case, applicant, task)). The finalised design is in
[ADR-0059](../../adr/ADR-0059-case-creation-bulk-import.md) — plan only, no code yet.

## Pre-existing defects surfaced (not blockers; separate fixes)
- **D-1 (C2):** `allUnitsEnabled` doesn't check the VU's `is_active`/`effective_from` (the FE picker does)
  → a deactivated/future unit with a live cpvu row passes a direct `addTasks`. Importer must use USABLE.
- **D-2 (C4):** `bulkAssign` still re-points a live ASSIGNED task in place (ADR-0055 leftover; registry SHIP-1).
- **D-3 (C1):** non-atomic case+task create can leave task-less shells on partial failure (the v1 atomic
  service path fixes this for the import path).

## Decisions — RESOLVED (owner, 2026-06-22)
1. **Assignment:** ✅ BOTH — PENDING by default + optional `Executive` column to assign at import.
2. **Applicants:** ✅ multi-applicant / multi-task from v1 (grouped rows via `Reference Number`).
3. **Dedupe override:** ✅ `Allow Duplicate` (Y/N) + `Dedupe Rationale`.
4. **Atomic create:** ✅ add the thin `createWithTasks` service (one tx).
5. **Next step:** finalise the plan only (this ADR + audit) — **no code this session**; build on greenlight.
