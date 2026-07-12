# ADR-0068: Rate-type FK conversion (Phase C)

> **Later extension:** [ADR-0093](./ADR-0093-multi-location-bulk-and-one-slot-one-type.md) adds multi-location **bulk** entry + the **one-slot-one-type** rule — additive, **no change to this decision** (same schema, same resolution; guard is app-layer on new saves).

- **Status:** Accepted
- **Date:** 2026-06-25

## Context

ADR-0064 set the phased plan to make `rate_types` the FK source of truth (A: catalog — shipped; B:
assignment — shipped; C: FK conversion). Today three independent, un-FK'd columns carry rate-type values:
`rates.client_rate_type` (free-text `varchar(60)`), `commission_rates.field_rate_type` (`varchar`,
LOCAL/OGL/OFFICE), `case_tasks.field_rate_type` (`varchar(10)`, CHECK-constrained). ADR-0050's resolution
model (client bill by location; commission by rate-type key + location + Universal dims) is to be
**preserved** — only the value *source* becomes a FK.

A migration re-run audit (the 0037/0083 trap class) surfaced a **latent prod data-integrity bug** that
Phase C must close: `0013_rate_management_flatten.sql` re-executes on every deploy and (line 41)
*unconditionally* `DROP COLUMN rate_type_id` on `rates` and (line 49) *unconditionally*
`DROP TABLE rate_types CASCADE`. Since Phase A promoted `rate_types` to a managed catalog and Phase B added
`rate_type_assignments` (FK → `rate_types`), every deploy currently drops+recreates the catalog (resetting
IDENTITY ids, wiping admin edits) and CASCADE-wipes the assignment table. It is latent only because prod
has no persisted catalog edits/assignments yet — but Phase C's FK would make it **fatal** (FK ids dangle /
reset every deploy).

## Decision

We will, in **migration 0094 (one transaction)**: auto-promote any orphan free-text `client_rate_type`
into the catalog; add `rate_type_id integer REFERENCES rate_types(id)` (nullable) to `rates`,
`commission_rates`, `case_tasks`; backfill by `UPPER(old) = rate_types.code` (null old → null id; KYC
legitimately null); swap the `rates_no_overlap` and `commission_rates_no_overlap` EXCLUDE terms from the
string column to `COALESCE(rate_type_id, -1)`; drop `chk_case_task_field_rate_type` (the FK supersedes the
enum CHECK); and **drop the three old string columns in the same migration** (no transition / no
dual-write — owner 2026-06-25). `task_assignment_history.field_rate_type` stays a varchar (append-only
audit, not in the conversion set).

We will make the conversion **re-run-safe** by guarding the earlier migrations that re-execute: `0011`
(case_tasks `distance_band`), `0013` (the `client_rate_type` resurrection block **and** the unconditional
`rate_type_id` drop **and** the `DROP TABLE rate_types CASCADE` — guarded on `rate_types.category`, the
managed-catalog marker, closing the latent bug above), `0079` (commission `rate_type` block), `0084`
(case_tasks CHECK re-add). `apps/api/src/platform/__tests__/migrations.rerun.test.ts` (3× full apply)
proves: the old columns are gone, `rate_type_id` + the FK constraints + the EXCLUDEs survive, and the
catalog ids + `rate_type_assignments` are stable across deploys.

**Resolution is byte-identical.** Billing's `RATE_LATERAL` (and the mirrored case-detail subquery) projects
`rt.code AS client_rate_type` via a `LEFT JOIN rate_types` (location ladder + `id DESC` tie-break
unchanged; LEFT JOIN preserves KYC null-rate rows). Commission's `COMMISSION_LATERAL` matches
`cmr.rate_type_id = ct.rate_type_id` (id = id ⟺ code = code for a 1:1 FK), with the OFFICE location-less
branch keyed on the OFFICE catalog id. The task rate-type stays ADR-0056-derived (now stored as the id).

**Contracts are unchanged.** `Rate.clientRateType`, `CommissionRate.fieldRateType`,
`CaseTaskView.clientRateType`/`.fieldRateType` keep being emitted as string codes (now JOINed from the
catalog), so SDK, web, and the mobile sync contract (which never exposed these columns) are unaffected. The
Commission picker is rewired to all active catalog rows (retiring the hardcoded `COMMISSION_RATE_TYPES`);
Rate Management's picker becomes assignment-gated via Phase B's `/rate-types/available`.

## Consequences

### Positive
- `rate_types` is the single FK source of truth across billing + commission + tasks.
- Closes the latent `0013` catalog-wipe / id-reset / assignment-cascade-wipe bug (a prod data-integrity fix).
- Referential integrity (FK) replaces the free-text label and the enum CHECK.

### Negative
- The in-place column DROP is irreversible on deploy; the load-bearing risk is the re-run guards (mitigated
  by the 3× `migrations.rerun.test.ts` arbiter + a manual scratch-DB triple-apply before push).
- Resolution SQL (the two money LATERALs + the derive) is rewritten — covered by the billing/commission
  integration suites (must stay byte-identical) + a browser-verified round-trip.

## Alternatives Considered
- **Dual-write / keep the string columns through a transition** — rejected by the owner (2026-06-25): drop
  in the same migration, no transition.
- **A separate column name to dodge 0013's `rate_type_id` churn** — rejected; the spec mandates
  `rate_type_id`, and guarding 0013 (which we must do anyway for the catalog drop) covers it.
- **Convert `task_assignment_history` too** — rejected; it is an append-only audit of the code at
  assignment time, not a resolution input.

## Related ADRs
- ADR-0064 (rate-type management parent) · ADR-0067 (assignment layer, Phase B) — this is Phase C.
- ADR-0050 / ADR-0056 — the preserved resolution + the task rate-type derivation.
