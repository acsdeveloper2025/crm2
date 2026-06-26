# ADR-0070 — Retire `verification_units.kind`; field/office is the task's visit type

- **Status:** Accepted · **Owner-directed** (2026-06-26)
- **Amends:** ADR-0001 / ADR-0002 (the unified verification-unit registry — drops the `kind` discriminator;
  `worker_role` becomes the sole unit classifier). Updates FROZEN_DECISIONS_REGISTRY #9.
- **Retires:** the `kind`↔`visitType` binding from **ADR-0062** (Decision 1 / finding A2026-0623-05).
- **Migration:** `0097` (drop column + re-key the two profile CHECKs onto `worker_role`).

## Context

`verification_units.kind` (`FIELD_VISIT` | `KYC_DOCUMENT` | `DESK_DOCUMENT`) was the unit's discriminator.
But for every row that exists, `kind` is **1:1 with `worker_role`** (the DB CHECK in migration 0001 pins
`FIELD_VISIT⟺FIELD_AGENT`, `KYC_DOCUMENT⟺KYC_VERIFIER`), and `DESK_DOCUMENT` is **dead** (no seed, no UI
path, no row ever created). So `kind` carried no information `worker_role` doesn't already carry.

ADR-0062 (A2026-0623-05) had bound a task's operator-chosen `visitType` to the unit's `kind` — a FIELD_VISIT
unit could only be a FIELD task, a KYC unit only OFFICE. Owner review (2026-06-26): **that binding is wrong.**
**Field and office are just where a task is worked — the operator's choice of which pool handles it** (FIELD →
field agents, OFFICE → KYC verifiers, via `assignment_pool_roles`). Nothing about that should depend on the
verification unit. `kind` is redundant and the binding is an unwanted constraint.

## Decision

1. **Drop `verification_units.kind`** (migration 0097). The two cross-field profile invariants
   (`chk_vu_field_visit`, `chk_vu_kyc_document`) re-key from `kind` to the **existing `worker_role`** column —
   the profile checks are byte-identical, only the antecedent changes. `worker_role` (`FIELD_AGENT` |
   `KYC_VERIFIER`) is now the unit's **sole** classifier: it drives the unit's profile (photos / GPS / form /
   billing / report-template / reverification) and is the source for the assignee pool roles.

2. **A task's `visitType` (FIELD/OFFICE) is the operator's free per-task choice** and is **no longer bound to
   the unit.** Create / single-assign / bulk-assign no longer reject a "mismatch"; `visitTypeForKind` is
   deleted. The assignee list is still gated by the chosen `visitType`'s pool (`assignment_pool_roles`) ∩ the
   actor's hierarchy ∩ (FIELD) the task's territory — so this widens routing freedom, **not** who may be
   assigned. Task-facing surfaces (Pipeline list/export, the case-detail Field-Report card) read the task's
   `visitType`, not the unit's classification.

3. **Rate management uses field/office, not the unit's kind.** A rate's field/office is its **rate type**:
   FIELD ⇒ a LOCAL/OGL rate type with a location (pincode/area) **or Universal** (null location — the existing
   `rates_no_overlap` `COALESCE(location_id,-1)` key already supports it, no migration); OFFICE ⇒ flat (no
   location, no rate type). The unit dropdown is no longer filtered by kind — any unit may have a field and/or
   office rate.

4. **`DESK_DOCUMENT` is removed** with `kind` (it was dead; `worker_role` has two values).

## Consequences

- **Mis-routing guard (A2026-0623-05) is intentionally reverted** per the owner: a unit no longer constrains a
  task's visit type. The KYC document-evidence requirement (A2026-0623-16) and APF outcome fix (A2026-0623-07)
  from ADR-0062 are **unaffected** — they key on `worker_role` / unit code, not `kind`.
- **Re-run safety is free:** the tracked migration runner (ADR-pending, shipped `b96a418`) applies 0097 once;
  the earlier `kind`-referencing migrations (0001, 0086) never re-run, so no guarding was needed.
  `migrations.rerun.test.ts` now drives `db/v2/migrate.sh` 3× and asserts `kind` is gone.
- **Mobile:** the `/api/v2` sync contract never exposed `kind` (units sync as `{id,name,code}`), so the device
  is unaffected.
- **Frozen-area:** FROZEN_DECISIONS_REGISTRY #9 (ADR-0001/0002) is amended; `worker_role` is the catalog's
  discriminator going forward. Re-introducing a third unit class would be a new ADR + a `worker_role` value.
