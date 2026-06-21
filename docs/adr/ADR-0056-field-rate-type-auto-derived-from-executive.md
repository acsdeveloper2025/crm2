# ADR-0056: Field rate type is auto-derived from the executive's commission (not office-picked)

- **Status:** **Accepted · Shipped to prod 2026-06-22** (origin/main `80d95ce`, combined-pushed with ADR-0055; deploy gate green) — owner-directed 2026-06-21 (owner + CTO). **Supersedes [ADR-0050](./ADR-0050-commission-exact-match-rate-type-key.md) §3** (the office picks `fieldRateType` LOCAL/OGL at FIELD assignment). Changes a FROZEN decision — see [LONG_TERM_PROTECTION.md](../governance/LONG_TERM_PROTECTION.md). (ADR-0055 was taken by the concurrent "revoke-before-reassign" work; this is 0056.)
- **Date:** 2026-06-21
- **Migrations:** none (no schema change — `case_tasks.field_rate_type` / `commission_rates.field_rate_type` unchanged; the CHECK from mig 0084 still allows LOCAL/OGL/OFFICE).

## Context — the bug

The task-creation / assign forms exposed a **manual "Field Rate Type" (LOCAL/OGL) dropdown**, and the
rate-type preview (`GET /cases/rate-preview`) resolved the FIELD band **by location only** — it listed
the field rate types *any* executive was priced for at the location, with **no `user_id` filter**, and
rendered *before* an executive was even chosen. Owner (2026-06-21, live repro on `crm.allcheckservices.com`):

> Client rate `HDFC / HL / Residence / 400001 Fort = LOCAL`; commission `Smoke Field Agent / Universal /
> LOCAL / 400001 Fort = ₹50`. The preview shows "Field LOCAL" with **no field executive selected** — "how
> can it show Field LOCAL without field-user selection, the code is wrong". The Field Rate Type must **not**
> be a manual pick; it must come from the **chosen executive's** commission mapping, shown **after** the
> executive is selected.

The field rate type is **a property of the executive's commission tariff**, not an office choice. An
executive is priced LOCAL in their home territory and OGL outside it; for a given `(executive, location)`
the band is whatever commission row that executive holds there.

## Decision

### 1. `field_rate_type` is server-derived from the assignee's commission, at FIELD assignment
At every FIELD assignment (`addTasks` assign-at-create, `assignTask`, `reassignRevokedTask`, `bulkAssign`)
the server **resolves** `case_tasks.field_rate_type` from the assignee's active `commission_rates` at the
task's location **when the client does not supply one** — and the web never does (the picker is gone). An
explicit value is still honored for back-compat (existing API clients / tests), so the field stays optional
in the schemas rather than being removed; in production, where only the web assigns, it is always derived.
The resolver mirrors `COMMISSION_LATERAL`
(ADR-0050 §2) minus the `field_rate_type` equality (we are deriving it) and minus `tat_band` (the band is a
completion-time concern; it does not change the trip type), over the same location set
(`location_id IN (task.area, task.pincode, case.area, case.pincode)`), most-specific wins, `LIMIT 1`. The
derived band therefore always resolves a commission amount downstream (`cmr.field_rate_type = ct.field_rate_type`).

### 2. No commission at the location ⇒ **BLOCK the FIELD assignment** (owner-chosen)
If the resolver returns nothing, the executive has no commission configured at that location and the FIELD
assignment is **rejected** — `400 NO_FIELD_COMMISSION` `{ assigneeId, location }`. This is a hard gate
(owner chose block over "assign at ₹0"): a field executive cannot be dispatched to a location they are not
priced for. In bulk-assign it is a per-row `NO_FIELD_COMMISSION` status (the batch is not aborted). The web
pre-checks via the preview and shows a clear "no commission here" warning; the server is the source of truth.
OFFICE/desk is exempt (no location/trip; see §4).

### 3. The manual "Field Rate Type" picker is removed; the preview is executive-scoped and ordered last
- The LOCAL/OGL `<select>` is deleted from all three assign surfaces (`AddTasksForm`, case-detail
  `AssignForm`, pipeline `BulkAssignAction`).
- `GET /cases/rate-preview` takes an optional `assigneeId`; when present the FIELD side resolves to the
  chosen executive's band(s) (0 or 1) instead of the location-wide union.
- The preview renders **after** the executive is selected: `Rate types at this location: Client <X> ·
  Field <Y>`, where `X` is the client bill label (Rate Management, location-resolved — unchanged) and `Y`
  is the executive's derived band (or a "no commission here" state that blocks the assign).

### 4. OFFICE / desk unchanged
OFFICE tasks still auto-stamp `field_rate_type = 'OFFICE'` server-side (flat desk commission, ADR-0050 §4).
No derivation, no location, no block. The derivation in §1 and the preview in §3 exclude `'OFFICE'` rows.

### 5. Schemas
`AssignTaskSchema`, `AddTasksSchema[]`, `BulkAssignSchema`, `ReassignTaskSchema` keep `fieldRateType`
**optional** but **drop the FIELD-required refine** — the web no longer sends it, so it is derived; an
explicit value is honored. `billCount` stays (load-bearing). SDK `FieldRateType` / `CommissionRateType`
enums are unchanged, only no longer collected on the assign forms. `BulkAssignResult` gains
`noFieldCommissionCount` + the `NO_FIELD_COMMISSION` row status (additive).

### 6. Back-compat escape hatch (consequence of §5)
Because an explicit `fieldRateType` is honored, a non-web API client *could* bypass the block by sending a
band. This is acceptable: (a) the web — the only assign client — never sends one, so the block holds in
production; (b) an explicit band cannot conjure commission (`COMMISSION_LATERAL` still needs a matching
row), so the worst case is a self-inflicted ₹0 task, not a money leak. A future hardening could reject
explicit values, but that would force a large test realignment for no production benefit today.

## Consequences

- **Commission-first dispatch.** You must configure an executive's commission for a location before you can
  FIELD-assign them there. This is the intended guardrail (no silent ₹0 field tasks).
- **No more rate/commission mismatch on assign.** The stamped band always comes from a real commission row.
- **Test contract change.** Every FIELD-assign test now seeds an active commission row for the assignee at
  the task location (or asserts the `NO_FIELD_COMMISSION` block).
- **Client "STANDARD" label** (a free-text legacy value on a `rates.client_rate_type` row, not in the
  managed `rate_types` catalog) is a **data** matter — owner remaps it in Rate Management; out of scope here.

## Alternatives considered
- **Keep ADR-0050 §3 (office picks LOCAL/OGL):** rejected by owner — the band is the executive's property,
  not an operator choice; a manual pick let the office mis-set it and showed a band with no executive chosen.
- **Warn-but-allow (assign at ₹0 when no commission):** rejected by owner in favour of a hard block.
- **Unify the field rate type onto the managed `rate_types` catalog:** dropped — removing the manual picker
  entirely is simpler and is what the owner wants; the Commission admin form's vocabulary is left as-is.
