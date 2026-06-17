# Dedupe Check page — design spec (2026-06-12)

## Goal
A standalone, **read-only** Operations page where an office user looks up whether an
applicant already exists in our case database, searching by **Name, PAN, Mobile, or
Company Name** (exact match, OR-combined, case-insensitive). The page lists matching
cases with links to each. It records no decision and creates nothing — it is a lookup
tool. Company Name is added to the data model end-to-end so the field is real, not dead.

Reference: v1 (`/cases/deduplication/*` + create-stepper dialog) and Zion (`CaseSearch`
page + inline gate). v2 already has an in-create dedupe gate (`POST /api/v2/cases/dedupe`,
exact PAN/mobile/name across applicants); this spec adds the **standalone page**, a
**dedicated permission**, and **Company Name**.

## Scope decisions (owner-confirmed)
- **Read-only lookup.** No "create case from match" handoff; no standalone decision
  persistence. The in-create dedupe gate keeps owning the persisted dedupe decision.
- **SYSTEM only** — searches our own cases. No external/cross-bank credit DB.
- **Single-record** — one applicant's identifiers per search. No bulk paste.
- **Exact match** — Name / PAN / Mobile / **Company Name**, OR-combined, case-insensitive.
  No partial/fuzzy/address/match-score.
- **Standard v2 page** — Universal DataGrid results (server pagination, sort, column
  visibility, **export**, date-time columns, loading bands, responsive), default-deny RBAC.

## RBAC — new dedicated permission
`case.view` is too broad (every viewer would get it) and dedupe-search deliberately scans
**all** cases cross-scope, so it must not ride on case-view. Add a new read-only permission:

- `DEDUPE_VIEW = 'dedupe.view'` (group `Operations`, label "Dedupe — Check").
- Granted to **SUPER_ADMIN** (via `grants_all`), **MANAGER**, **TEAM_LEADER**,
  **BACKEND_USER**. **Not** FIELD_AGENT, **not** KYC_VERIFIER (adjustable later via Roles admin).
- Wired in three coordinated places (all change together — the roles-seed parity test asserts
  `@crm2/access ROLE_PERMISSIONS` == the `role_permissions` table):
  1. `@crm2/access` `PERMISSIONS` + `ROLE_PERMISSIONS` + `PERMISSION_META`.
  2. Migration seeds `role_permissions` rows for MANAGER/TEAM_LEADER/BACKEND_USER.
  3. The standalone page route, the nav item, and the dedupe-search endpoints `authorize(dedupe.view)`.
- The in-create gate endpoint (`POST /cases/dedupe`) **keeps `case.view`** — it is part of the
  create flow (already requires `case.create`), used by creators who may not hold `dedupe.view`.
  Two thin endpoints over one repo method, different contexts, different perms (documented).

## Data model — Company Name (migration 0040)
`case_applicants` today holds `name, mobile, pan` only. Add:
- `ALTER TABLE case_applicants ADD COLUMN company_name varchar(200)` (nullable — optional field).
- `CREATE INDEX idx_applicants_company ON case_applicants (lower(company_name))` (mirrors the
  name/mobile/pan dedupe indexes).
