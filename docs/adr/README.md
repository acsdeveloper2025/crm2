# Architecture Decision Records — CRM2

This directory holds the Architecture Decision Records (ADRs) for CRM2.
An ADR captures a single significant architectural decision, the context that
forced it, and its consequences. ADRs are the durable, version-controlled
memory of *why* the system is built the way it is.

The architecture is **FROZEN**. The ADRs below **record decisions that have
already been made and accepted** — they are documentation, not proposals.

## Purpose

- Give every engineer a single, authoritative answer to "why was it done this
  way?" without archaeology through chat logs or commit history.
- Make the cost of changing a frozen decision explicit and deliberate.
- Preserve the alternatives that were evaluated and rejected, so they are not
  re-litigated by accident.

## When an ADR is required

- **Every major / architectural decision** must have an ADR: data model,
  persistence strategy, framework choices, cross-cutting patterns, naming
  standards, design system, reporting strategy, and similar.
- **Changing a frozen decision** does not edit the old ADR. It requires a
  **new ADR that supersedes the old one**, and it requires sign-off from the
  **CTO** plus the relevant **domain owner**. The superseded ADR is marked
  `Superseded` and links forward to its replacement.

Trivial, reversible, or purely local implementation choices do not need an ADR.

## Lifecycle

```
Proposed → Accepted → Superseded | Deprecated
```

- **Proposed** — drafted, under review.
- **Accepted** — agreed and in force.
- **Superseded** — replaced by a later ADR (link to it).
- **Deprecated** — no longer relevant, with no direct replacement.

## Numbering

ADRs are numbered sequentially as `ADR-NNNN` (zero-padded, four digits).
Numbers are never reused. Filenames follow `ADR-NNNN-kebab-slug.md`. Use
[`_template.md`](./_template.md) (MADR-style) for new records.

