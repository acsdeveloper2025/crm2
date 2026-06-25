# ADR-0066 — Global navbar client+product selector (convenience filter)

**Status:** Accepted · **Owner-requested** (2026-06-25) · **Extends:** ADR-0022 (data scope). **Migration:**
none (additive `productId` list filter on existing endpoints). **Origin:** v1 "Active Scope" header feature.

## Context

v1 shipped a header "Active Scope" — Client→Product dropdowns that narrow every list to the chosen
client/product. The owner wants the same in v2: "one option on the navbar for selecting client and product
so the system can filter it." v2 already had ~80% of the primitives: scope-limited `/clients|products/options`
feeds, a `clientId` list filter wired end-to-end on cases + tasks, and the ADR-0022 scope predicate that
makes any client/product filter safe. Missing: a `productId` list filter and a global header selector.

The critical distinction (which v1 enforced by hand via header validation) is that this is a **convenience
filter, not a security boundary**. In v2 the separation is structural and free:

- The selector's **options are scope-limited** — `/clients|products/options` already return only entities
  in the user's data scope, so a user can never see or pick a client outside their scope.
- The list query **ANDs** the convenience `clientId`/`productId` with the hard `caseScopePredicate`/
  `taskScopePredicate` (ADR-0022). Even a forged id intersects to zero rows. The selector can only narrow
  *within* scope, never widen it.

## Decision

1. **Add a `productId` domain filter** to the cases and pipeline (tasks) list endpoints, mirroring the
   existing `clientId` filter (`cs.product_id = $n`, ANDed with scope; echoed in the response `filters`).
   Additive `/api/v2`, mobile-safe (no mobile route consumes it).

2. **Add a global navbar selector** (web): an `ActiveSelectionProvider` React context holding
   `{ clientId, productId }`, persisted to **sessionStorage** (`crm2.activeSelection`, per-tab — dies with
   the tab, cannot leak across sessions). Two `SearchableSelect`s in the header (`<lg` hidden to respect the
   responsive freeze; auto-hidden when ≤1 client and ≤1 product are in scope). Changing the client clears
   the product. The selection is threaded into list pages via the existing DataGrid `filters` prop, which is
   part of the grid's react-query key — so changing it refetches automatically (no manual cache plumbing).
   Wired into the **Cases** and **Pipeline** lists. Default (both null) = "all" = the user's full scope.

## Consequences

### Positive

- Office users with multi-client portfolios can focus the whole operational surface on one client/product.
- The convenience/security separation is guaranteed by the existing scope predicate — no v1-style
  header-validation middleware or 403 path needed.
- Reuses existing infra (scope-limited options, the `filters` prop, the scope predicate); the only backend
  change is an additive `productId` filter.

### Negative

- The selector is desktop-only (`<lg` hidden) to avoid header overflow on mobile/tablet — field users on
  phones don't get it (acceptable; it auto-hides for single-client users anyway and mobile is the field app's
  domain).
- Only Cases + Pipeline are wired initially; other lists (billing/MIS) keep their own cascading selectors.

## Alternatives Considered

- **v1's header `X-Active-*` + server validateActiveScope (403 on violation).** Rejected — v2 gets the
  same guarantee for free from the ADR-0022 scope predicate (AND-intersection) + scope-limited options; a
  per-request validation middleware would be redundant. (An optional audit-log of bypass attempts could be
  added later if desired.)
- **SDK-global injection** (inject the selection into every list call from the SDK factory). Rejected for
  now — the per-page `filters` prop is the existing idiom and avoids a hidden global mutation of every request.

## Related ADRs

- **ADR-0022** — data scope; the hard boundary this convenience filter layers on top of.
- **ADR-0065** — case-create portfolio scope (same `scopedEntityIds` that scopes the option feeds).
