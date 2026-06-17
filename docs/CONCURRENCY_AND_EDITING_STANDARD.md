# CONCURRENCY_AND_EDITING_STANDARD.md — how editing works everywhere (FROZEN)

**Status:** FROZEN 2026-06-05 · **ADR:** [ADR-0019](adr/ADR-0019-concurrency-and-editing-standard.md) ·
**Scope:** ALL administration modules (and every read-then-edit CRUD in the app) — current and future.

> The one rule: **every record edit is an Optimistic-Concurrency update guarded by an integer
> `version`; a stale write returns HTTP 409 `STALE_UPDATE` and the user reloads/re-applies — never a
> silent overwrite.** This is mandatory; no module rolls its own editing behaviour.

---

## 0. Current state (the review that drove this)

Audited every admin module: **last-write-wins everywhere** — `UPDATE … WHERE id=$1`, no version guard,
no conflict detection. `verification_units` has a `version` column but it is an unenforced counter (no
`WHERE version=$expected`). Change history exists only for `rates` (`rate_history`); all other tables
keep only `updated_by`/`updated_at`. Tables WITH a `version` column today: `verification_units`,
`rate_types`, `rates`. Tables WITHOUT: `clients`, `products`, `locations`, `users`, `report_templates`,
`client_products`, `client_product_verification_units`, `cases`, `case_tasks`. → standardize + retrofit.

## 1. Recommended approach — Optimistic Concurrency Control (OCC)

- Each editable row owns a monotonic **`version integer NOT NULL DEFAULT 1`**.
- **Read** returns `version`. **Update** sends the `version` the user started from.
- The UPDATE is **guarded**: it only applies if the row is still at that version; otherwise it is a
  **conflict** (someone else saved first) → the user is shown the current record and re-applies.
- **No pessimistic locks** held across a user's think-time (no "locked by user X"). DB row locks
  (`FOR UPDATE`) are allowed only *inside one short transaction* for read-modify-write.
- **Bulk** edits = per-row OCC with a partial-success report. Concurrency is rare here (~2 writes/sec)
  so OCC's cost is one extra predicate; the value is zero silent data loss.

## 2. Database strategy

- **Column:** `version integer NOT NULL DEFAULT 1` on every editable table (migration adds it where
  missing; backfill `1`). Keep `created_by/updated_by/created_at/updated_at` (audit columns standard).
- **Guarded update (the canonical statement):**
  ```sql
  UPDATE <t>
     SET <cols…>, version = version + 1, updated_by = $actor, updated_at = now()
   WHERE id = $id AND version = $expectedVersion
  RETURNING <SELECT_COLS>;   -- includes version
  ```
  `RETURNING` with **0 rows** ⇒ either not-found or version-mismatch → the repo does one existence
  check to choose `404 NOT_FOUND` vs `409 STALE_UPDATE`.
- **Transactions:** any update spanning >1 statement/table runs in `withTransaction` (BEGIN/COMMIT/
  ROLLBACK). Single-statement guarded updates are already atomic.
- **Audit / history preservation (append-only):** every create/update/deactivate appends an immutable
  change record (actor, action, before/after or changed-field set, timestamp) — the frozen
  hash-chained audit (MASTER_MEMORY §1). Master data uses a generic `audit_log`; effective-dated
  domains keep their domain history (e.g. `rate_history`). **History is never updated or deleted.**
- **Effective-dated rows** (`rates`) keep their revise-as-new-row model (ADR-0018) — OCC still guards
  the *current* row's edits/deactivation.

## 3. API strategy

- **Reads** (`GET`) always include `version` in the DTO.
- **Writes** (`PUT`/`POST …/activate|deactivate`) **require the expected version**: carried in the
  request body as `version` (primary, SDK-friendly) — the HTTP-canonical `If-Match: "<version>"` header
  is an accepted equivalent. Missing/!integer version on an update → `400 VERSION_REQUIRED`.
- **Conflict response:** `409 STALE_UPDATE` with body `{ error: 'STALE_UPDATE', current: <fresh row incl. version> }`
  so the client can show what changed without an extra round-trip.
- **Validation order (in the service):** zod parse (400) → load existing (404) → version check is the
  DB guard (409) → DB constraint errors mapped (409/400). Validation never runs after the write.
- **Repos** own the guarded SQL + error mapping (ADR-0005); controllers/services never write raw SQL.
- **Activate/deactivate** are also version-guarded (they are edits).

