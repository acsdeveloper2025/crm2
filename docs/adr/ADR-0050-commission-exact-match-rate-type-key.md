# ADR-0050: Two rate types (client vs field) + commission resolution model

> **Later extension:** [ADR-0093](./ADR-0093-multi-location-bulk-and-one-slot-one-type.md) adds multi-location **bulk** entry + the **one-slot-one-type** rule — additive, **no change to this decision** (same schema, same resolution; guard is app-layer on new saves).

- **Status:** **Accepted** — owner-directed 2026-06-19/20 (owner + CTO). **Supersedes the commission
  resolution model of [ADR-0046](./ADR-0046-commission-location-and-tat-dimensions.md)** and the
  interim "exact-match all dimensions / required-at-all-assignments" wording considered mid-design.
  Changes a FROZEN decision — see [LONG_TERM_PROTECTION.md](../governance/LONG_TERM_PROTECTION.md).
- **Date:** 2026-06-20
- **Migrations:** `0083_field_rate_type_rename.sql` (column renames) + `0084_office_field_rate_type.sql`
  (widen `field_rate_type` CHECK to allow `OFFICE`) + `0085_complete_finalize_manager_tl.sql`
  (grant MANAGER + TEAM_LEADER `field_review.complete` + `case.finalize`). All idempotent.

## The core idea: there are TWO independent "rate types", both LOCAL/OGL

Past confusion came from one name (`rate_type` / `distance_band`) meaning two different things. They are
now named distinctly everywhere (DB, SDK, UI):

