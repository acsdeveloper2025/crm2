# ADR-0008: Design system

- **Status:** Accepted
- **Date:** 2026-06-04

## Context

CRM2 needs a coherent, maintainable visual language across all screens,
with theming support and no per-component color drift.

## Decision

We base the design system on **80% Twenty CRM, 10% Linear, 10% Salesforce**.

- **Tokens live in `@crm2/ui-theme`** — the single source of design tokens.
- Palette is **blue / slate**, with **light and dark** themes.
- **No hardcoded colors** in components; everything resolves through tokens.
- **Uppercase display text is visual-only** (a presentation transform), not a
  change to underlying data values.

## Consequences

### Positive

- One token source means theme and palette changes are made in one place.
- Light/dark support is built in via tokens.
- Banning hardcoded colors prevents drift and keeps theming reliable.

### Negative

- Contributors must use tokens; raw color literals are a defect to be caught in
  review.

## Alternatives Considered

- **Per-component / hardcoded colors** — rejected: guarantees drift and breaks
  theming.
- **A single external design system verbatim** — rejected in favor of a
  weighted blend (Twenty/Linear/Salesforce) tuned to our needs.

## Related ADRs

- ADR-0006 — the Verification Workspace consumes this design system.