## 4. Frontend strategy

- The edit dialog **captures `version`** from the row when opened and **sends it back** on save.
- TanStack Query: invalidate the list/detail on success; the refetch carries the new version.
- On **409 STALE_UPDATE**: do **not** retry blindly. Show the conflict UI (§5) using `current` from the
  response. On **400 VERSION_REQUIRED**: bug guard (always include version).
- Single-flight save (disable Save while pending); never auto-resubmit a stale version.

## 5. User-experience strategy (conflicts)

- **Never silently overwrite and never silently discard.** On conflict, open a **Conflict dialog**:
  "This record was changed by **<updatedBy>** at **<updatedAt>** while you were editing." Show the
  current values (and, where feasible, a field-level diff of theirs-vs-yours).
- Offer: **Reload & re-apply my changes** (load current `version`, re-enter the user's edits, save) or
  **Discard my changes** (close with current values). A future enhancement may auto-merge
  non-overlapping fields; until then the user decides.
- Saving stays a single explicit action; optimistic UI is fine but reconciles to the server version.

## 6. Testing strategy

- **Concurrency:** read v1 → update A (→ v2, 200) → update B with v1 → **409 STALE_UPDATE**; B re-reads
  v2, updates → 200. (Per module with edits.)
- **Version bump:** every successful update increments `version` by exactly 1 and is returned.
- **404 vs 409:** update a non-existent id → 404; update an existing id with a stale version → 409.
- **400:** update without `version` → `VERSION_REQUIRED`.
- **Audit:** every create/update/deactivate writes exactly one append-only history row (actor+action).
- **Bulk:** mixed batch (some current, some stale) → per-row result (success/CONFLICT), no partial
  silent overwrite; wrapped in a transaction where the batch must be atomic, else per-row.
- **Transaction:** a forced mid-update failure rolls back with no partial write and no version bump.
- CI gates 51–53 (OCC-contract · audit-row · bulk-partial) activate per module.

## 7. Risks

- **Retrofit scope:** add `version` to ~9 tables + convert every guarded update + build the generic
  `audit_log` (tracked: COMPLIANCE **C-10**). Sequence carefully behind the gate.
- **Contract change:** updates now require `version`; SDK/clients (incl. mobile) must send it — additive
  but mandatory. Honour `MOBILE_API_COMPATIBILITY_MATRIX.md` (mobile sends version too).
- **Whole-row OCC:** two users editing *different* fields still conflict (safe but can annoy) — optional
  field-level merge is a later enhancement, not v1.
- **Audit volume/growth:** append-only history grows; covered by `DATA_RETENTION_POLICY.md` + partitioning.
- **Effective-dated interplay:** `rates` revise (new row) vs current-row OCC — keep both; tests cover it.

## 8. Final implementation standard (mandatory for ALL admin modules)

1. Every editable table has `version integer NOT NULL DEFAULT 1`.
2. Every update (incl. activate/deactivate) is **`… SET …, version = version + 1, updated_at = now(),
   updated_by = $actor WHERE id = $id AND version = $expected`**, `RETURNING` the row.
3. 0 rows → existence check → **404 NOT_FOUND** or **409 `STALE_UPDATE`** (with `current`).
4. Updates **require** the expected `version` (body `version` or `If-Match`); missing → **400
   VERSION_REQUIRED**. Reads return `version`.
5. Multi-statement writes run in `withTransaction`; raw SQL only in repos.
6. Every create/update/deactivate appends an **immutable** audit/history row (never updated/deleted).
7. Bulk edits are **per-row OCC** with a partial-success result; large bulk = background job.
8. FE: capture version on open, send on save, show the **Conflict dialog** on 409 (reload & re-apply /
   discard) — **no silent overwrite, ever**. New admin modules ship this from day 1; pre-freeze modules
   retrofit (C-10) before GA.

## Related

- [ADR-0019](adr/ADR-0019-concurrency-and-editing-standard.md) · ADR-0005 (repository pattern) ·
  ADR-0018 (`rates` effective-dated revise) · `BUSINESS_RULES.md` · `docs/MANAGEMENT_LIST_STANDARD.md` ·
  `docs/DATAGRID_STANDARD.md` (bulk actions) · `DATA_RETENTION_POLICY.md` · `docs/FROZEN_DECISIONS_REGISTRY.md`.
