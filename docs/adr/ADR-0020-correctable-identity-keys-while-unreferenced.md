# ADR-0020: Correctable identity keys while unreferenced

- **Status:** Accepted
- **Date:** 2026-06-06
- **Amends:** ADR-0001 (immutable + versioned codes)

## Context

Master-data identity keys are immutable everywhere — `clients.code`, `products.code`,
`verification_units.code`, `report_templates.code`, `users.username`, `locations.pincode`, and
the CPV/rate composite keys. ADR-0001 froze this so that history and reports stay coherent over
time (a report run last month must still resolve "HDFC" to the same entity).

The cost surfaced in operation: if a user **typos an identity key at creation** (e.g. `HDCF`
instead of `HDFC`), there is no way to correct it — the only remedy is deactivate-and-recreate,
which leaves a dead row and is clunky for a brand-new mistake. Note that all foreign keys
reference these rows by **surrogate id**, never by the code string, so editing a key never breaks
referential integrity in the database; the immutability is purely a *business/reporting* stability
guarantee, and that guarantee only matters once the row has actually been **used** (referenced by
dependent records or reported on).

## Decision

We will make an identity key **correctable while the row is unreferenced, and locked once it is
referenced.**

- On update, if the identity key (`code`/`pincode`/etc.) is provided and differs from the stored
  value, the service first checks whether the row has any **dependents** (rows in tables that
  reference it). If none → the key change is applied. If any → the server rejects it with
  `409 CODE_LOCKED` (`PINCODE_LOCKED`, etc.), naming that it is in use.
- A locked key remains correctable only by deactivate + recreate (the prior remedy).
- `users.username` is a login identifier with **no FK dependents** (everything references the user
  by uuid id); it is correctable as a login rename (still uniqueness-checked), and does not need a
  dependents gate.
- The OCC version guard (ADR-0019), uniqueness, and the audit-log append apply to a key edit
  exactly as to any other edit.

This amends — does not abandon — ADR-0001: a key that is *in use* is still immutable; only a fresh,
unreferenced entry can be corrected.

## Consequences

### Positive

- Users can fix a mistyped key on a brand-new entry directly, without a dead row.
- Reporting/history coherence is preserved for any data that is actually referenced (the only data
  for which it matters).
- No DB integrity risk — FKs are by id, and the lock is enforced before any in-use key changes.

### Negative

- The update path is slightly more complex (a dependents check per entity).
- "Unreferenced" is defined per entity (each has its own set of referencing tables); the rule is
  uniform but the check is entity-specific.

## Alternatives Considered

- **Keep blanket immutability (deactivate + recreate).** Rejected: poor UX for fresh typos; the
  owner asked to fix it.
- **Make keys freely editable.** Rejected: reopens the report/history-coherence concern for data
  that is already in use; an in-use key should stay stable.
- **Hard-delete an unreferenced row.** Rejected as the primary mechanism: deletion sits awkwardly
  with the append-only/audit philosophy; correcting in place is cleaner and keeps the audit chain.

## Related ADRs

- ADR-0001 — verification-unit registry model (original immutable+versioned codes); amended here.
- ADR-0019 — concurrency & editing standard (OCC version guard applies to key edits too).
- ADR-0017 — effective-from gating (the other mutable master-data field).
