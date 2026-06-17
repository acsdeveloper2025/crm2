# ADR-0019: Concurrency & editing standard (optimistic concurrency control)

- **Status:** Accepted
- **Date:** 2026-06-05

## Context

Every administration module is read-then-edit CRUD over shared master data. Today
every update is **last-write-wins**: `UPDATE … WHERE id = $1` with no version guard,
so two office users editing the same client / rate / user silently clobber each
other, with no conflict detection and no change history (only `updated_by` /
`updated_at`; `rates` alone keeps `rate_history`). `verification_units` has a
`version` column but it is an informational counter (`version = version + 1`), **not**
enforced as a concurrency token. We need ONE editing behaviour across all admin
modules. Write concurrency is low (~2 writes/sec peak), but two humans editing the
same record concurrently is realistic and must be safe.

## Decision

**Optimistic Concurrency Control (OCC) via an integer `version` token, surfaced as
HTTP 409 on conflict, with a reload-and-reapply UX. No pessimistic row locking held
across user think-time.** Every editable table carries `version integer NOT NULL
DEFAULT 1`; reads return it; updates send the expected version and run
`UPDATE … SET …, version = version + 1, updated_at = now(), updated_by = $actor
WHERE id = $1 AND version = $expected`. **0 rows affected → 409 `STALE_UPDATE`**
(after a not-found check). Multi-statement writes run in a transaction; every edit
appends to an append-only audit/change record. Bulk edits are **per-row OCC**
(partial-success result), never an all-or-nothing silent overwrite.

We reject **pessimistic locking** (DB row locks / "record locked by user X" UI):
locks leak across crashes and idle tabs, serialize unrelated work, and give poor web
UX. We reject **last-write-wins** (the status quo): silent data loss. We reject a
**timestamp token** (`updated_at`) in favour of an integer `version` to avoid clock
skew / sub-millisecond collisions.

## Consequences

### Positive

- Concurrent edits are safe: the second writer is told the record changed instead of
  silently overwriting. Deterministic, cheap (one extra `AND version=`), no locks.
- One identical pattern across every module; trivially testable (two updates, same
  version → second 409s).
- Pairs with the append-only audit requirement → full history of who changed what.

### Negative

- Migration to add `version` to the tables that lack it, and a guarded-update +
  audit retrofit across existing modules (tracked retrofit, COMPLIANCE C-10).
- Clients must send the version on update; OCC is whole-row — two users editing
  *different* fields still conflict (acceptable; optional field-level merge later).
- Requires the append-only audit/history store to be built (currently only `rates`).

## Alternatives Considered

- **Last-write-wins (status quo)** — rejected: silent data loss on concurrent edits.
- **Pessimistic locking** (`SELECT … FOR UPDATE` held / app-level record locks) —
  rejected: lock leakage, serialization, poor web UX. (`FOR UPDATE` is still allowed
  *within a single short transaction* for read-modify-write, never across user time.)
- **`updated_at` as the token** — rejected: clock skew and collision risk; integer
  version is exact and monotonic.

## Related ADRs

- ADR-0005 (repository pattern: the guarded UPDATE + error mapping live in repos) ·
  ADR-0013 (governance/engineering umbrella) · ADR-0017 (effective-from: another
  column added to the same admin tables) · the append-only hash-chained audit is a
  frozen security decision (MASTER_MEMORY §1) this ADR depends on.
