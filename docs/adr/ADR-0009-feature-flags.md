# ADR-0009: Feature flags

- **Status:** Accepted
- **Date:** 2026-06-04

## Context

Several CRM2 capabilities are high-risk to ship — they touch core
workflows, money, or customer-facing output. We need to decouple deploy from
release so these can be enabled deliberately and rolled back instantly.

## Decision

**High-risk features ship behind feature flags.** Specifically:

- the **Verification Workspace**,
- **billing**,
- **reporting**, and
- the **assignment engine**.

Each is gated so it can be enabled or disabled without a redeploy.

## Consequences

### Positive

- Deploy is decoupled from release; high-risk features go live on a switch.
- Instant rollback by flipping a flag rather than reverting and redeploying.
- Enables controlled rollout of the riskiest surfaces.

### Negative

- Flagged code paths add conditional branches that must be maintained and
  eventually cleaned up once a feature is stable.

## Alternatives Considered

- **Ship high-risk features directly (no flags)** — rejected: no safe rollout,
  rollback requires a redeploy.
- **Flag everything** — rejected: unnecessary branch overhead for low-risk
  features; flags are reserved for high-risk surfaces.

## Related ADRs

- ADR-0006 — the Verification Workspace ships behind a flag.
- ADR-0010 — reporting is a flagged high-risk surface.
