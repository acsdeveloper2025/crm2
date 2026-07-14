# ADR-0094: Scope caps WRITE; hierarchy governs READ ("work on" vs "monitor")

- **Status:** **PROPOSED — NOT IMPLEMENTED.** Requires, per
  [LONG_TERM_PROTECTION.md](../governance/LONG_TERM_PROTECTION.md) ("RBAC 6-role hierarchy +
  default-deny scope"): a superseding ADR (this one) + **CTO approval** + **Security/Compliance owner**
  sign-off. Nothing in this ADR is built. Raised by the RBAC/scope/hierarchy audit of 2026-07-14.
- **Date:** 2026-07-14
- **Supersedes (in part):** [ADR-0072](./ADR-0072-user-scope-client-product.md) — only the
  **composition** of the CLIENT/PRODUCT legs into READ queries. The dimension catalog (CLIENT, PRODUCT,
  PINCODE, AREA), the EXPAND/RESTRICT modes, the per-user assignment model and the fail-closed resolver
  are all UNCHANGED.
- **Extends (unchanged):** [ADR-0022](./ADR-0022-open-role-catalog.md) (open role catalog; attributes,
  never role names) · [ADR-0076](./ADR-0076-security-hardening-phased.md) (scope predicate fails closed)
  · [ADR-0077](./ADR-0077-case-creation-lookups.md) (case-creation lookups stay portfolio-scoped) ·
  [ADR-0078](./ADR-0078-assignee-pool-territory.md) (assignee pool = territory/unit grant).
- **Migrations:** none proposed. This is a composition change in `platform/scope`, not a schema change.

## Context

The owner's requirement (2026-07-14), verbatim in intent: give TEAM_LEADER and MANAGER **assignable
client + product access so they can create cases/tasks**, **while monitoring the data of the backend
users and TLs who report to them**. Hierarchy is already exactly as desired and unchanged:
BACKEND_USER = `SELF`, TEAM_LEADER = `DIRECT_TEAM`, MANAGER = `SUBTREE`.

Today `platform/scope/index.ts` composes ONE expression for every read:

```
(hierarchy OR expand₁ OR expand₂ …) AND restrict₁ AND restrict₂ …
```

**RESTRICT always caps — hierarchy cannot widen past it.** That single property is what blocks the
requirement. Measured on production (2026-07-14), the real reporting chain:

| User | Role / hierarchy | Client grants | Works on |
|---|---|---|---|
| sulakshana.patil | MANAGER / SUBTREE | ADITYA BIRLA, L&T FINANCE | — |
| pradnya.mohite | TEAM_LEADER / DIRECT_TEAM | L&T FINANCE | L&T |
| prajkta.ghadigaonkar | BACKEND_USER / SELF | ADITYA BIRLA | **ADITYA BIRLA** (CASE-000005/6) |

pradnya's predicate resolves to `(hierarchy[pradnya, prajkta]) AND client IN (L&T)`. Her own direct
report's two ADITYA BIRLA cases fail the client cap, so **the team leader is blind to her own report's
work** unless she is separately granted ADITYA BIRLA.

There is no third mechanism to lean on: `clients`/`products` are flat global catalogs with **no
owner/team column and no team↔client table**, and `scopedEntityIds` never reads `scope.userIds`, so
lookups cannot be hierarchy-filtered even in principle. Per-user grants are the only lever.

## Options considered

**A. RESTRICT + grant the union of the team's clients — SHIPPED 2026-07-14** (prod portfolios granted
alongside [mig 0118](../../db/v2/migrations/0118_scope_wire_office_roles.sql)). pradnya was granted
ADITYA BIRLA; she now sees prajkta's cases and teams stay isolated. **Two standing costs:**
1. **Over-grant.** A grant is simultaneously the read key AND the write key, so granting ADITYA BIRLA
   *to let her monitor* also lets her **create** cases on it. The two authorities cannot be separated.
2. **Grant-chasing.** The grants must track what the team actually works on. The day prajkta is given a
   new client, pradnya goes **blind to her own report's work** until someone remembers to re-grant. The
   failure is silent — the row simply is not there.

**B. Wire CLIENT/PRODUCT as EXPAND instead.** Composition becomes `(hierarchy OR client ∈ grants)`, so
the leader sees their team (any client) *and* the picker still offers only their grants. **Rejected:**
it also reveals **other teams'** cases on any granted client (EXPAND widens past hierarchy — the
opposite of the isolation just established), and it trips the `scopedEntityIds` divergence below.

