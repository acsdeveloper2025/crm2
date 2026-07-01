# MIS rebuild — design spec (internal operational MIS; task-grain first)

**Date:** 2026-07-01 · **Status:** ACCEPTED — owner-confirmed 2026-07-01 (build started) ·
**ADR:** [ADR-0084](../adr/ADR-0084-mis-report-model.md) (supersedes ADR-0037, ADR-0049) ·
**Migration:** `0109` (RBAC seed only) · **Adversarial review folded in** (2026-07-01, 3 reviewers —
security / architecture / domain; dispositions in [COMPLIANCE_GAPS_REGISTRY §MIS-2026-07-01](../COMPLIANCE_GAPS_REGISTRY.md)).

> Clean-slate rebuild of the "MIS" surface removed on 2026-07-01 ([ADR-0083](../adr/ADR-0083-remove-mis-report-layout-engine.md),
> mig 0108). The old engine died of complexity (one shared `report_layouts` table, five kinds, a
> `source_type → SQL` grammar that was the injection boundary, MIS/Billing-MIS/Data-Entry tangled). **None
> of that is rebuilt.** This v1 is an **internal operational MIS** (see §1 non-goals — it is deliberately
> *not* a bank-format MIS; the bank-mandated identifiers are data-model gaps, §14).

## Owner decisions (2026-07-01)
- Report model = **predefined report types + configurable view** (no SQL grammar, no admin-authored columns).
- **Grain: two report types, task-grain first** — `TASK_OPERATIONAL` (slice 1), then `CASE_OPERATIONAL`
  (slice 5). Never mix grains on one sheet.
- **v1 = internal operational MIS.** LOS/LAN, case-type, CPC/region/zone, sampling TAT, the ~45-col
  doc-count matrix are **data-model gaps** (deferred; §14), not v1 report features.
- **PII: full export accepted.** PAN, mobile, GPS, geocoded address are exportable by `mis.export` holders
  with no extra gate/masking — **formally ACCEPTED, owner-signed**, recorded in the compliance registry
  (§MIS-2026-07-01). Extends the already-deferred DATABASE-04 (PII-at-rest).
- **Read-only.** MIS never changes case/task creation or completion and never touches the mobile contract.
  Absent values render `—`.

---

## 1 — Goals & non-goals
**Goals:** one MIS page answering "state of all verification work" + export; predefined report types with
toggle-able columns / filters / grouping; reuse existing infra; ship `TASK_OPERATIONAL` first.

**Non-goals:** no change to create/complete flows or the mobile contract; no revival of the removed
engine/table/grammar; no matrix/joined formats (defer); no scheduled/emailed reports (defer); no new
dependency; **not a bank-format MIS** (§14 gaps); saved views deferred to a later slice.

---

## 2 — Report model
Flexibility comes from composing **code-owned primitives**, not a query language (the pattern Salesforce/
HubSpot/Zoho/Power BI all use). Building blocks: predefined **report types** (code registry) → per-type
**column allow-list** the user toggles (+ select-all/export-all) → structured **filters** (`field op value`,
value bound) → **grouping + subtotals** (Summary) → **saved views** (later) → **role-scoped rows + export**.

**Report types (v1):** `TASK_OPERATIONAL` (task grain — slice 1), `CASE_OPERATIONAL` (case grain — slice 5).
Later: `TAT_SLA`, `BILLING_COMMISSION`. **Formats:** Tabular + Summary only.

