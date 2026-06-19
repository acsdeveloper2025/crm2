# ADR-0049: MIS generation & export engine (pure-MIS page)

- **Status:** Accepted
- **Date:** 2026-06-19
- **Realizes:** ADR-0037 (mis-layout-engine) **generation slice**; ADR-0015 (config-driven per-CPV reporting) MIS side.
- **Builds on:** ADR-0036/0046/0048 (rate + commission laterals), ADR-0010 (reporting strategy), ADR-0022 (role_permissions runtime model).
- **Audit:** `docs/engineering/MIS_CROSS_AUDIT_2026-06-19.md`. **Spec:** `docs/specs/2026-06-19-mis-page-design.md`.

## Context

The MIS *config* layer shipped (ADR-0037: `report_layouts`/`report_layout_columns`, kinds incl. `MIS`, the bindable `source_type`/`source_ref` catalog). The **generation/export** half was never built: nothing turns an active `MIS` layout into rows or a downloadable report. The owner (2026-06-19) scoped a **pure MIS** page — case-task rows with all configured details **+ the commission rate**, exportable — explicitly **no billing/invoice/GST** (the shipped `/billing` page stays; the MIS page is additive). Money columns are field-executive comp data and must be gated (closes compliance G-4).

Two existing constraints collide on the read-model:
- **ADR-0010** prefers reporting reads via `v_`/`mv_` view repositories ("never inline SQL") to avoid SQL sprawl in app code.
- The **amount SQL** (`platform/billing/laterals.ts`) is a shared TS constant that **must not be forked** (no-fork rule; CLAUDE.md "raw SQL only in repositories + migrations"; the FALSE>NULL location-rank bug history, G-8, proves forking laterals is dangerous).

A static `v_mis_rows` view cannot express a **per-layout dynamic** column projection, and embedding the laterals into a view migration would **fork** the amount SQL.

## Decision

1. **The MIS read-model is a repository read-model**, structurally a sibling of the shipped `billing`/pipeline task-grain read-models: same FROM (`case_tasks ct ⨝ cases cs ⨝ clients ⨝ products …`), **reusing `RATE_LATERAL`/`COMMISSION_LATERAL`/`COMPLETED_BAND` verbatim** and the same scope predicate — **not** a hand-rolled `v_` view. This is a narrow, documented position within ADR-0010: SQL still lives **only in the repository layer** (ADR-0010's actual intent — no SQL in controllers/app code), reuses shared constants, and is scope-enforced. The `billing`/pipeline task-grain money read-models are already repositories, not views — accepted precedent. *(If a future heavy-aggregate MIS is needed, it gets an `mv_` per ADR-0010; this decision covers only the live, per-layout-projected operational read.)*

2. **A closed source resolver** maps each layout column's `source_type`/`source_ref` to a SQL fragment. The SELECT vocabulary is **code-owned**, never the stored config string:
   - **FIXED** (`TASK_FIELD`/`CASE_FIELD`/`APPLICANT_FIELD`) → `source_ref` is a lookup key into a static `Record<key, sqlFragment>`; unknown key → `NULL`/`''`.
   - **REFLESS** (`RATE_AMOUNT`/`COMMISSION_AMOUNT`/`TAT`) → the laterals / `COMPLETED_BAND`.
   - **FREE** (`DATA_ENTRY_FIELD`/`FORM_DATA_PATH`/`DOC_TYPE_COUNT`) → `source_ref` is **bound as a query parameter** (jsonb `->>`/`#>>` operand, or `= $n` filter), never interpolated; shape-validated.
   - **`COMPUTED`** → resolves to `''` in v1 (**no expression compilation, no `eval`, no free SQL**). A future closed named-computed registry may extend this.

3. **Per-column money gating, server-side, at generation AND export.** `canViewBilling = grantsAll || perms.includes('billing.view')`; when false, `RATE_AMOUNT`/`COMMISSION_AMOUNT` columns are dropped from the resolved set, the SQL, and the `ExportColumn[]` manifest, and the laterals are omitted. **Closes G-4.**

4. **New permission `page.mis`** (group Operations) gates the MIS routes + nav (FE nav gate ≡ BE route gate). Seeded into `role_permissions` for the desk roles (MANAGER, TEAM_LEADER, BACKEND_USER; SUPER_ADMIN via grants_all) via migration `0081`. A non-`billing.view` holder of `page.mis` (e.g. TEAM_LEADER) gets the MIS **without** money columns — not a 403.

5. **Export only through `platform/export`** (`ExportColumn[]` factory built dynamically from the money-filtered layout columns), with `assertExportable` row caps + the export-audit line (`resource:'mis'`). The XLSX path is hardened to neutralize formula-leading cells (**closes G-9**) — a platform-wide fix.

## Consequences

**Positive:** reuses the proven billing read-model + export engine (no new amount SQL, no fork); the config layer already exists, so the build is generation + a page; G-4 + G-9 close; the engine is format-agnostic (any bank's column list is a layout, no code change).

**Negative:** a second pattern for "reporting reads" now coexists (ADR-0010 `v_`/`mv_` views *and* the billing/MIS repository read-model) — this ADR documents the boundary (heavy aggregates → `mv_`; live per-layout operational projection → repository). The resolver is a new code-owned grammar that must be kept in lockstep with the SDK source catalog.

## Alternatives Considered

- **`v_mis_rows` view (strict ADR-0010).** Rejected: a fixed view can't project per-layout columns, and embedding the laterals forks the amount SQL. A hybrid (view for fixed denorm cols + repository re-join for laterals/FREE refs) was considered and rejected as more complex than the billing-sibling repository for no correctness gain.
- **Fixed comprehensive column set (no config).** Rejected by the owner — columns are config-driven per (client, product).
- **`COMPUTED` as an admin-authored SQL/JS expression.** Rejected — RCE/SQLi sink; resolves to `''` in v1.
- **Reuse `case.view` for the page instead of a new perm.** Rejected — the MIS is a distinct office surface; a dedicated `page.mis` keeps the nav gate ≡ route gate and lets it be granted/revoked independently.

## Related ADRs
ADR-0037 (mis-layout-engine) · ADR-0015 (config-driven reporting) · ADR-0036/0046/0048 (rate/commission laterals) · ADR-0010 (reporting strategy) · ADR-0022 (role_permissions runtime).