- Same migration 0040 seeds the `dedupe.view` `role_permissions` rows (one feature, one migration).
- Applied to dev `:54329` and test `:5433`; idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`).

## Backend (cases module)
1. **`searchDuplicates` (shared repo method)** — add `companyName` to the OR-match
   (`lower(a.company_name) = $n`), add `'COMPANY'` to `matchType`, and return `company_name`
   in every result row. Used by BOTH the in-create gate and the new page endpoint.
2. **`GET /api/v2/cases/dedupe-search`** — `authorize(dedupe.view)`. Query params:
   `name`, `pan`, `mobile`, `company` (lenient search terms, ≥1 required → else 400
   `VALIDATION`), plus `page`/`limit`/`sortBy`/`sortOrder`. Returns the **standard
   `Paginated<DuplicateMatch>` envelope** (`{items,totalCount,page,pageSize,totalPages,sort,filters}`)
   with a matching `COUNT`. **Cross-scope by design** — no scope predicate (dedupe must find a
   duplicate anywhere; this is why it has its own perm). Result cap 200 retained as a safety bound.
3. **`GET /api/v2/cases/dedupe-search/export`** — `authorize(data.export)`. Same identifiers;
   XLSX/CSV via the existing `platform/export` engine (`current`/`all` modes; ≤200 rows → sync,
   no job tier). Columns mirror the grid.
4. **`POST /api/v2/cases/dedupe`** (in-create gate) — unchanged perm; inherits the company match
   from the shared repo method (the create form now captures company).
5. **Create** — applicant input schema gains optional `companyName` (`z.string().trim().max(200)`),
   written on insert. **Every SELECT returning a `CaseApplicant` must include `company_name`**
   (honors the existing don't-regress rule; case-detail applicants SELECT updated + test asserted).

## SDK (@crm2/sdk)
- `companyName` added to `DuplicateMatch`, `CaseApplicant`, the create applicant input, and
  `DedupeQuery` (lenient `searchTerm` optional).
- New transport methods: `cases.dedupeSearch(params): Promise<Paginated<DuplicateMatch>>` and
  `cases.dedupeSearchExport(params, format)`. Contract test added.

## Frontend
1. **New page** `apps/web/src/features/dedupe/DedupePage.tsx`, route `/dedupe`, nav item
   under **Operations** after Pipeline. Page + nav + route all gated by `dedupe.view` (hidden +
   guarded for roles without it).
2. **Search form** (above the grid): four inputs — Name, PAN, Mobile, Company Name — + Search.
   ≥1 required (the button is disabled / shows a hint until one is filled). Inputs use the
   **lenient** search rules (min 2 chars), NOT the strict create-time PAN/phone regex. The four
   identifiers are the page's search state (persisted in the URL) and drive the query params.
3. **Results = Universal DataGrid** (server-side). Columns: **Case #** (links to `/cases/:id`),
   Applicant, **Company**, Mobile, PAN, Status (badge), Client, **Created** (date + time via
   `formatDateTime`), **Matched on** (chips from `matchType`). DataGrid provides server
   pagination, sort, column visibility, loading bands + Hexagon loader, responsive card view,
   and the **Export** button (`data.export`, XLSX/CSV). The grid's own global-search / header
   filters are disabled — the identifier form is the sole search surface (documented deviation).
4. **Empty / initial states:** before a search, a prompt ("Enter an identifier to search");
   after a search with no hits, "No matching cases found".
5. **Case-create applicant form** + **case-detail applicants**: add an optional **Company Name**
   field so it is captured and displayed.

## Standards applied
Universal DataGrid (no raw table) · server pagination envelope · date-time columns
(`formatDateTime`) · export engine · loading bands + Hexagon loader · responsive-first
(mobile card view) · UPPERCASE display where applicable · design tokens (no hardcoded colors) ·
default-deny RBAC · OCC N/A (read-only) · audit N/A (no writes on this page).

## Out of scope / deferred
- **Per-task "Check Dedupe before assign"** (Zion-style hard gate per document) — owner deferred.
- External / cross-bank DEDUPE source · bulk paste (≤100) · create-from-match handoff ·
  standalone decision persistence · partial/fuzzy/address matching + match-score.

## Testing & verification
- **api** integration (cases test): dedupe-search returns the envelope; company match works
  (exact, case-insensitive); ≥1-identifier-required → 400; `dedupe.view` enforced (FIELD_AGENT /
  KYC_VERIFIER → 403, granted roles → 200); **cross-scope** — a portfolio user finds a match
  outside their case scope (proves the no-scope-predicate intent); export returns XLSX/CSV;
  create captures `company_name` and case-detail returns it.
- **roles seed parity test** updated for `dedupe.view`.
- **sdk** contract test for `dedupeSearch`/applicant `companyName`.
- **Playwright** (optional): `/dedupe` added to viewport + a11y scans; a search → results spec.
- Full `LC_ALL=C … pnpm verify` EXIT=0 (run alone). **Browser-verify**: search a known applicant
  → match appears with company + matched-on chips → click through to the case; a role without
  `dedupe.view` cannot see the nav item / hits 403; create a case with a company → it is searchable.
- Local commits at green gates; **ask before push.**

## Plan slices (next mig = 0040)
1. **0040** — `company_name` column + index + `dedupe.view` `role_permissions` seed (dev + test).
2. **@crm2/access** — `dedupe.view` perm + role grants + meta + parity test.
3. **SDK** — `companyName` on the 4 types + `dedupeSearch`/export methods (+ contract test).
4. **API** — `searchDuplicates` company match; `GET /cases/dedupe-search` (+ export); create
   captures company; case-detail SELECT returns it (+ integration tests).
5. **Web** — DedupePage + route + nav (dedupe.view-gated); company field on create + detail.
6. **Audit Panel + verify + browser-verify.**
