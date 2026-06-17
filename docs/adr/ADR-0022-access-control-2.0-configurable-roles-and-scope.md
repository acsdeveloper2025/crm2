# ADR-0022 — Access Control 2.0: configurable roles, permissions, and scope dimensions

- **Status:** Accepted (owner signed off 2026-06-10)
- **Supersedes / amends:** the "6-role code-defined RBAC" freeze (ADR-0007 security baseline, `@crm2/access` `ROLES`/`ROLE_PERMISSIONS`), the Epic E pre-design in `docs/specs/2026-06-10-access-and-scope-milestone-design.md`, and the hardcoded role↔scope-dimension wiring shipped in Epic F slices 2–4 (migrations 0030/0032, territoryAssignments/portfolioAssignments modules). This is a **sanctioned frozen-reopen** (owner-approved 2026-06-10, twice: Epic E approval + the 2026-06-10 configurability directive).
- **Owner decisions captured (2026-06-10):** per-role hierarchy visibility mode = admin setting · per-dimension EXPAND/RESTRICT mode = admin setting · ONE unified milestone (merges Epic E + the scope-configurability redesign; Epic F slices 5–8 build on the NEW model) · day-1 dimension catalog = CLIENT, PRODUCT, PINCODE, AREA, STATE, CITY, VERIFICATION_TYPE.

## Context

The owner's directive: *"roles define permissions, while the admin controls which business entities and scope dimensions can be assigned to users of that role"* — no code change should be needed when a new role or a new assignment policy is introduced.

Today three things are hardcoded to role names (full demolition map in the companion spec §2):
1. The role catalog itself (code arrays in 3 packages, a DB CHECK, test-utils union).
2. The role→permission matrix (`ROLE_PERMISSIONS` constant; read-only matrix endpoint).
3. The scope model: hierarchy visibility (`if role === 'MANAGER' → subtree …`), which dimensions a role can hold (territory = FIELD_AGENT/KYC, portfolio = BACKEND_USER, enforced in code), four dimension-specific assignment tables, and role-name conditionals in `assignableUsers`, the FE user form, and FE gates.

## Decision

**Configuration becomes data; semantics stay code.** Split the model along this line:

| Concern | Owner | Where |
|---|---|---|
| Permission **catalog** (what is checkable) | CODE | `@crm2/access` `PERMISSIONS` — tied to routes; a permission no route checks is meaningless |
| Scope-dimension **catalog + enforcement SQL** (how a dimension filters data) | CODE | `platform/scope` dimension registry — each dimension needs a predicate that knows the schema |
| Role **existence** (incl. custom roles) | DATA (admin) | `roles` table |
| Role → **permissions** mapping | DATA (admin) | `role_permissions` table |
| Role → **hierarchy visibility** (ALL / SUBTREE / DIRECT_TEAM / SELF) | DATA (admin) | `roles.hierarchy_mode` |
| Role → **assignable dimensions** + per-dimension EXPAND/RESTRICT | DATA (admin) | `role_scope_dimensions` table |
| Role → **reporting line** (who a user of this role reports to) | DATA (admin) | `roles.reports_to_role` |
| User → **actual entity assignments** | DATA (admin) | one generic `user_scope_assignments` table |
| Who may **work a verification unit** | DATA (admin) | `verification_units.worker_role` becomes an FK to `roles` (CHECK relaxed) |

Consequences:
- **No role-name string comparison survives anywhere in business logic.** The engine reads role *attributes* (`grants_all`, `hierarchy_mode`, permission set, dimension config), never the code `'MANAGER'`.
- `SUPER_ADMIN` is not special-cased by name: it is the one system role with `grants_all = true` + `hierarchy_mode = 'ALL'`, and its row is fully locked.
- The 6 existing roles become **system rows** (`is_system = true`): delete- and code-locked, config-editable (except SUPER_ADMIN, fully locked). Custom roles are ordinary rows.
- The four Epic-F assignment tables (0030/0032) and the territory/portfolio APIs are **replaced** by the generic model (data migrated; old tables dropped). Greenfield — no production consumers; the FE Access tab and mobile connection do not exist yet.
- Adding a future *dimension* (e.g. BRANCH) = one code change in the dimension registry + a catalog row — after which every role can be wired to it by the admin. Adding a *role* or changing any role's policy = zero code.

## Migration safety

- Day-0 seeds reproduce current behavior **byte-identically**: 6 roles seeded with today's permission sets (parity test asserts equality with the retired `ROLE_PERMISSIONS`), hierarchy modes seeded (SA=ALL, MANAGER=SUBTREE, TEAM_LEADER=DIRECT_TEAM, others=SELF), dimension wiring seeded (FIELD_AGENT/KYC_VERIFIER → PINCODE+AREA EXPAND; BACKEND_USER → CLIENT+PRODUCT EXPAND), existing assignment rows migrated into `user_scope_assignments`.
- `authorize()` cutover happens behind a single chokepoint with a 6-role parity test; short-TTL cache + invalidate-on-edit.
- Fail-closed invariants preserved: empty allowed-set ⇒ no rows, never "all"; out-of-scope detail ⇒ 404; default-deny.

## Alternatives considered

- **Admin-definable dimensions at runtime** (no code for new dimensions): rejected — a dimension's enforcement requires SQL that knows how cases/tasks relate to the entity; generating that from config is an injection-prone rules engine. The registry keeps new dimensions a one-time, reviewed code change.
- **Per-user permission overrides**: rejected (unchanged from the milestone design; v1 has none either).
- **Keep per-dimension assignment tables** (FK integrity per table): rejected — table-per-dimension is exactly the hardcoding being removed; v2 catalogs deactivate rather than hard-DELETE, so service-level reference validation + no dangling-ref exposure is sufficient.

## Sign-off

- CTO: approved (this session). Owner: ✅ approved 2026-06-10.
