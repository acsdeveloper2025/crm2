# ADR-0061 — KYC verifiers are scoped by assignment, not territory

**Status:** Accepted · **Owner-confirmed** (2026-06-24) · **Extends/refines:** ADR-0022 (data scope —
role↔dimension wiring), ADR-0024 (field/office assignment pools). **Migration:** `0089` (removes the
`KYC_VERIFIER` PINCODE/AREA `role_scope_dimensions` rows). **Closes:** registry A2026-0623-04 (KYC half).

## Context

ADR-0022 scopes each operational role by the dimension that matches its job, layered on top of the
hierarchy leg (created-by OR a task assigned to an in-scope user):

| Role | Verifies | Natural scope dimension |
| --- | --- | --- |
| FIELD_AGENT | the **address** (physical visit) | **PINCODE / AREA** (territory) |
| BACKEND_USER | client work (desk) | **CLIENT / PRODUCT** (portfolio) |
| KYC_VERIFIER | **documents** (desk) | — |

Migration `0031` deliberately added `cases.pincode_id`/`area_id` so a FIELD_AGENT "sees cases in their
assigned pincodes/areas even when unassigned" — territory visibility is intended for address
verification (work discovery in one's area). The original scope seed (`0034`) wired **both** FIELD_AGENT
and KYC_VERIFIER to PINCODE/AREA EXPAND.

But a KYC_VERIFIER verifies **documents** at a desk, and KYC tasks are dispatched through the **OFFICE
pool, which is territory-less** (ADR-0024). A geographic territory never matched the role. Worse, because
the cases case-view predicate ORs the EXPAND territory legs, a KYC verifier assigned a pincode/area could
see **every case in that territory — including cases assigned to other operators — with full applicant
PII** (the KYC half of audit finding A2026-0623-04). The audit's security pass flagged this; the FIELD
half is intended design (kept).

## Decision

We will scope **KYC_VERIFIER by assignment only** — it sees a case only when it created the case or is
assigned a task in it (its SELF hierarchy leg) — and **remove its PINCODE/AREA territory wiring**.

Migration `0089` deletes the two `KYC_VERIFIER` rows from `role_scope_dimensions`. No verification-unit
scope dimension is added: the owner chose "KYC sees only its assigned cases," which the bare SELF
hierarchy leg already delivers. FIELD_AGENT's PINCODE/AREA wiring is **untouched** (territory is the
intended design for address verification).

`resolveScope` intersects a user's assignments with the role's **active** wiring, so any pre-existing KYC
pincode/area `user_scope_assignments` become **inert** automatically — no data cleanup is required. The
scope-assignment service already validates against the wiring, so it now rejects new KYC pincode/area
assignments with `DIMENSION_NOT_ALLOWED_FOR_ROLE` (defense in depth).

## Consequences

### Positive

- Closes the KYC half of A2026-0623-04: a KYC verifier no longer sees other operators' case PII by
  geography. Least-privilege — KYC visibility now equals its actual document-verification assignments.
- No schema churn and no `user_scope_assignments` migration: the inert-by-intersection behavior + the
  API guard make removing the wiring sufficient and self-cleaning.
- The role↔dimension table now reads correctly (territory ⇒ field; portfolio ⇒ backend; assignment ⇒ KYC).

### Negative

- A KYC verifier loses any "available KYC work in a territory" discovery view — but that was never a
  coherent concept for desk document work, and OFFICE dispatch is territory-less, so nothing real is lost.
- Any operational process that (incorrectly) relied on assigning a KYC verifier a pincode now has no
  effect; such assignments must be re-expressed as task assignments.

## Alternatives Considered

- **Give KYC a `VERIFICATION_TYPE` EXPAND scope (see cases containing its KYC units).** Coherent and the
  dimension already exists, but the owner chose strict assignment-only visibility, so the extra dimension
  was unnecessary.
- **AND-gate `assigned_to = self` for all SELF-mode roles on the cases case-view.** Rejected: it would
  also strip BACKEND_USER's intended CLIENT/PRODUCT portfolio visibility and reverse FIELD_AGENT's
  intended territory design (mig 0031). The misfit was specifically KYC's territory wiring.
- **Leave it (WONTFIX).** Rejected: unlike the FIELD half, KYC territory is not intended design — it is a
  seed misconfiguration that exposes cross-operator PII.

## Related ADRs

- **ADR-0022** — data scope (role↔dimension wiring); this refines the KYC wiring.
- **ADR-0024** — field/office assignment pools (OFFICE pool is territory-less, the basis for this change).
