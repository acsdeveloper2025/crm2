# ADR-0007: Naming standards

- **Status:** Accepted
- **Date:** 2026-06-04

## Context

A polyglot codebase (SQL, TypeScript, HTTP routes, environment/config) drifts
into inconsistent naming without an explicit, enforced convention. Consistency
matters most at the boundaries where the layers meet.

## Decision

We standardize naming per layer:

- **SQL:** `snake_case`, **plural** table names; object prefixes
  `idx_`, `uq_`, `fk_`, `v_`, `mv_`, `trg_`, `fn_`.
- **TypeScript / API payloads:** `camelCase`.
- **HTTP routes:** `kebab-case`.
- **Environment variables and codes:** `UPPER_SNAKE_CASE`.
- The boundary is bridged by **`camelize()` at the repository edge** — SQL rows
  (snake) are converted to camelCase as they leave the repository layer.

## Consequences

### Positive

- Each layer follows its idiomatic convention; no mixed casing within a layer.
- A single, well-defined conversion point (`camelize()` at the repo edge)
  rather than scattered ad-hoc mapping.

### Negative

- Requires the conversion to be applied consistently at every repository
  boundary.

## Alternatives Considered

- **One casing everywhere** — rejected: fights the idioms of SQL, JS/TS, URLs,
  and env vars; one of them always looks wrong.
- **Manual per-query field mapping** — rejected: error-prone vs. a single
  `camelize()` at the edge.

## Related ADRs

- ADR-0005 — the repository edge where `camelize()` is applied.
