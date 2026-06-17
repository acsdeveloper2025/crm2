# ADR-0002: Case → Task → Verification Unit model

- **Status:** Accepted
- **Date:** 2026-06-04

## Context

We need one operational hierarchy that covers both field visits and KYC
document checks without spawning parallel engines. The core question was the
granularity and whether KYC deserves its own execution engine.

## Decision

We adopt **Decision B**: the hierarchy is **Case → Task → Verification Unit**.

- There is **one task table** with a **subtype** discriminator.
- **KYC is a subtype kind**, not a separate engine — KYC tasks flow through the
  same task lifecycle as field tasks, differing only by subtype and the
  Verification Units they reference (see ADR-0001).

## Consequences

### Positive

- A single task lifecycle, assignment path, completion path, and audit chain
  serves all work types.
- Avoids duplicated engines and the drift between them that plagued the legacy
  system.
- KYC-specific behavior is expressed as subtype data/config, keeping the core
  uniform.

### Negative

- The single task table must carry subtype-conditional fields and constraints.
- Subtype-specific rules live in shared code paths and must be guarded
  carefully.

## Alternatives Considered

- **A — coarse model (case-level only)** — rejected: too coarse; cannot
  represent per-unit verification, billing, or results.
- **C — dual-engine (separate KYC engine)** — rejected: duplicate lifecycles,
  guaranteed drift, double the maintenance.
- **D — "Document" as the primary user-facing unit** — rejected as the system
  model; "Documents as the face of Tasks" is a presentation concern, not the
  execution model.

## Related ADRs

- ADR-0001 — Verification Units are the leaf the task references.
- ADR-0006 — the Verification Workspace executes these tasks (KYC as a mode).
