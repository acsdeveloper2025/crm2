# ADR-0006: Verification Workspace

- **Status:** Accepted
- **Date:** 2026-06-04

## Context

The legacy system spread verification work across many routes and screens,
forcing reviewers into hundreds of context-switches and navigation clicks per
day. We need a single, focused place to perform verification work for both
field and KYC tasks.

## Decision

We build **one two-pane, status-adaptive Verification Workspace**.

- It adapts its panes/actions to the task's current status.
- **KYC is a mode** of the same workspace, not a separate screen.
- It is the functional equivalent of Zion's **NewDataQC** screen, but
  **governed** (RBAC + scope enforced).
- This is the **keystone screen** of CRM2.

## Consequences

### Positive

- Reviewers work in one place; field and KYC share the same surface (KYC as a
  mode).
- Status-adaptive UI removes dead controls and reduces context-switching.
- Collapses many legacy routes into a single workspace.

### Negative

- Concentrates significant functionality into one screen, raising the bar on
  its correctness, performance, and access governance.

## Alternatives Considered

- **Many per-status / per-type screens (legacy approach)** — rejected: the
  navigation and context-switch cost that 2.0 exists to remove.
- **Ungoverned QC screen (Zion-style)** — rejected: must enforce RBAC and
  scope rather than copy the platform.

## Related ADRs

- ADR-0002 — the Case → Task model the workspace operates on.
- ADR-0009 — the workspace ships behind a feature flag.
