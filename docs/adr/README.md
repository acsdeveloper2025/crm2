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
| [ADR-0037](./ADR-0037-mis-layout-engine.md) | MIS Layout Engine — per-(client,product) config | Superseded → ADR-0083 | 2026-06-16 |
| [ADR-0038](./ADR-0038-template-report-engine.md) | Auto Template-Report Engine (FIELD_REPORT + CASE_REPORT) | Proposed | 2026-06-16 |
| [ADR-0039](./ADR-0039-field-report-engine.md) | FIELD_REPORT Engine (template-report slice 1) | Accepted | 2026-06-16 |
| [ADR-0040](./ADR-0040-field-photo-reverse-geocode.md) | Field-photo reverse-geocode (frozen address, async, DLQ) | Accepted | 2026-06-17 |
| [ADR-0041](./ADR-0041-case-report-engine.md) | CASE_REPORT Engine — multi-format client report (PDF / Word / Excel) | Proposed | 2026-06-17 |
| [ADR-0042](./ADR-0042-dependency-stack-freeze.md) | Dependency stack freeze — latest majors, lockfile-enforced | Accepted | 2026-06-17 |
| [ADR-0043](./ADR-0043-login-policy-acceptance.md) | Login policy acceptance — admin-managed, versioned, server-driven gate | Accepted | 2026-06-17 |
| [ADR-0044](./ADR-0044-task-tat-priority.md) | Task TAT (turnaround-time) SLA — target TAT + completed-in band | Accepted | 2026-06-18 |
| [ADR-0045](./ADR-0045-web-session-lifecycle.md) | Web session lifecycle — idle auto-logout + 12h absolute cap + FIELD_AGENT carve-out | Accepted | 2026-06-18 |
| [ADR-0046](./ADR-0046-commission-location-and-tat-dimensions.md) | Field-executive commission — location + client/product/VU + TAT-band dimensions (decoupled from client rate) | Accepted | 2026-06-18 |
| [ADR-0047](./ADR-0047-two-stage-task-completion.md) | Two-stage task completion — SUBMITTED (field) then COMPLETED (office) | Accepted | 2026-06-19 |
| [ADR-0048](./ADR-0048-rate-location-rank-fix.md) | Client-rate location ranking — the location-less default must outrank a non-matching override | Accepted | 2026-06-19 |
| [ADR-0049](./ADR-0049-mis-generation-engine.md) | MIS generation & export engine (pure-MIS page) | Superseded → ADR-0083 | 2026-06-19 |
| [ADR-0050](./ADR-0050-commission-exact-match-rate-type-key.md) | Two rate types (client vs field) + commission resolution model (supersedes ADR-0046 §commission) | Accepted | 2026-06-20 |
| [ADR-0053](./ADR-0053-multi-applicant-batch-dedupe-and-post-creation-add.md) | Multi-applicant batch dedupe + post-creation applicant add | Accepted | 2026-06-20 |
| [ADR-0054](./ADR-0054-v2-native-mobile-contract.md) | v2-native mobile contract — retire v1 compatibility | Accepted | 2026-06-20 |
| [ADR-0055](./ADR-0055-revoke-before-reassign.md) | Revoke-before-reassign — remove in-place reassign + unassign | Accepted · Shipped 2026-06-22 | 2026-06-21 |
| [ADR-0056](./ADR-0056-field-rate-type-auto-derived-from-executive.md) | Field rate type auto-derived from the executive's commission (supersedes ADR-0050 §3) | Accepted · Shipped 2026-06-22 | 2026-06-21 |
| [ADR-0057](./ADR-0057-field-report-outcome-and-period-canonicalization.md) | FIELD_REPORT renders v2-native device payloads (derive verbose outcome label + recombine split periods at render time; extends ADR-0039) | Accepted · Shipped 2026-06-22 | 2026-06-22 |
| [ADR-0058](./ADR-0058-input-uppercase-store-not-just-display.md) | Auto-uppercase typed input (store, not just display) — supersedes UPPERCASE_DISPLAY_STANDARD | Accepted | 2026-06-22 |
| [ADR-0059](./ADR-0059-case-creation-bulk-import.md) | Case-Creation bulk import (Excel/CSV) — grouped rows (multi-applicant), PENDING by default + optional assign, importer-run dedupe + CPV gate; design finalised from the C1–C5 audit | Proposed | 2026-06-22 |
| [ADR-0060](./ADR-0060-field-photo-gps-overlay-downloads.md) | Field-photo GPS-Map-Camera overlay (server-side Static-Maps proxy) + per-image/zip downloads + the same overlay in the ADR-0041 report; keeps the frozen formatted_address (no migration); adds `archiver` | Accepted · Shipped 2026-06-22 | 2026-06-22 |
| [ADR-0061](./ADR-0061-kyc-scoped-by-assignment-not-territory.md) | KYC verifiers scoped by assignment, not territory — drop the KYC PINCODE/AREA scope wiring (mig 0089) so a desk document-verifier no longer sees case PII by geography (closes A2026-0623-04 KYC half); FIELD_AGENT territory kept (by design, mig 0031) | Accepted · Owner-confirmed 2026-06-24 | 2026-06-24 |
| [ADR-0062](./ADR-0062-verification-routing-and-evidence-integrity.md) | Verification task routing & evidence integrity — unit kind binds visit type (server-enforced at create/assign/bulk, `VISIT_TYPE_UNIT_MISMATCH`); KYC document evidence required at completion (`DOCUMENTS_REQUIRED`); PROPERTY_APF has no top-level NEGATIVE outcome (v1 routing, mig 0090); Field Report card is FIELD-only. Closes A2026-0623-05/16/17/07 | Accepted · Shipped 2026-06-24 | 2026-06-24 |
| [ADR-0063](./ADR-0063-retire-report-templates-module.md) | Retire the Report Templates module — `report_templates` (mig 0008) had zero downstream readers; the render engine was built on `report_layouts` (ADR-0037/0039/0041/0049). Drops the table (mig 0091) + api/SDK/web/perm/e2e; preserves `report_template.manage` (MIS Layout designer anchor) + `REPORT_TEMPLATE_TYPES` (VU enum). Mobile `/api/v2` untouched | Accepted · Owner-confirmed 2026-06-25 | 2026-06-25 |
| [ADR-0064](./ADR-0064-rate-type-management.md) | Rate-type management — promote the orphaned `rate_types` catalog (mig 0014) to the managed FK source of truth, FK-referenced by `rates`/`commission_rates`/`case_tasks` with a per-(client×product×unit) assignment layer; OFFICE becomes a `category='OFFICE'` catalog row; resolution preserved (location billing, key+location+dims commission, no `service_zone_rules`); phased A→B→C (migs 0092/0093/0094). Supersedes ADR-0050 §client-rate-type-label | Accepted | 2026-06-25 |
| [ADR-0065](./ADR-0065-case-create-grant-and-write-scope.md) | Desk roles create cases + case writes are portfolio-scoped — grant `case.create` to BACKEND_USER + TEAM_LEADER (mig 0095); validate the target client/product against the actor's CLIENT/PRODUCT scope on create/add-task/add-applicant/available-units/rate-preview (400 `CLIENT_OUT_OF_SCOPE`/`PRODUCT_OUT_OF_SCOPE`, 404 on out-of-scope case). Extends ADR-0022 to write validation. Closes RBAC/scope audit SR-1..6 | Accepted · Owner-confirmed 2026-06-25 | 2026-06-25 |
| [ADR-0066](./ADR-0066-navbar-active-selection.md) | Global navbar client+product selector — a per-tab (sessionStorage) convenience filter narrowing Cases + Pipeline to a chosen client/product; options are scope-limited and the list query ANDs it with the ADR-0022 scope predicate, so it can only narrow within scope, never widen. Adds an additive `productId` list filter (cases/tasks). Not a security boundary | Accepted · Owner-requested 2026-06-25 | 2026-06-25 |
| [ADR-0067](./ADR-0067-rate-type-assignment.md) | Rate-type per-combination assignment layer (ADR-0064 Phase B) — `rate_type_assignments(client×product×unit→rate_type)`, bulk set-the-set API + `GET /rate-types/available`, matrix admin page; adds `authorizeAny`; resolution preserved (availability only). mig 0093 | Accepted | 2026-06-25 |
| [ADR-0068](./ADR-0068-rate-type-fk-conversion.md) | Rate-type FK conversion (ADR-0064 Phase C) — add `rate_type_id` FK to `rates`/`commission_rates`/`case_tasks` + backfill + drop the 3 old string columns in mig 0094; swap the no-overlap EXCLUDEs + drop the case_tasks CHECK; resolution byte-identical (billing JOIN, commission id-match incl. OFFICE-id branch); contracts keep emitting code strings (mobile/SDK unaffected); re-run guards on 0011/0013/0079/0084 (closes the latent 0013 catalog-wipe). Fully supersedes ADR-0050 §client-rate-type-label | Accepted | 2026-06-25 |
| [ADR-0069](./ADR-0069-rate-type-assignment-universal.md) | Rate-type assignment — Universal product/unit + per-unit table (amends ADR-0067) — `rate_type_assignments.product_id`/`verification_unit_id` become NULLABLE (NULL = Universal, rendered "Universal", matching the live commission model) with `UNIQUE NULLS NOT DISTINCT` (mig 0096); `available` resolves union-with-wildcards; the admin page becomes a v2-styled per-unit table with the rate-type selection inline beside each unit. No money-path change | Accepted | 2026-06-25 |
| [ADR-0080](./ADR-0080-field-report-snapshot-at-submission.md) | Freeze the per-task FIELD_REPORT at submission — `field_reports` snapshot table (mig 0104); `submitForm` upserts the rendered narrative (best-effort), read returns the stored snapshot over live render so later template edits don't mutate a delivered report; `FieldReportView.snapshotAt` additive | Accepted · Shipped 2026-06-30 | 2026-06-30 |
| [ADR-0081](./ADR-0081-commission-summary-periodic-export.md) | Periodic per-field-user commission summary export — a 3rd Billing read-model (`GET /billing/commission-summary` + `/export`, gated `billing.view`) grained per field-user × period bucket (`week`/`fortnight`=twice-monthly H1/H2/`month`/`quarter`), optionally × client × product; same `COALESCE(snapshot,live)×bill_count` amount, anchored on earned-at `COALESCE(submitted_at,completed_at)` (FC-5), IST-calendar buckets. No migration; closes the commission-export audit FC-1/FC-2 within the export-only scope | Accepted (CTO; owner sign-off pending) | 2026-07-01 |
| [ADR-0082](./ADR-0082-same-origin-no-cors-layer.md) | Same-origin deployment, no CORS layer on the API — records that the absence of a `cors` package/allowlist is deliberate (nginx same-origin topology already prevents cross-origin browser calls), not an oversight; documents the Socket.IO handshake as the one place an explicit origin allowlist does apply. Audit-only, no code change (API_SECURITY-04) | Accepted | 2026-07-01 |
| [ADR-0083](./ADR-0083-remove-mis-report-layout-engine.md) | Remove the MIS / report-layout / office data-entry engine (clean slate) — drops `report_layouts`/`report_layout_columns`/`case_data_entries`/`case_pickups` (mig 0108) + perms `page.mis`/`data_entry.manage`/`report_template.manage`; deletes `/mis`, the "MIS Layouts" designer, and office data-entry/pickup; decouples field/case reports onto built-in defaults. Supersedes ADR-0037/0049. Mobile `/api/v2` untouched | Accepted · Owner-confirmed 2026-07-01 | 2026-07-01 |
| [ADR-0084](./ADR-0084-mis-report-model.md) | MIS rebuild — predefined report types + code-owned column allow-list (no SQL grammar/config table); money gated by `billing.view` on every surface; mig 0109 RBAC seed | Accepted | 2026-07-01 |
| [ADR-0085](./ADR-0085-kyc-verifier-export-workflow.md) | KYC-verifier export-only queue — append-only `task_export_events` (DB-enforced no-double-export), unified document fields, `/kyc-queue`; migs 0110/0111 | Accepted | 2026-07-02 |
| [ADR-0086](./ADR-0086-billing-commission-separation.md) | Billing ⟂ Commission split — `/commission-summary` top-level, flat per-line Billing list (`GET /billing/lines`), perm rename via grant-carry; mig 0112 | Accepted | 2026-07-03 |
| [ADR-0087](./ADR-0087-aws-production-hosting.md) | AWS production hosting (ap-south-1: EC2+ALB/ACM+RDS+S3) + two-branch deploys — `main`→staging (old box), `prod`→AWS | Accepted | 2026-07-04 |
| [ADR-0088](./ADR-0088-otp-login-verification.md) | New-device OTP second factor — additive `LoginSchema.otpCode`, trusted-device windows per role, TOTP users exempt; migs 0113/0114 | Accepted | 2026-07-04 |
| [ADR-0089](./ADR-0089-ses-api-mail-transport.md) | `MAIL_TRANSPORT=ses` HTTPS mail transport (staging DC blocks SMTP egress); SES DKIM-verified domain | Accepted | 2026-07-04 |
| [ADR-0090](./ADR-0090-whatsapp-otp-aws-eum.md) | WhatsApp OTP leg via AWS End User Messaging (Social) — third `deliverOtp` channel for all users; mig 0116 `sent_whatsapp` | Accepted | 2026-07-07 |
| [ADR-0091](./ADR-0091-rds-storage-encryption.md) | RDS storage encryption at rest — snapshot→KMS-copy→restore cutover to `crm2-prod-enc` (aws/rds key); distinct from the still-deferred field-level DATABASE-04 | Accepted | 2026-07-07 |
| [ADR-0092](./ADR-0092-client-setup-hub-onboarding-workbook.md) | Client Setup hub (`/admin/client-setup` stepper embedding existing pages) + 5-sheet onboarding workbook import; UX-8 = strict row errors on the workbook surface only, existing endpoints unchanged | Accepted · Owner 2026-07-08 (option b-for-workbook) | 2026-07-08 |

> ADR-0051 (inline-grid editing) and ADR-0052 (button emphasis) are drafted on the parked `design-audit-wip` branch — not yet on `main`; they'll be indexed when that stream ships.