### Web-research basis (cited)
Salesforce Custom Report Types + formats <https://help.salesforce.com/s/articleView?id=xcloud.reports_report_type_setup.htm> ·
<https://trailhead.salesforce.com/content/learn/modules/lex_implementation_reports_dashboards/lex_implementation_reports_dashboards_report_formats> ·
HubSpot custom report builder (field picker, AND/OR, ~30-col cap) <https://knowledge.hubspot.com/reports/create-reports-with-the-custom-report-builder> ·
Zoho Analytics selected-columns + read/export grants <https://www.zoho.com/analytics/help/sharing/> ·
Power BI RLS (server-side filter; export can't bypass) <https://learn.microsoft.com/en-us/power-bi/guidance/rls-guidance> ·
OWASP SQLi Prevention — allow-list identifiers <https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html> ·
LeadSquared RCU (real-time MIS + TAT/SLA + outcome rollups) <https://help.leadsquared.com/risk-containment-unit-set-up-for-admins/>.

---

## 3 — Security & SQL-safety
No config-as-SQL surface: column SQL fragments are hard-coded constants; only the *set of selected keys* varies.

1. Report types, columns, filter fields, operators, sort keys, group keys are **enumerated in code**. The API
   accepts only **keys** into the *selected report type's* registry — never raw SQL/column names/fragments.
2. **Strict key validation, MIS-owned (not the lenient platform).** `resolvePage`/`resolveFilters` silently
   drop unknown fields (`pagination.ts`); MIS must NOT rely on that for its security control. MIS validates
   every `cols` / `sort` / `group` / `f_<key>` against the report-type registry: **unknown / duplicate /
   wrong-type key → 400 (fail-closed).**
3. Filter **values** + LIMIT/OFFSET are **bound parameters**. `ORDER BY` direction is a `'ASC'|'DESC'` switch;
   the sort/group column is a registry-key lookup, never interpolated.
4. **`form_data` access is constant only.** `field_report_narrative` and the agent field-note column use
   **fixed** fragments (hard-coded `->>'key'` per registry column). **No request-supplied jsonb path ever**
   (that walked-segment path was the removed engine's boundary; it is not reintroduced).
5. **Money-gating** (see §6) applies on **every surface** — catalog, rows, summary sums, sort, filter, group,
   export — identically. A `billing.view`-less actor cannot obtain money by any of those channels.
6. **Row-scope:** `composeScopePredicate` is a mandatory `WHERE` on rows, summary, count, and export. Out-of-
   scope ⇒ 0 rows (never 403/IDOR); `totalCount` and summary `count` use the **same** scoped predicate.
7. **Catalog gated:** `GET /report-types` requires `mis.view` (so field-name schema isn't exposed unauthed).
8. Export formula-injection escaping (CWE-1236) is inherited from `platform/export` (`neutralizeFormula`).
9. **PII (owner-accepted):** PAN/mobile/GPS/geocoded-address are exportable to `mis.export` holders with no
   extra gate — ACCEPTED, recorded in the registry. `pii_sensitive` remains an informational column (no
   masking machinery exists; DATABASE-04 stays deferred).

---

## 4 — DB shape & query
- **No new data table for v1.** Report definitions/columns are code. Rows are a **live query** over
  `cases`/`case_tasks` (+ 1:1 joins) resolving money via `RATE_LATERAL`/`COMMISSION_LATERAL` (**reused, not
  forked**). No mv/worker for reads (ADR-0010 `mv_` deferred; revisit on volume).
- **Base predicate = all in-scope work — NOT the billing status filter.** The billing read-model hard-codes
  `status IN ('SUBMITTED','COMPLETED')`; MIS must **not** inherit that (it would hide PENDING/ASSIGNED/
  IN_PROGRESS and defeat the whole "state of all work" purpose). MIS reuses the laterals for money resolution
  only; base = every task/case in scope; status is a **user filter**. Open rows show `—` for money.
- **Conditional join composition (registry-driven).** Only the joins the selected columns need are added,
  de-duplicated. **1-to-many relations are never plain joins** (they multiply rows and double-count money):
  `task_assignment_history` columns are **excluded** from MIS (belong to a task-history view); `photo_count`
  and the case-level task-outcome counts are **correlated subqueries** (kind `subquery`); the applicant shown
  at task grain is the task's single `applicant_id` (1:1) — no co-applicant fan-out.
- **Money = lateral presence.** Without `billing.view` the two `LEFT JOIN LATERAL`s are **omitted from FROM**
  (cheaper + no leak), not merely nulled in SELECT — mirroring `tasks/repository.ts`.
- **Count strategy:** `count(*)` over the 1:1 FROM (task grain) / `count(DISTINCT cs.id)` (case grain);
  scoped identically. Default sort = **`ct.created_at DESC`** (task grain) — backed by an index; add a
  covering migration only if EXPLAIN on the widest default view demands it (verify at build, not assume).
- Mig `0109` seeds `mis.view` + `mis.export` into `role_permissions` (default-deny). Saved views table is a
  later slice.

---

## 5 — API (`/api/v2/mis`, additive; all routes `mis.view`, export also `mis.export`)
- `GET /report-types` → catalog `[{ type, label, columns:[{key,label,dataType,group,money,grain,sortable,filterable,groupable,defaultVisible}], filters, groupableKeys }]`; money columns omitted without `billing.view`.
- `GET /:type/rows?cols=&f_<key>=&sort=&dir=&page=&size=` → `Paginated<Record>` (Tabular).
- `GET /:type/summary?group=<key>&f_<key>=` → grouped `count` + (gated) money sums using billing's exact
  aggregate expressions.
- `GET /:type/export?format=xlsx|csv&cols=&f_<key>=&sort=&dir=` → **sync stream** (`< EXPORT_JOB_THRESHOLD`);
  at `≥10k` returns an honest **413 `EXPORT_TOO_LARGE`** (matches billing/tasks). The ≥10k async job tier is
  **not** built for MVP (only `locations` uses `registerExportBuilder`, and its `ExportBuild` signature
  passes no role/scope — would leak money/scope; BUSINESS_LOGIC-03). A real async slice (with `resolveScope`
  + `billing.view` re-applied inside the builder) is deferred until >10k exports are actually needed.

`@crm2/sdk` gains `mis.ts` (pure-type leaf, zod only) + client methods. `pnpm openapi` regenerated as an
**explicit gated step** in S1b (it is not part of `pnpm verify`, so a stale spec would silently break the FE).

---

## 6 — RBAC, money-gating, scope
- **`mis.view`** (page; distinct from money) seeded for MANAGER/TEAM_LEADER/BACKEND_USER, SA via `grants_all`.
  **`mis.export`** gates export. Both on every route incl. `/report-types`.
- **Money = `billing.view`, on every surface.** The money columns are: task grain — `bill_amount`,
  `commission_amount`, `bill_line_amount (= bill_amount × bill_count)`; case grain — `case_bill_total`,
  `case_commission_total`. Without `billing.view`: laterals dropped from FROM; those keys are **not** in the
  catalog, projection, sort set, filter set, group set, or summary sums. One shared guard
  `assertNoMoneyWithout(perm, resolvedKeys)` used by rows/summary/export; test matrix = money-keys ×
  {rows, summary, export, sort, filter, group}. `selectColumns` builds an **already-money-stripped** manifest
  (never filter a money-inclusive superset — its empty→full fallback would re-add money).
- **Rate-type codes + `bill_count` are NOT money** — visible to all.
- **Row-scope** via `composeScopePredicate` (hierarchy leg `cs.created_by = ANY($scope) OR task assigned in
  scope`) on rows/summary/count/export. Out-of-scope ⇒ 0 rows + `totalCount:0`.
- **PII:** full export accepted (§ owner decisions) — no `mis.pii` gate, no masking.

---

## 7 — Report-type registry (code)
```
type MisColumn = {
  key: string; label: string; group: string;
  dataType: 'TEXT'|'NUMBER'|'DATE'|'SELECT'|'BOOLEAN';
  sql: string;                 // CODE-OWNED fragment (constant; scalar, or a correlated subquery)
  kind: 'scalar'|'subquery'|'money';   // money ⇒ resolved via a lateral, gated
  requiresJoin?: string[];     // 1:1 joins this column needs (composed + de-duped; NO 1-to-many joins)
  grain: 'task'|'case';        // which report type(s) it belongs to
  money?: true; sortable?: true; filterable?: true; groupable?: true; defaultVisible?: true;
};
type MisReportType = { type: string; label: string; base: string; columns: MisColumn[]; defaultSort: string; };
```
The repository composes `SELECT <fragments for requested+allowed keys> FROM <base + needed 1:1 joins [+ money
laterals if billing.view]> WHERE <scope> AND <bound filters> ORDER BY <key> <ASC|DESC> LIMIT/OFFSET`. Money
keys and 1-to-many columns are excluded by construction.

---

## 8 — Report-type catalogs (real columns; `★` default-visible, **$** money-gated). Full field trace is the SoT.

### 8a — `TASK_OPERATIONAL` (one row per task — slice 1)
- **Case context (1:1 scalar):** `case_number ★`, `client_name ★`, `product_name ★`, `case_status`,
  `case_verdict` (official case verdict — context), `case_result_remark`, `backend_contact_number`,
  `case_created_at ★`, `case_completed_at`, `case_pincode`, `case_area`, `dedupe_decision`, `dedupe_rationale`.
- **Task applicant (1:1 via `applicant_id`):** `applicant_name ★`, `mobile ★`, `pan ★`, `company_name`,
  `applicant_type`, `calling_code`.
- **Task (1:1):** `task_number ★`, `unit_name ★`, `unit_code`, `task_status ★`
  (PENDING/ASSIGNED/IN_PROGRESS/SUBMITTED/COMPLETED/REVOKED/CANCELLED — enum from the DB CHECK),
  `task_verification_outcome ★` (official per-task result POSITIVE/NEGATIVE/REFER/FRAUD), `task_remark`,
  `visit_type`, `task_origin`, `priority`, `dispatch_address`, `trigger`, `latitude`, `longitude`.
- **Unit / CPV (1:1):** `unit_category`, `worker_role` (the discriminator — `verification_units.kind` was
  dropped by ADR-0070/mig 0097, so no `unit_kind` column), `billing_profile`, `required_photos`,
  `pii_sensitive`, `bill_count ★`.
- **Rate & money (laterals, $):** `field_rate_type ★` (code — NOT money), `client_rate_type`,
  `rate_type_name`, `rate_type_category`, **`bill_amount ★ $`**, **`bill_line_amount $`** (`bill_amount ×
  bill_count`), **`commission_amount ★ $`** (snapshot at submit, else lateral), `currency`, `billable`,
  `billing_class`. (Case/group **totals** live only on `CASE_OPERATIONAL` / Summary — never a task row.)
- **TAT (per-task, 1:1/derived):** `tat_hours` (target), `due_at` (derived), `overdue` (derived),
  `submitted_elapsed_minutes`, `completed_elapsed_minutes`, `completed_tat_band` (derived).
- **Field report (task, 1:1 via `field_reports`):** `field_report_narrative ★` (templated narrative frozen at
  submission, ADR-0080; truncated in-grid, full in export), `verification_type`,
  `agent_field_note ★` (the field agent's submitted status from a **fixed** `form_data` key — evidence, may be
  `—`; NOT the official result), `report_snapshot_at`, `layout_name`.
- **Assignment (1:1 on `case_tasks`):** `assignee_name ★`, `assigned_by`, `assigned_at ★`,
  `submitted_at ★` (task submitted time), `completed_at`, `completed_by_name`, `task_pincode`, `task_area`.
- **Evidence (subquery):** `task_photo_count` (correlated `COUNT` — per-task; not a case metric).
- *Excluded at task grain:* `task_assignment_history.*` (1-to-many — use a dedicated history view), all
  case-level rollup counts (→ `CASE_OPERATIONAL`), co-applicant enumeration.

**Summary (TASK_OPERATIONAL):** group by `client` / `unit` / `task_status` / `task_verification_outcome` /
`assignee`; outputs `count` + (gated) money sums using billing's **exact** expressions:
`SUM(bill_amount × bill_count) FILTER (WHERE status='COMPLETED')`,
`SUM(COALESCE(ct.commission_amount, com.commission_amount) × bill_count)`. FROM stays 1:1 + laterals so sums
are exact. The money SQL is copied verbatim from the billing laterals; the shipped tests guard the money-gate
+ every column's SQL validity (all-columns rows/export), and a summary money-value equality test vs the
`/billing` endpoint is a tracked follow-up (registry §MIS-2026-07-01, differing group grains make a literal
endpoint-equality assertion non-trivial).

### 8b — `CASE_OPERATIONAL` (one row per case — slice 5)
- **Case (1:1):** `case_number ★`, `client_name ★`, `product_name ★`, `case_status ★`, `case_verdict ★`
  (official), `case_result_remark`, `backend_contact_number`, `case_created_at ★`, `case_completed_at ★`,
  `case_completed_by_name`, `case_pincode`, `case_area`, dedupe fields.
- **Primary applicant (1:1):** `primary_name ★`, `primary_mobile ★`, `primary_pan ★`, `applicant_type`,
  `applicant_count` (subquery).
- **Rollups (correlated subqueries — safe at case grain):** `total_tasks ★`, `completed_tasks ★`,
  `positive_tasks`, `negative_tasks`, `refer_tasks`, `fraud_tasks`, `photo_count`, `case_tat_days`
  (`completed_at − created_at`).
- **Money (case totals, $):** **`case_bill_total $`**, **`case_commission_total $`** — the `*_total`
  aggregates, computed with the billing FILTER/×bill_count/COALESCE expressions.

**Summary (CASE_OPERATIONAL):** group by client with case counts + verdict counts + (gated) money totals.

### Data-reliability (why cells are `—`)
Validation-guaranteed on a finalized case: `task_verification_outcome`, `task_remark`, `case_verdict`,
`case_result_remark` (now mandatory), completed-at/by, statuses. Legitimately blank: `field_report_narrative`
(best-effort snapshot; 9 field types), `agent_field_note`, photo completeness — device-enforced, not
server-enforced. MIS shows `—`; later data just appears.

---

## 9 — UI (owner-approved look, corrected)
One page, Universal DataGrid, `/pipeline` chrome. **Report-type switch** (Task / Case). **Filter bar:** date
mode toggle **created vs completed/submitted** + range · client · product · status · verification unit ·
outcome · **assignee** (added — cheap; column exists). Status options sourced from the DB CHECK. **Views:**
Tabular + Summary. **States:** loading skeleton · empty · error · permission (no `mis.view` ⇒ nav hidden +
403) · money hidden entirely without `billing.view`. Long text truncates in-grid, full in export.
Browser-verified per `feedback_browser_verify_perform_actions.md`.

---

## 10 — Later report types (same pattern)
- `CASE_OPERATIONAL` — slice 5 (above).
- `TAT_SLA` — the **one internal timing pair crm2 has** (assigned→submitted, assigned→completed) + aging/
  breach vs `tat_policies`. The bank's **second (sampling) TAT pair and bank-initiation timestamps are a
  data-model gap** (§14) — not "later report", they need schema first.
- `BILLING_COMMISSION` — reuses the ADR-0081 laterals directly; must match `/billing` (reuse, don't fork).

---

## 11 — Reuse inventory
| Need | Reuse | Path | Note |
|---|---|---|---|
| Money resolution | `RATE_LATERAL`/`COMMISSION_LATERAL`/`COMPLETED_BAND` | `platform/billing/laterals.ts`, `modules/billing/repository.ts` | reuse for **money only**, not the billing status WHERE |
| Read-model shape | commission-summary | `modules/billing/*` | grouping/period/filter idioms |
| Export (sync) | `writeExport`, `ExportColumn`, `assertExportable` | `platform/export/*` | **sync only**; 413 at ≥10k (async = deferred slice) |
| Pagination | `resolvePage`/`buildPage` | `platform/pagination.ts` | but MIS does its **own** strict key validation |
| Row-scope | `composeScopePredicate` | `platform/scope/*` | rows+summary+count+export |
| RBAC | `PERMISSIONS`/`PERMISSION_META`/`authorize` | `packages/access/*` | |
| DataGrid | Universal DataGrid + `Paginated<T>` | `apps/web/.../data-grid/DataGrid.tsx` | |

---

## 12 — Rejected alternatives
Revive ADR-0037/0049 (the removed injection engine) · full custom builder (reintroduces injection) · fixed
hard-coded reports (too rigid) · mv/worker for MVP (defer per ADR-0010) · DB config table for report defs
(code registry is safer) · **mixing case + task grain on one sheet** (double-counts — rejected; split into two
report types).

---

## 13 — Phased TDD build plan (each slice: `pnpm verify` green + CTO gate; memory updated per slice)
- **S0 — RBAC.** `mis.view` + `mis.export` in `@crm2/access` (+ PERMISSION_META "Reports"); mig `0109` seed.
  Tests: matrix parity, default-deny.
- **S1a — Registry + rows query (the risky core).** Report-type registry + `TASK_OPERATIONAL` (§8a) +
  repository: a fixed 1:1-join FROM (all joins are 1:1 → no fan-out, so always-on is safe; not per-column
  conditional), scope predicate, laterals-in/out by `billing.view`,
  bound-param filters, `ASC|DESC` switch, strict key validation. Tests: out-of-scope ⇒ 0 rows +
  `totalCount:0` · unknown/duplicate/wrong-type key ⇒ 400 · money dropped (+ not sortable/filterable/
  groupable) without `billing.view` · no 1-to-many fan-out (row count stable) · `form_data` fixed-fragment
  only.
- **S1b — Wiring.** service/controller/routes (`/report-types` gated, `/:type/rows`) + SDK `mis.ts` +
  **explicit `pnpm openapi`** step (note: not in `verify`). Tests: contract.
- **S2 — Summary.** `/:type/summary` group-by allow-listed key; billing-exact money sums; money-sum gated.
  (A summary money-value equality test vs `/billing` is a tracked follow-up — §MIS-2026-07-01.)
- **S3 — Web page.** DataGrid + report-type switch + filter bar (incl. assignee + created/completed date
  mode) + Columns picker (grouped, select-all, money lock) + Tabular/Summary + all states. Browser-verify.
- **S4 — Export (sync).** `writeExport` + money-stripped manifest + 413 at ≥10k. Tests: export columns ==
  selection minus money-when-ungated; PII columns present for `mis.export` holders (accepted).
- **S5 — `CASE_OPERATIONAL`** report type (§8b) — one registry entry + case-grain repo (correlated-subquery
  rollups, case totals) + tests (case counts correct; no task-grain duplication).
- **S6 — Saved views (optional).** `mis_saved_views` (mig `0110`) + CRUD + FE.
- **Later — `TAT_SLA`, `BILLING_COMMISSION`.**

**Gate:** sign-off on this spec + ADR-0084 → build slice-by-slice → **ask before first push** (push→main
auto-deploys to prod).

---

## 14 — Data-model gaps (bank-format MIS) — DEFERRED (need ADR + migration + create-flow capture)
Not in the CRM2 schema today, so MIS cannot show them; recorded in the registry:
- **LOS / LAN / bank application id** — no column on `cases`; a bank MIS can't be keyed back to the bank.
- **Case type** (FRESH / CREDIT-REFER / RE-VERIFICATION / RENEWAL) — not modeled (`task_origin`
  ORIGINAL/REVISIT ≠ the bank taxonomy).
- **CPC centre / region / zone** — only pincode/area exist on the case.
- **Sampling TAT + bank-initiation timestamps** — only ACS-internal assigned→submitted/completed exists.
- **~45-col per-document count matrix (incl. REVISIT + TOTAL, visit-vs-desk split)** — needs a matrix report
  + the doc taxonomy; `bill_count` is a billing multiplier, not the bank's document count.
A true bank-format export is a **separate project** (schema + case-creation capture + ADR), not this v1.

---

## 15 — Adversarial-review disposition (2026-07-01)
3 reviewers (security / architecture / domain). Approach upheld (no SQL-injection path survived). Confirmed
defects → **fixed in this spec:** base-WHERE status contradiction (§4), money-gate leak channels
summary/sort/filter/group + lateral-presence gating (§3/§6), 1-to-many fan-out + grain split (§4/§8),
invented/mis-placed columns `device_outcome`→`agent_field_note` / `tat_days`→case-grain / `*_tasks`
counts→case-grain (§8), summary sum correctness + equality test (§8a/S2), missing assignee/completed-date
filters (§9), export ≥10k async leak → sync+413 for MVP (§5), strict unknown-key + no jsonb path + catalog
gate (§3), S1 split + openapi step + narrative-blob ceiling (§13/§5). **Accepted:** full PII export (owner).
**Deferred:** bank-MIS data-model gaps (§14), async export tier. Full trail: registry §MIS-2026-07-01.
