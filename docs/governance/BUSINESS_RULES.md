# CRM2 — Business Rules Registry

**Governing principle:** No business rule may exist only in code. Every operational/business rule MUST be registered in this file with an ID, before or alongside the code that enforces it. Code, DB constraints, and config are *enforcement points* — this registry is the source of truth.

**Scope:** Banking field-verification + KYC CRM. Architecture is FROZEN. Model: `Case → Task → Verification Unit` (KYC = a Verification Unit subtype). Catalog = 9 `FIELD_VISIT` ∪ 59 `KYC_DOCUMENT` = 68 units, CPV-gated.

**Enforcement & process:** see [`docs/CI_CD_STANDARDS.md`](../CI_CD_STANDARDS.md) (CI gates that block merges violating these rules). **Decisions:** each rule cites an `ADR-NNN` in [`docs/adr/`](docs/adr/) (placeholders until ADRs are authored).

Conventions: unit `code` = UPPER_SNAKE; time stored UTC; display uppercase only. Roles: `SUPER_ADMIN`, `MANAGER`, `TEAM_LEADER`, `BACKEND_USER`, `FIELD_AGENT`, `KYC_VERIFIER`. Access is **default-deny**.

---

## Catalog / Verification Units

| ID | Rule | Rationale | Enforced where | ADR |
|----|------|-----------|----------------|-----|
| BR-001 | Catalog holds exactly 2 unit kinds: `FIELD_VISIT` (9) and `KYC_DOCUMENT` (59) = 68 units. | Closed, auditable catalog. | `verification_units.kind` CHECK + seed | ADR-001 |
| BR-002 | Unit `code` is UPPER_SNAKE and immutable once created. | Stable cross-system reference / report keys. | DB CHECK + UNIQUE; no UPDATE path on `code` | ADR-002 |
| BR-003 | Editing a unit bumps `version`; the old version is retained. | Historical reproducibility of tasks. | `verification_units.version` increment on write | ADR-002 |
| BR-004 | A task snapshots `(unit_code, unit_version)` at creation; later unit edits never mutate existing tasks. | Tasks reflect rules as they were when issued. | snapshot columns on `tasks`; repository write | ADR-003 |
| BR-005 | `IDENTITY` and `FINANCIAL` units are `pii_sensitive=true`. | DPDP masking obligation. | `verification_units.pii_sensitive` flag | ADR-010 |

## CPV (Client × Product gating)

| ID | Rule | Rationale | Enforced where | ADR |
|----|------|-----------|----------------|-----|
| BR-006 | A unit is available for a Case only if a `client_product_verification_units` (CPV) row enables it for that client+product. | Per-client/product scoping of offerings. | CPV lookup on task creation | ADR-004 |
| BR-007 | Tasks cannot be created for units not in the case's CPV set. | Prevent off-contract work/billing. | task-create validation; FK to CPV | ADR-004 |

## Cases

| ID | Rule | Rationale | Enforced where | ADR |
|----|------|-----------|----------------|-----|
| BR-008 | A Case belongs to exactly one client+product and aggregates Tasks. | Single billing/ownership boundary. | `cases` FKs | ADR-005 |
| BR-009 | Case status is derived (rolled up) from its Tasks, never set directly to a terminal state. | Status integrity. | rollup service; status CHECK | ADR-005 |

## Tasks

| ID | Rule | Rationale | Enforced where | ADR |
|----|------|-----------|----------------|-----|
| BR-010 | Each Task references one Verification Unit (kind = FIELD_VISIT or KYC_DOCUMENT). | Task == one verifiable unit. | `tasks.unit_code` FK | ADR-003 |
| BR-011 | A `FIELD_VISIT` task requires: ≥5 photos, GPS, a completed form. | Evidentiary standard for field work. | completion gate (BR-026), form schema | ADR-006 |
| BR-012 | A `KYC_DOCUMENT` task requires a document attachment. | KYC needs the source document. | completion gate | ADR-006 |
| BR-013 | Task status transitions follow the allowed state graph; no illegal jumps. | Workflow correctness. | `task_status_transitions` allow-list | ADR-005 |

## Assignment

| ID | Rule | Rationale | Enforced where | ADR |
|----|------|-----------|----------------|-----|
| BR-014 | A Task may only be assigned to a user within the assigner's scope subtree. | Hierarchy/territory containment. | scope validation (`userScope`/`dataScope`) | ADR-007 |
| BR-015 | `FIELD_VISIT` assigns to `FIELD_AGENT`; `KYC_DOCUMENT` work is executed via `BACKEND_USER` with `KYC_VERIFIER` as read-only. | Role-task fit. | assignment role check | ADR-007 |
| BR-016 | Every assignment writes an audit record. | Accountability. | audit on assign | ADR-009 |

## Verification / Review