## Index

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [ADR-0001](./ADR-0001-verification-unit-registry-model.md) | Verification Unit registry model | Accepted | 2026-06-04 |
| [ADR-0002](./ADR-0002-case-task-verification-unit-model.md) | Case → Task → Verification Unit model | Accepted | 2026-06-04 |
| [ADR-0003](./ADR-0003-postgresql-17.md) | PostgreSQL 17 | Accepted | 2026-06-04 |
| [ADR-0004](./ADR-0004-no-prisma-no-orm.md) | No Prisma / no ORM | Accepted | 2026-06-04 |
| [ADR-0005](./ADR-0005-repository-pattern-data-access.md) | Repository pattern + data-access strategy | Accepted | 2026-06-04 |
| [ADR-0006](./ADR-0006-verification-workspace.md) | Verification Workspace | Accepted | 2026-06-04 |
| [ADR-0007](./ADR-0007-naming-standards.md) | Naming standards | Accepted | 2026-06-04 |
| [ADR-0008](./ADR-0008-design-system.md) | Design system | Accepted | 2026-06-04 |
| [ADR-0009](./ADR-0009-feature-flags.md) | Feature flags | Accepted | 2026-06-04 |
| [ADR-0010](./ADR-0010-reporting-strategy.md) | Reporting strategy | Accepted | 2026-06-04 |
| [ADR-0011](./ADR-0011-api-versioning-strategy.md) | API versioning strategy | Accepted | 2026-06-04 |
| [ADR-0012](./ADR-0012-mobile-integration-strategy.md) | Mobile integration strategy | Accepted | 2026-06-04 |
| [ADR-0013](./ADR-0013-governance-engineering-standards.md) | Governance & engineering standards | Accepted | 2026-06-04 |
| [ADR-0014](./ADR-0014-authentication-session-management.md) | Authentication & session management | Accepted | 2026-06-05 |
| [ADR-0015](./ADR-0015-case-workspace-and-per-client-product-reporting.md) | Case Workspace & per-client+product reporting | Accepted | 2026-06-05 |
| [ADR-0016](./ADR-0016-rate-management-resolution-versioning-workspace.md) | Rate Management resolution, versioning & workspace | Superseded → ADR-0018 | 2026-06-05 |
| [ADR-0017](./ADR-0017-effective-from-temporal-usability-gating.md) | Effective-From temporal usability gating | Accepted | 2026-06-05 |
| [ADR-0018](./ADR-0018-rate-management-flat-one-table-model.md) | Rate Management — flat one-table model (supersedes 0016) | Accepted | 2026-06-05 |
| [ADR-0019](./ADR-0019-concurrency-and-editing-standard.md) | Concurrency & editing standard (optimistic concurrency control) | Accepted | 2026-06-05 |
| [ADR-0020](./ADR-0020-correctable-identity-keys-while-unreferenced.md) | Correctable identity keys while unreferenced (amends ADR-0001) | Accepted | 2026-06-06 |
| [ADR-0021](./ADR-0021-object-storage-and-transactional-email.md) | Object storage (S3) and transactional email (SMTP) | Accepted | 2026-06-10 |
| [ADR-0022](./ADR-0022-access-control-2.0-configurable-roles-and-scope.md) | Access Control 2.0 — configurable roles, permissions & scope dimensions | Accepted | 2026-06-10 |
| [ADR-0023](./ADR-0023-case-task-dispatch-fields-and-applicant-targeting.md) | Case/Task dispatch fields + per-task applicant targeting | Proposed | 2026-06-11 |
| [ADR-0024](./ADR-0024-field-office-assignment-pool.md) | Field/Office assignment pool + assign-at-create (retrospective) | Accepted | 2026-06-17 |
| [ADR-0025](./ADR-0025-kyc-desk-verification-and-task-finalize.md) | KYC / desk verification — read-only verifier + generic task-finalize | Accepted | 2026-06-12 |
| [ADR-0026](./ADR-0026-field-monitoring-and-location-ingest.md) | Field Monitoring console + device location ingest | Accepted | 2026-06-12 |
| [ADR-0027](./ADR-0027-realtime-notifications-and-push.md) | Real-time transport, in-app notifications & FCM push | Accepted | 2026-06-12 |
| [ADR-0028](./ADR-0028-server-authoritative-time-and-clock-offset.md) | Server-authoritative time & client clock offset | Accepted | 2026-06-12 |
| [ADR-0029](./ADR-0029-dashboard-read-only-operations-overview.md) | Dashboard — read-only operations overview | Accepted | 2026-06-12 |
| [ADR-0030](./ADR-0030-background-jobs.md) | Background jobs (the >8s / ≥10k worker tier) | Accepted | 2026-06-15 |
| [ADR-0031](./ADR-0031-openapi-surface-and-sdk-drift-gate.md) | OpenAPI surface + SDK-drift gate (validate, don't replace) | Accepted | 2026-06-15 |
| [ADR-0032](./ADR-0032-case-task-lifecycle-and-two-track-completion.md) | Case/Task lifecycle — two-track completion, case-level verdict | Proposed | 2026-06-15 |
| [ADR-0033](./ADR-0033-task-lineage-revisit-and-reassign-after-revoke.md) | Task lineage — REVISIT and REASSIGN-AFTER-REVOKE | Accepted | 2026-06-15 |
| [ADR-0034](./ADR-0034-device-field-photo-upload.md) | Device field-photo upload (multipart + sharp) | Accepted | 2026-06-16 |
| [ADR-0035](./ADR-0035-sync-delta-arrays-and-execution-fields.md) | Sync down-sync delta arrays + per-task execution fields | Accepted | 2026-06-16 |
| [ADR-0036](./ADR-0036-billing-commission-model.md) | Billing & Commission model (per-case, unified) | Accepted (billing) · Superseded → ADR-0046 (commission §1–3) | 2026-06-16 |
| [ADR-0037](./ADR-0037-mis-layout-engine.md) | MIS Layout Engine — per-(client,product) config | Accepted | 2026-06-16 |
| [ADR-0038](./ADR-0038-template-report-engine.md) | Auto Template-Report Engine (FIELD_REPORT + CASE_REPORT) | Proposed | 2026-06-16 |
| [ADR-0039](./ADR-0039-field-report-engine.md) | FIELD_REPORT Engine (template-report slice 1) | Accepted | 2026-06-16 |
| [ADR-0040](./ADR-0040-field-photo-reverse-geocode.md) | Field-photo reverse-geocode (frozen address, async, DLQ) | Accepted | 2026-06-17 |
| [ADR-0041](./ADR-0041-case-report-engine.md) | CASE_REPORT Engine — multi-format client report (PDF / Word / Excel) | Proposed | 2026-06-17 |
| [ADR-0042](./ADR-0042-dependency-stack-freeze.md) | Dependency stack freeze — latest majors, lockfile-enforced | Accepted | 2026-06-17 |
| [ADR-0043](./ADR-0043-login-policy-acceptance.md) | Login policy acceptance — admin-managed, versioned, server-driven gate | Accepted | 2026-06-17 |
| [ADR-0044](./ADR-0044-task-tat-priority.md) | Task TAT (turnaround-time) SLA — target TAT + completed-in band | Accepted | 2026-06-18 |
| [ADR-0045](./ADR-0045-web-session-lifecycle.md) | Web session lifecycle — idle auto-logout + 12h absolute cap + FIELD_AGENT carve-out | Accepted | 2026-06-18 |
| [ADR-0046](./ADR-0046-commission-location-and-tat-dimensions.md) | Field-executive commission — location + client/product/VU + TAT-band dimensions (decoupled from client rate) | Accepted | 2026-06-18 |