**C. Split the two authorities — THIS PROPOSAL.**

## Decision (proposed)

Make the two questions two different rules, because they are two different questions:

| Question | Governed by | Where |
|---|---|---|
| **What may I work on?** (create a case, add/assign a task, the pickers) | **CLIENT/PRODUCT grants (RESTRICT)** — unchanged, fail-closed | `scopedEntityIds` · `assertClientProductInScope` |
| **Whose work may I see?** (lists, details, aggregates, exports) | **Hierarchy** (`SELF` / `DIRECT_TEAM` / `SUBTREE` / `ALL`) | `composeScopePredicate` |

Concretely: the READ predicate stops AND-ing the RESTRICT legs and becomes `(hierarchy OR expand …)`.
Every read surface inherits it through the one shared seam — cases, tasks/Pipeline, KYC queue,
dashboard, MIS, billing, commission, field-monitoring, sync — because they all already route through
`composeScopePredicate`. The write path is untouched: the case-create pickers and `POST /cases`
continue to fail closed on the actor's portfolio, so **a leader can monitor a client they may not
create on**, which is precisely the requirement.

Under C, pradnya keeps `client IN (L&T)` for *creation* but reads her `DIRECT_TEAM` — prajkta's
ADITYA BIRLA cases appear **without granting her the authority to create on ADITYA BIRLA**, and no
grant needs updating when the team's client mix changes.

## Consequences

**This is a WIDENING of read access, and must be reviewed as one.** ADR-0072's standing instruction is
"scope is RBAC — never widen". This ADR deliberately narrows where that rule applies (write) rather
than pretending it is not a change.

- **Unchanged:** BACKEND_USER / KYC_VERIFIER / FIELD_AGENT (`SELF`) — they already only ever see their
  own work; the client cap was never what limited them. SUPER_ADMIN (`ALL`) — unchanged.
- **Widened:** TEAM_LEADER (`DIRECT_TEAM`) and MANAGER (`SUBTREE`) see **their own team's work on
  clients they hold no grant for**. They still cannot see another team's work at all — hierarchy remains
  a hard boundary, and it is the boundary that isolates portfolios today (teams 2 and 3 above are
  isolated by hierarchy, not by the client cap).
- **The decisive question for sign-off:** *is CLIENT scope about what you may **work on**, or about what
  you may **see**?* If a MANAGER must be unable to see a client's data **even when their own team is
  working it** (a hard confidentiality wall between portfolios), then C is wrong and A's maintenance cost
  is the correct price. If the grant means "your portfolio of work", C is right. **The owner decides this;
  the code cannot.**

**Blocking prerequisites — C makes hierarchy the ONLY read boundary, so it must be hardened first.**
The audit found it is currently soft:
1. `roles/repository.ts` **DELETEs and re-inserts all scope wiring on every role edit** — a role can be
   silently unwired. (This is how MANAGER and KYC_VERIFIER lost their rows.)
2. `roles.hierarchy_mode` is **freely editable with no guard**: flipping any role to `ALL` grants instant
   global read, no warning. Today the client cap is a second line of defence against that mistake; under
   C there is none.
3. `scopedEntityIds` and `composeScopePredicate` **disagree on EXPAND-with-zero-grants** (unrestricted vs
   hierarchy-only) — two semantics on one scope object. Must be reconciled before touching this seam.
4. Scope is **fail-OPEN on zero wiring** while hierarchy fails CLOSED to `SELF` — any new role with
   `case.create` gets the whole catalogue until wired. Worth fixing in the same change.

**Testing.** The suites currently encode the *old* defaults as correct — the audit's clearest signal was
that `pnpm verify` stayed green while production's TEAM_LEADER had been RESTRICT for weeks. Any C
implementation must land with tests that fail on revert, per the pattern established by
`src/__tests__/exportGates.api.test.ts` and the mig-0118 regressions.

## Recommendation

**Do not implement yet.** Option A is shipped, verified on production and correct today. C is the
durable answer to the grant-chasing and over-grant costs, but it trades a defence-in-depth layer for
ergonomics and therefore needs the explicit answer to the question above, plus prerequisites 1–4.
Suggested order: harden (1)–(4) first — they are unambiguous defects worth fixing under A regardless —
then revisit C once the hierarchy boundary is trustworthy on its own.
