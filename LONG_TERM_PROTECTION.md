# Long-Term Protection — Frozen Architecture (Part 19)

> **These elements are FROZEN.** Future developers must **NEVER** change any of them without a
> **formal architectural review**: an **ADR superseding the relevant ADR-NNN**, **CTO approval**,
> **and domain-owner sign-off** (see `DOMAIN_OWNERSHIP.md`).
>
> A frozen element is **load-bearing**: large parts of the system assume it holds. Changing one
> silently breaks correctness, money, audit, or security. The supersede-ADR is the only legal path.
>
> Cross-ref: `docs/adr/`, `CTO_RULES.md`, `ACS_CRM_2.0_MASTER_MEMORY.md`.

## Protected elements

| Protected element | Why it's load-bearing | What a change would break | Required process |
|---|---|---|---|
| **Case→Task→Verification Unit model** | The single hierarchy all of cases, assignment, billing, reporting hang off | Rollups, assignment, commission, MIS — everything keyed on this shape | Supersede ADR + CTO + Cases/Tasks/VU owners |
| **RBAC 6-role hierarchy + default-deny scope** | Server-side scope (`userScope`/`dataScope`) is the only access boundary | Data leakage / IDOR across territory & subtree; perm-map breaks | Supersede ADR + CTO + Security/Compliance owner |
| **Append-only hash-chained audit (the audit chain)** | Tamper-evidence + compliance rely on unbroken chain | Audit becomes non-attestable; regulatory + forensic trail void | Supersede ADR + CTO + Security/Compliance owner |
| **Data-access: raw pg + repository pattern (NO Prisma/ORM)** | Whole codebase + perf + triggers assume raw SQL | Migration churn, lost DB triggers, query-shape regressions | Supersede ADR + CTO + Platform owner |
| **Naming conventions (snake-SQL / camel-TS / kebab-routes)** | Codegen, SDK, and review tooling assume the mapping | SDK type drift, route mismatch, silent serialization bugs | Supersede ADR + CTO + Platform owner |
| **`v_` / `mv_` reporting strategy** | All MIS/reporting reads go through views, not app joins | MIS parity (incl. 95-col bank MIS), dashboards, TAT metrics | Supersede ADR + CTO + MIS/Data owner |
| **Two-layer result (immutable FE opinion + append-only backend decision)** | FE assessment and official backend decision are distinct sources of truth | Result coherence; client report vs official outcome diverge | Supersede ADR + CTO + Review/Finalization owner |
| **Reverification = new billable task w/ lineage (never overwrite)** | Billing + history depend on append-only cycles | Lost reverification revenue; destroyed verification history | Supersede ADR + CTO + Tasks + Billing owners |
| **Commission = field-task-only / KYC = invoice-only** | Money rules; KYC explicitly earns no commission | Double-pay or mis-pay agents; KYC billing breaks | Supersede ADR + CTO + Commission + Billing owners |
| **UTC + `timestamptz` everywhere** | All time math, TAT, SLAs assume UTC storage | Off-by-timezone TAT/SLA errors; cross-region drift | Supersede ADR + CTO + Platform owner |
| **Immutable financial / verification / review / assignment history** | Audit + billing + dispute resolution assume no in-place edits | Non-repudiation lost; financial restatement impossible | Supersede ADR + CTO + relevant domain owner(s) |
| **PII / DPDP columns** | Legal compliance (DPDP) classification + handling | Regulatory breach; uncontrolled PII exposure | Supersede ADR + CTO + Security/Compliance owner |
| **API base `/api/v2` + contract stability** | Mobile + web clients pin to the v2 contract | Client breakage across released app versions | Supersede ADR + CTO + Platform owner |
| **Design tokens (NO hardcoded colors)** | Theming + dark mode + brand consistency via tokens | Visual drift, theme breakage, accessibility regressions | Supersede ADR + CTO + Frontend lead |
| **Uppercase = visual-only (never a data value)** | Display casing is presentation; data stores canonical case | String-match contracts (mobile↔backend) silently fail | Supersede ADR + CTO + Frontend lead + Backend lead |

## Process (mandatory for any change above)

1. **Write a new ADR** in `docs/adr/` that **explicitly supersedes** the relevant `ADR-NNN`.
2. Obtain **CTO approval** (per `CTO_RULES.md`).
3. Obtain **domain-owner sign-off** (per `DOMAIN_OWNERSHIP.md`).
4. Only then may code, schema, or contract change. No exceptions, no "small tweaks".

**Absent all three sign-offs, the change is rejected at review and blocks release.**