| ID | Rule | Rationale | Enforced where | ADR |
|----|------|-----------|----------------|-----|
| BR-017 | Result set is exactly: `Positive`, `Negative`, `Refer`, `Fraud`. | Closed outcome vocabulary. | result CHECK | ADR-008 |
| BR-018 | Two-layer result: FE/verifier *opinion* is immutable; backend *final decision* is append-only. The two never overwrite each other. | Separation of field assessment vs official decision. | immutable verifier table + append-only decision table | ADR-008 |
| BR-019 | `TEAM_LEADER` CANNOT finalize (lacks `field_review.complete`). | Segregation of duties. | RBAC permission map (default-deny) | ADR-008 |
| BR-020 | `BACKEND_USER` finalizes a task (records the official result). | Single finalization authority. | RBAC + finalize endpoint | ADR-008 |
| BR-021 | `KYC_VERIFIER` is read-only (view/download); contacts sourced externally, never executes/finalizes. | Read-only verifier model. | RBAC: no verify/start/complete perms | ADR-008 |
| BR-022 | Every review/approval/finalization writes an audit record. | Accountability. | audit on review/finalize | ADR-009 |

## Reverification (Revisit / Recheck)

| ID | Rule | Rationale | Enforced where | ADR |
|----|------|-----------|----------------|-----|
| BR-023 | Reverification creates a NEW billable Task with lineage to its parent; it NEVER overwrites prior history. | Audit-true, separately billable cycles. | new task + `*_of` lineage FK | ADR-006 |
| BR-024 | `FIELD_VISIT` reverification = **revisit**, billed at `REVISIT_PARENT_RATE`. | Field re-attempt pricing. | rate resolver on revisit | ADR-006 |
| BR-025 | `KYC_DOCUMENT` reverification = **recheck**, billed at `RECHECK_FRESH_RATE` (fresh rate). | KYC re-check is a fresh chargeable cycle. | rate resolver on recheck | ADR-006 |

## Billing

| ID | Rule | Rationale | Enforced where | ADR |
|----|------|-----------|----------------|-----|
| BR-026 | `FIELD_VISIT` billing type = `AGENT_COMMISSION`; `KYC_DOCUMENT` billing type = `CLIENT_INVOICE`. | Distinct money flows per unit kind. | unit billing config | ADR-006 |
| BR-027 | Billing only fires on a `COMPLETED` task. | No charge for incomplete work. | billing trigger gated on status | ADR-006 |
| BR-028 | Every billing/invoice event writes an audit record. | Financial accountability. | audit on billing | ADR-009 |

## Commission

| ID | Rule | Rationale | Enforced where | ADR |
|----|------|-----------|----------------|-----|
| BR-029 | Commission is earned per **completed FIELD task only**. KYC earns commission = `NONE` (invoice-only). | Pay agents for field work; KYC is client-billed. | commission engine gated on FIELD_VISIT + COMPLETED | ADR-006 |
| BR-030 | Every commission accrual writes an audit record. | Payout accountability. | audit on commission | ADR-009 |

## Reports

| ID | Rule | Rationale | Enforced where | ADR |
|----|------|-----------|----------------|-----|
| BR-031 | `FIELD_VISIT` produces a `FIELD_NARRATIVE` report; `KYC_DOCUMENT` produces a `KYC_DOCUMENT` report. | Report type matches unit kind. | report-type config per unit | ADR-006 |

## RBAC / Scope

| ID | Rule | Rationale | Enforced where | ADR |
|----|------|-----------|----------------|-----|
| BR-032 | Access is default-deny: no permission unless explicitly granted to the role. | Least privilege. | central RBAC permission map | ADR-007 |
| BR-033 | Data visibility is scope-bound: SUPER_ADMIN=all, MANAGER=recursive subtree, TEAM_LEADER=direct team, BACKEND_USER=self/portfolio, FIELD_AGENT=own territory, KYC_VERIFIER=assigned read-only. | Hierarchical confidentiality. | server-side scope filter (every query) | ADR-007 |

## Audit

| ID | Rule | Rationale | Enforced where | ADR |
|----|------|-----------|----------------|-----|
| BR-034 | Audit records are MANDATORY for: assignment, review, approval, finalization, billing, commission, and master-data changes. | Immutable accountability chain. | audit service at each chokepoint | ADR-009 |
| BR-035 | Audit records are append-only and never edited or deleted. | Tamper-evidence. | no UPDATE/DELETE on audit table | ADR-009 |

## Data Integrity

| ID | Rule | Rationale | Enforced where | ADR |
|----|------|-----------|----------------|-----|
| BR-036 | The minimum-photo gate counts STORED photos (by task), not photos referenced in the request. | Prevent false-pass when uploads are out-of-band. | completion gate counts persisted attachments | ADR-006 |
| BR-037 | All timestamps stored in UTC; uppercasing is display-only and never persisted. | Time/locale correctness. | DB `timestamptz`; UI formatter | ADR-011 |
| BR-038 | History tables (results, reverification lineage, audit) are append-only — superseded rows are added, originals never mutated. | Reconstructable history. | append-only repositories | ADR-008 |

## PII / Compliance

| ID | Rule | Rationale | Enforced where | ADR |
|----|------|-----------|----------------|-----|
| BR-039 | `pii_sensitive` units (IDENTITY/FINANCIAL) are masked per DPDP when displayed/exported to non-authorized roles. | DPDP compliance. | masking layer keyed on `pii_sensitive` + role | ADR-010 |
| BR-040 | PII access (view/download/export of sensitive units) is itself audited. | Regulatory traceability. | audit on PII read | ADR-009, ADR-010 |

---

*To add a rule: assign the next BR-NNN, fill all columns, reference a real enforcement point, and link/author the ADR. CI (see CI_CD_STANDARDS.md) rejects new business logic lacking a registered BR-ID.*