| | **Client rate type** | **Field(-executive) rate type** |
|---|---|---|
| Column | `rates.client_rate_type` | `commission_rates.field_rate_type` + `case_tasks.field_rate_type` |
| Set by | Rate Management (per client+product+unit+location) | the office, **at assignment** (the executive's trip band) |
| Drives | the **client BILL** | the **executive COMMISSION** |
| Is it a resolver key? | **NO — a display label.** The bill resolves by **location only**. | **YES — an exact resolution key.** |
| Applies to | every task (FIELD + OFFICE), by location | **FIELD tasks only** (a trip band; OFFICE has no trip) |

Rename (mig 0083, Postgres `RENAME COLUMN` auto-updates dependent constraints/indexes):
`rates.rate_type → client_rate_type`, `commission_rates.rate_type → field_rate_type`,
`case_tasks.distance_band → field_rate_type`. SDK: `DISTANCE_BANDS→FIELD_RATE_TYPES`,
`DistanceBand→FieldRateType`, the assign field `distanceBand→fieldRateType`, `CaseTaskView.rateType`
(client, display) `→ clientRateType`, `CommissionRate.rateType→fieldRateType`, `Rate.rateType→clientRateType`.

## Decision

### 1. Client BILL (Rate Management / `RATE_LATERAL`) — unchanged model, made deterministic
Resolves by **location** (task.area > task.pincode > case.area > case.pincode > location-less default)
for client+product+verification_unit, temporal + active. `client_rate_type` is **selected for display
only — NOT a WHERE/ORDER key**: the client bill does not vary by rate type at the same location (a far
pincode *is* OGL → one rate per location). Added a final `r.id DESC` tie-break for determinism
(audit fix; previously two same-location rows differing only by rate type picked arbitrarily). The
case-detail TASK_VIEW client-rate subquery mirrors this exactly (same ladder + tie-break).

### 2. Executive COMMISSION (Commission Management / `COMMISSION_LATERAL`) — tariff line, most-specific wins
A commission row (`CreateCommissionRateSchema`):
- **Required-specific:** `userId`, `locationId` (a `locations` area id), `fieldRateType` (`LOCAL | OGL`).
- **Universal-able** (optional ⇒ NULL ⇒ matches any): `clientId`, `productId`, `verificationUnitId`, `tatBand`.
- `amount` required; `effectiveFrom` optional.

Resolution: `user` + `field_rate_type = ct.field_rate_type` (exact, re-coupled) + `location_id IN
(task/case area,pincode)` (exact, **no location-less default**) + `(col IS NULL OR col = task.col)` for
client/product/unit/tat_band. **Most-specific row wins**, priority **Client > Product > Unit > TAT band**
(`DESC NULLS LAST` per dim — a specific value beats Universal), then location granularity, then `id DESC`.
LOCAL and OGL can therefore price differently for the same context. Frozen at SUBMIT via
`stampCommissionSnapshot` (ADR-0047), first-stamp-wins (`commission_amount IS NULL`).

### 3. `fieldRateType` required at **FIELD** assignment only (OFFICE exempt)
`AssignTaskSchema`/`ReassignTaskSchema`/`BulkAssignSchema`/`AddTasksSchema` require `fieldRateType` when
`visitType = 'FIELD'` (else the field task earns no commission). **OFFICE assignments do NOT require it**
— a desk task has no trip band. (This supersedes the briefly-considered "required for all assignments".)

### 4. OFFICE / desk (incl. KYC document) tasks
- **No visit address** — the Add-Tasks form hides Address for OFFICE; `AddTasksSchema.address` is now
  optional (`required unless visitType='OFFICE'`). No LOCAL/OGL picker for OFFICE.
- **Bill:** same as any task — by location (configure a location-less/case rate; it resolves).
- **Commission — FLAT office rate.** A `visit_type='OFFICE'` task **auto-stamps `field_rate_type='OFFICE'`**
  at assign (server-side; office doesn't pick LOCAL/OGL). Office commission rows key on
  `user + field_rate_type='OFFICE'` + (Universal client/product/unit/tat) + **optional location** → a flat
  rate (e.g. "PAN = ₹20"). `COMMISSION_LATERAL` admits a location-less office row
  (`OR (ct.field_rate_type='OFFICE' AND cmr.location_id IS NULL)`). Field rows (LOCAL/OGL + required
  location) are untouched. `COMMISSION_RATE_TYPES = [LOCAL, OGL, OFFICE]` (vs `FIELD_RATE_TYPES = [LOCAL, OGL]`).
- **Two-actor desk flow (owner 2026-06-20).** OFFICE/KYC tasks are a *relay*, not a self-contained
  verification:
  1. **Office executive (`KYC_VERIFIER`, the OFFICE assignment pool — unchanged from 0039).** Downloads
     the assigned task to Excel, emails it to the authorised external source, receives the verification
     response, and forwards it back to the assigner (email / WhatsApp / any medium). This role **never
     completes the task** — by design it stays read-only on completion (`case.view` + dashboard only).
  2. **Closer (`BACKEND_USER`, + `MANAGER`/`TEAM_LEADER` per `0085`, + `SUPER_ADMIN`).** Writes the
     report and **closes** the task via the office complete/finalize endpoint. Completion is gated by
     `field_review.complete` **+ scope, NOT assignee-ownership**, so the closer completes a task that is
     assigned to the office exec without reassignment. The OFFICE pool is therefore **left as
     `KYC_VERIFIER`** (the earlier repoint to `BACKEND_USER` was reverted — it would have stopped routing
     office tasks to the executives who run the email loop, and shifted the dashboard office queue).
- KYC document units are `verification_units.kind='KYC_DOCUMENT'` (the unified catalog, 9 field ∪ 59
  KYC). They appear in task creation only when **CPV-mapped** to the client+product (not a code filter).

### 5. Read-model consistency (audit fixes)
- Pipeline (`tasks/repository.ts`) now reads `COALESCE(ct.commission_amount, com.commission_amount)` —
  the same frozen-preferred value as billing + MIS (was live-only).

## Consequences / Open items
- **₹0-on-missing-config (commission):** a task whose dims don't match an active row earns nothing,
  silently. Mitigation: surface a "0/unresolved" indicator on Billing & Commission (TODO).
- **Two-column rate preview (built):** task creation shows the CLIENT rate type (Rate Mgmt) + FIELD rate
  type(s) (Commission Mgmt) mapped to the chosen pincode/area — `GET /api/v2/cases/rate-preview`.
- **RESOLVED — office commission:** flat office rate via the `OFFICE` field-rate-type (§4 above).
- **RESOLVED — office worker (owner 2026-06-20):** a two-actor relay — office tasks are *assigned to*
  the office executive (`KYC_VERIFIER`, the unchanged OFFICE pool) who runs the external email loop, and
  *closed by* `BACKEND_USER` / `MANAGER` / `TEAM_LEADER` / `SUPER_ADMIN` (mig `0085` grants the
  supervisors). The OFFICE pool was kept as `KYC_VERIFIER` (the 0084 repoint to `BACKEND_USER` was
  reverted). See §4.

## Alternatives considered
- **Keep ADR-0046 (rate_type a decorative label, location-only commission):** rejected — can't price LOCAL≠OGL.
- **Exact-match all dimensions / required at all assignments:** considered, then narrowed — client/product/
  unit/tat are Universal-able, and `fieldRateType` is required for FIELD only (OFFICE has no trip).
- **Make client_rate_type a billing resolver key (symmetric):** rejected by owner — client bill stays
  location-based; client rate type remains a label.
- **Repoint OFFICE pool `KYC_VERIFIER → BACKEND_USER` (drafted in mig 0084):** rejected — office work is a
  two-actor relay (§4). The executive who runs the email loop *is* the assignee; repointing would stop
  routing office tasks to them, orphan `KYC_VERIFIER`, and shift the dashboard office queue. Instead the
  pool stays `KYC_VERIFIER` and the closer (`BACKEND_USER`/`MANAGER`/`TEAM_LEADER`) completes by
  permission + scope.
