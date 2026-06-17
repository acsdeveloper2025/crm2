# Domain Ownership Registry (Part 9)

> **Architecture is FROZEN.** Every domain below MUST have a named, accountable owner.
> Owners are accountable for **design integrity, code reviews, and on-call** for their domain.
>
> **Release gate:** An **unowned domain blocks release.** Ownership must be documented here
> and kept current. Owners are **role placeholders** (small team) — fill in real names.
>
> Cross-ref: `CTO_RULES.md`, `LONG_TERM_PROTECTION.md`, `CRM2_MASTER_MEMORY.md`, `docs/adr/`.

## Ownership table

| Domain | Owner (role) | Scope / responsibilities | Key files / modules | Related ADR |
|---|---|---|---|---|
| **Cases** | Backend lead | Case lifecycle, status rollup, case↔task integrity | `apps/api/.../cases/*`, case repository, `v_`/`mv_` case views | ADR-NNN (Case→Task→VU model) |
| **Tasks** | Backend lead | Task lifecycle, transitions, completion finalizer, system-of-record | `.../tasks/*`, task repo, completion/finalizer services | ADR-NNN (Case→Task→VU) |
| **Verification Units (catalog / CPV)** | Backend lead + Data/DB owner | Unit catalog (field ∪ KYC ≈ 68), Client-Product-VU gating, authority | `.../verification-units/*`, CPV tables/views | ADR-NNN (VU model, CPV authority) |
| **Assignment** | Backend lead | Task→executor routing, scope-aware assignment, active-unique guards | `.../assignment/*`, assignment service | ADR-NNN (assignment + scope) |
| **Verification Workspace** | Frontend lead | Two-pane workspace UI, document-centric view, executor actions | `apps/web/.../workspace/*`, `/task-management/:taskId` | ADR-NNN (workspace, route-collapse) |
| **Review / Finalization** | Backend lead | Two-layer result, backend decision (append-only), finalize→COMPLETED | `.../review/*`, `task_backend_reviews`, finalizer | ADR-NNN (two-layer result) |
| **Reports** | Backend lead | Sealed/client report generation, config-driven templates | `.../reports/*`, report service, `report_templates` | ADR-NNN (reporting strategy) |
| **MIS** | Data/DB owner | Operational + bank MIS, 95-col parity, read views/materialized views | `v_*`, `mv_*`, MIS endpoints | ADR-NNN (v_/mv_ reporting) |
| **Billing** | Backend lead | Invoices, billable cycles, GST, KYC=invoice-only, rate→billing link | `.../invoices/*`, `invoice_item_tasks` | ADR-NNN (billing/commission split) |
| **Commission** | Backend lead | Field-task-only commission, gated on COMPLETED, rollups | `.../commission/*`, commission engine | ADR-NNN (commission rules) |
| **RBAC / Access** | Security/Compliance owner | 6-role hierarchy, default-deny scope, perm map, server-side scope | `packages/access/*`, `userScope`/`dataScope` | ADR-NNN (RBAC + scope) |
| **Templates** | Backend lead | Form/report template engine, vtype-aware field mapping | `.../templates/*`, template builders | ADR-NNN (templates) |
| **Field Monitoring** | Backend lead | Field-exec tracking, monitoring endpoints | `.../field-monitoring/*` | ADR-NNN (field monitoring) |
| **Master Data (Clients / Products / Rates / Locations)** | Data/DB owner | Catalogs feeding CPV + billing; referential integrity | `.../master-data/*`, clients/products/rates/locations repos | ADR-NNN (master data) |
| **Platform (db / logger / config / sdk / ui-theme)** | CTO | Raw pg layer, repository pattern, logging, config, shared SDK + design tokens | `packages/{sdk,config,ui-theme}`, `db/*`, logger | ADR-NNN (data-access, tokens) |
| **Infra / DevOps (CI, DR, object store, Valkey)** | CTO | CI/CD gates, DR/backups, object storage, Valkey8, branch protection | `.github/workflows/*`, infra/compose, `scripts/*` | ADR-NNN (infra/DR) |
| **Security / Compliance** | Security/Compliance owner | Audit chain integrity, PII/DPDP, threat review, secrets | audit module, PII columns, security reviews | ADR-NNN (audit + PII/DPDP) |

## Ownership rules

1. **Every domain is owned.** No domain may ship to release without a documented owner in this table.
2. **Accountability spans:** design integrity (reviews + ADR sign-off), code review of changes in-domain, and on-call.
3. **Keep current.** Ownership changes are a PR to this file; stale ownership is a release blocker.
4. **Cross-domain changes** require sign-off from **every** affected owner.
5. **Frozen elements** in a domain (see `LONG_TERM_PROTECTION.md`) require an ADR + CTO + owner sign-off to alter.
