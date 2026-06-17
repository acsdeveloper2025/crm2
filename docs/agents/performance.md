<!-- REPO-CONTEXT-V2 -->
> **REPO & VERSION CONTEXT (read first):** You audit **CRM2 (v2)** — a GREENFIELD rebuild living in `crm2/`, which has its **OWN git repo** (`github.com/acsdeveloper2025/acs-crm-2`) even though it sits INSIDE the v1 monorepo directory `CRM-APP-MONOREPO-PROD/` (v1 git-ignores it). **THREE separate git repos share that one folder:**
> 1. **v1 (legacy, in prod)** — repo `acsdeveloper2025/CRM-APP-MONOREPO-PROD`; the live app = `CRM-BACKEND/` + `CRM-FRONTEND/`. ⚠️ `acs_db_final_version.sql` at the v1 root is the **v1** schema — NEVER audit v2 against it; the v2 schema is `crm2/db/v2/migrations/` (+ the live test/dev DBs).
> 2. **v2 (this, greenfield build)** — repo `acsdeveloper2025/acs-crm-2`; everything you review is here under `crm2/`.
> 3. **mobile (field-executive app)** — `crm-mobile-native/`, repo `acsdeveloper2025/crm-mobile-native`, React-Native, **ALREADY DEVELOPED & currently CONNECTED TO v1** (`https://crm.allcheckservices.com/api/mobile`). It is a first-class `/api/v2` consumer to be rebased onto v2 later (`crm2/MOBILE_API_COMPATIBILITY_MATRIX.md`) — **never break the mobile contract** (ADR-0012).

# Ledger — Performance Auditor

Charter: AGENT_ORG.md row 5. Server pagination · indexes · query plans · N+1 · payload · perf budgets ·
loading bands · background-job threshold. SoT: PERFORMANCE_STANDARDS · PAGINATION_AND_LOADING_STANDARDS ·
DATAGRID_STANDARD §16.

## Standing invariants / budgets
- Every list paginates server-side; `limit ≤ 500` (above forbidden → 400). Default 25.
- Indexes on every sort/filter column; no `SELECT *`; no full scans; `EXPLAIN` reviewed on hot paths.
- Budgets: dashboard/pipeline/case/workspace < 2s · MIS < 3s · exports + any >8s op = background job.
- Loading bands: 0–300ms none · 300ms–1s skeleton · 1–3s loader+% · 3–8s loader+%+op · >8s job.

## OPEN items (carry forward)
- **Indexes:** the new paginated `ORDER BY` on clients/products is unindexed (small tables, fine now).
  **Before rolling out locations (157k rows)**, add indexes on its sort/filter columns (pincode/area/city/
  state + created/updated) or the OFFSET pagination will scan. Coordinate with the DB auditor.
- **N+1:** none introduced (single COUNT + single SELECT per list). Watch joined list views during rollout.
- **B-22:** dropdown fetches use `?active=true&limit=200` (one query, capped) — fine; a dedicated options
  endpoint (id/name) would shrink payload further.
- **Loaders:** DataGrid ships skeleton rows; the 1–3s/3–8s loader bands + Hexagon loader + >8s background-job
  UX are NOT built yet (B-8 partial). Required before MIS/exports.

## Log
- **2026-06-06 · DataGrid Slice 1 — server-pagination `users` / `verification_units` / `report_templates` (uncommitted)** — **VERDICT: PASS.**
  - **(a) Server pagination + cap** ✓. All 3 repos converted unbounded `SELECT … ORDER BY` → single COUNT + single
    LIMIT/OFFSET SELECT (`users/repository.ts:54-90`, `verificationUnits/repository.ts:54-72`,
    `reportTemplates/repository.ts:49-69`). LIMIT/OFFSET are **parameterized** (`$N+1/$N+2`), default 25, cap rejected
    at `platform/pagination.ts:40-42` (`limit>500 → 400 LIMIT_TOO_LARGE`; `limit<1 → 400`). Unchanged shared helper.
    Test-proven: `users.api.test.ts:251-253` (501→400), `:45` (default pageSize 25), `:225-226` (paging). Controllers
    now thin-delegate raw query (`users/controller.ts:18`, etc.) — no per-request fan-out.
  - **(d) N+1** ✓ none. Exactly 2 queries per list (COUNT + page). The users page SELECT keeps its single
    `LEFT JOIN users m` for `reports_to_name` (`users/repository.ts:79`) — joined-in, not looped. COUNT runs on the
    same WHERE without the join (`:74-77`) — correct & cheaper.
  - **(c) COUNT-per-fetch** — ACCEPTABLE at this scale (handful / ~68 / few rows). RATCHET when this pattern reaches
    cases/locations: consider `count(*) OVER()` window or cached counts there, not here.
  - **(b) Indexes** — proportionate note, NOT a flag at this volume. Existing idx: users{role,reports_to,is_active}
    (`0007_users.sql:28-30`) + username UNIQUE; verification_units{kind,category} PARTIAL `WHERE is_active`
    (`0001:70-71`) + code UNIQUE; report_templates{template_type,is_active} (`0008:25-26`) + code UNIQUE.
    **Every default-sort column is UNINDEXED:** users `name`, verification_units `sort_order`, report_templates `name`
    — plus sortable `effective_from`/`created_at`/`updated_at` on all three, and `m.name` (users reportsTo sort).
    Negligible now (OFFSET scan over a few–68 rows). The partial VU indexes also won't serve `kind`/`category`
    filters when `active` is not in the predicate.
  - **(e) Dropdown feeders (B-22)** — CpvPage `UnitManager` (`CpvPage.tsx:281-284`) + RateManagementPage
    (`RateManagementPage.tsx:131-135`) now fetch `verification-units?active=true&limit=200` and unwrap `.items`.
    One capped query each, no N+1 — fine. **Truncation risk:** if active verification_units ever exceed 200 the
    dropdown silently drops the tail (no "load more"). ~68 today → safe with headroom; carry as OPEN.
  - **(f) Budget** <2s trivially met at this scale.

## OPEN items (carry forward) — appended 2026-06-06
- **RATCHET (index, later slices):** the OFFSET pagination here is index-free on its sort/filter columns. Acceptable
  for users/VU/report_templates (tiny). **Before locations[157k] / cases**, every default-sort + sortable column
  (created_at/updated_at/effective_from/name/pincode/area/city/state) MUST be indexed or OFFSET will full-scan +
  the deep-page OFFSET cost compounds. Coordinate with DB auditor. Same applies if these 3 tables ever grow.
- **RATCHET (COUNT):** COUNT(*) runs every page fetch. Fine now; revisit (window count / cached count) at
  cases/locations scale.
- **B-22 (carry):** FE dropdown feeders capped at `limit=200` and silently truncate beyond that. Active
  verification_units ~68 now. A dedicated lightweight options endpoint (id/code/name only, no pagination cap issue)
  would remove both the truncation risk and the payload of full rows used only to populate a `<select>`.

## Log
- **2026-06-06 · DataGrid Slice 2 — server-pagination `locations` [157k] + migration `0020_locations_search_indexes.sql` (uncommitted)** — **VERDICT: PASS.**
  - **(a) Server pagination + cap** ✓. `locations` was capped at "showing up to 500" client-side (unsortable/unsearchable
    beyond) → now single COUNT + single LIMIT/OFFSET SELECT (`locations/repository.ts:45-57`). LIMIT/OFFSET parameterized
    (`$N+1/$N+2`), default 25, cap enforced at `platform/pagination.ts:42` (`limit>500 → 400 LIMIT_TOO_LARGE`). sortBy
    whitelisted via `LOCATION_PAGE_SPEC.sortMap` (`service.ts:8-22`) → `resolvePage` falls back to default for unknown
    keys (`pagination.ts:49-55`). Test-proven: paging+totals (`locations.api.test.ts:94-107`), server sort
    (`:109-122`), search filter (`:124-135`), `limit=501→400 LIMIT_TOO_LARGE` (`:137-141`), injection sortBy →
    default (`:143-148`). FE `LocationsPage.tsx:259` now uses `pageQueryToParams(query)` (standard DataGrid hook),
    old 500-cap banner removed (`:160`). **The Slice-1 RATCHET index item is RESOLVED for the two access paths the
    grid actually drives (search + default sort) — see (b).**
  - **(b) Indexes back the real query paths** ✓ (the two that matter):
    - **Global search** = `pincode/area/city/state ILIKE '%term%'` (leading wildcard, btree useless). Migration 0020
      adds 4 **pg_trgm GIN** idx (`0020:12-15`) → planner BitmapOrs the four columns instead of a 157k seq-scan. Correct
      index choice for `ILIKE %…%`. ✓
    - **Default sort** = `ORDER BY pincode, id` over ALL rows (admin list has no is_active filter, so the pre-existing
      PARTIAL `idx_locations_pincode WHERE is_active` from `0004:24` does NOT cover it). 0020 adds non-partial composite
      `idx_locations_pincode_sort (pincode, id)` (`0020:19`) — exact match for the default page. Both ORDER BY keys move
      in the SAME direction (`pincode <dir>, id <dir>`, repo:53) so one composite serves asc & desc via fwd/back scan. ✓
    - Migration is forward-only + idempotent (`CREATE EXTENSION IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). ✓
  - **(b-gap) Remaining unindexed sort columns → CARRY (lower-pri).** `LOCATION_PAGE_SPEC.sortMap` exposes
    `area/city/state/country/status(is_active)/effectiveFrom/createdAt/updatedAt` as sortable, but 0020 only indexes the
    DEFAULT sort (pincode). Sorting the unfiltered 157k list by **area/city/country/created_at/updated_at/is_active** →
    seq-scan + top-N heapsort on 157k (`effective_from` IS covered by `0015:33`; `idx_locations_state_city` from `0006:11`
    is PARTIAL `WHERE is_active` so it won't serve the unfiltered admin sort). For a deep-page OFFSET on those columns the
    sort cost compounds. **Disposition:** acceptable to ship — this is an admin-only catalog screen, low concurrency, the
    two hot paths (search, default sort) ARE indexed, and a one-time top-N sort on 157k is ~hundreds of ms (within <2s).
    NOT a flag. CARRY as a lower-pri ratchet: if operators routinely sort the full list by city/created_at, add btree idx
    on those (or a covering `(col, id)`); revisit if locations grows or concurrency rises. Recommend DB auditor run
    `EXPLAIN ANALYZE` on a `sortBy=city` deep page against the real 157k dev DB to confirm the heapsort stays sub-second
    (couldn't run here — local dev :54329 has no `locations` table; 157k catalog is test-DB only).
  - **(c) COUNT(*) per page fetch on 157k** — NOTE / borderline-acceptable. Every page does
    `SELECT count(*) FROM locations <clause>` (`repository.ts:45-48`). Unfiltered → exact count of 157k = a full
    index/seq scan EVERY page (no cheap shortcut; Postgres count is not O(1)). With the new indexes a filtered count
    (search/pincode) is cheap, but the bare admin list count is the worst case. Still bounded (single scan, no N+1) and
    one-shot per request → likely sub-second, within budget. **Disposition:** ACCEPTABLE now, but this is the first
    table where COUNT cost is real. CARRY the Slice-1 COUNT ratchet, now ESCALATED to locations scale: prefer
    `count(*) OVER()` folded into the page SELECT (one scan instead of two) OR a cached/approx count
    (`reltuples` for the unfiltered case) when this screen shows load. Coordinate with DB/Caching auditors.
  - **(d) RateMgmt cross-consumer** ✓. `RateManagementPage.tsx:407-409` `AddRateForm` areas query now hits
    `?pincode=X&limit=200` and unwraps `.items` (array→envelope migration handled). `pincode=X` is an **equality**
    filter → served by `idx_locations_pincode` (partial, but the op-read also filters is_active so the partial idx
    applies) — one indexed, capped query, no N+1. Fine. (Distinct `?pincode` areas per pincode ≪ 200 → no truncation.)
    The `repo.pincodes()` picker (`repository.ts:61-74`) uses `pincode LIKE 'q%'` (prefix, trailing wildcard) +
    `is_active` + `LIMIT 50` → served by the partial `idx_locations_pincode (pincode) WHERE is_active`. ✓
  - **(e) Budget <2s** — met for the two indexed hot paths (search, default sort). The unfiltered-COUNT and
    non-default-column sorts are the only sub-budget risks and both are admin/low-concurrency; flagged as carries, not
    blockers.

## OPEN items (carry forward) — appended 2026-06-06 (Slice 2)
- **RATCHET (index) — locations[157k]: PARTIALLY RESOLVED.** Search (4× pg_trgm GIN) + default sort `(pincode,id)`
  now indexed (migration 0020). **Carried (lower-pri):** non-default sortable columns `area/city/country/created_at/
  updated_at/is_active` remain unindexed for the UNFILTERED 157k list → seq-scan + top-N heapsort. Acceptable for an
  admin screen; index `(col,id)` if operators sort the full list by these routinely. (`effective_from` already indexed
  by 0015; `idx_locations_state_city` is partial WHERE is_active so it does NOT cover the unfiltered admin sort.)
- **RATCHET (COUNT) — ESCALATED to locations scale.** Unfiltered `count(*)` on 157k runs a full scan every page fetch
  (~sub-second but real). Move to `count(*) OVER()` (single scan) or cached/`reltuples` approx for the bare list when
  this screen shows load. Filtered counts (search/pincode) are cheap with 0020. Coordinate DB/Caching.
- **EXPLAIN ANALYZE TODO (DB auditor):** confirm against the real 157k dataset (test DB) that (1) search uses the GIN
  trgm bitmap (not seq-scan), (2) default sort uses `idx_locations_pincode_sort`, (3) a `sortBy=city` deep-page heapsort
  stays sub-second. Could not run locally — dev :54329 has no `locations`; catalog is test-DB only.

## Log
- **2026-06-06 · DataGrid Slice 3 — server-pagination `cases` (JOIN view + 2 correlated count subqueries/row) (uncommitted)** — **VERDICT: PASS.**
  - **(a) Server pagination + cap** ✓. `cases.list` was `… ORDER BY cs.created_at DESC LIMIT 200` (hard 200-row ceiling,
    no paging/search/count) → now single COUNT + single LIMIT/OFFSET SELECT (`cases/repository.ts:206-237`).
    LIMIT/OFFSET **parameterized** (`$${params.length+1}/$${params.length+2}`, repo:234-236), default 25, cap rejected at
    `platform/pagination.ts:42` (`limit>500 → 400 LIMIT_TOO_LARGE`; `<1 → 400 INVALID_LIMIT`). sortBy whitelisted via
    `CASE_PAGE_SPEC.sortMap` (`service.ts:13-25`) → `resolvePage` falls back to `createdAt` default for unknown keys
    (`pagination.ts:51-55`). Controller is now a thin pass-through of `req.query` (`controller.ts:62`); status/clientId
    re-validated in the service (`service.ts:67-73`). Test-proven: envelope+default-sort (`cases.api.test.ts:255-264`),
    paging+server-sort caseNumber asc (`:266-279`), search echoes filter (`:281-289`), `limit=501→400 LIMIT_TOO_LARGE`
    (`:291-295`), injection `sortBy` → default no-op (`:297-303`).
  - **(b) The 2 correlated subqueries/row (applicant_count, task_count)** — ACCEPTABLE NOW, **RATCHET for cases growth.**
    `CASE_VIEW_SELECT` (`repository.ts:43-44`) runs two per-row scalar subqueries: `(SELECT count(*) FROM case_applicants
    a WHERE a.case_id=cs.id)` and `(SELECT count(*) FROM case_tasks ct WHERE ct.case_id=cs.id)`. With page size ≤200 that
    is ≤400 subquery executions per fetch — and **both subquery keys ARE indexed**: `idx_applicants_case (case_id)` and
    `idx_case_tasks_case (case_id)` (`0010_cases.sql:48,70`) → each is a cheap index-only-ish count over a handful of rows
    per case, not a scan. This is NOT N+1 at the app layer (one SQL round-trip, the planner fans the subqueries inside the
    page window only — they run for the ≤limit returned rows, not all of `cases`). **CARRY as ratchet:** as `cases` grows
    the per-row subquery overhead compounds on deep/large pages; migrate to two `LEFT JOIN LATERAL (… GROUP BY)` or a
    grouped pre-agg CTE joined once when this screen shows load. Cheap win available; not needed at current volume.
  - **(c) COUNT(*) per fetch** — ACCEPTABLE NOW, same scale caveat as locations. COUNT query (`repository.ts:223-228`) is
    correctly REDUCED to `cases cs LEFT JOIN case_applicants pa ON … is_primary` — it drops the clients/products JOINs and
    BOTH correlated subqueries (those don't affect row count), keeping only the primary-applicant join that `pa.name`
    search needs. `uq_case_one_primary` (partial-unique, `0010:47`) guarantees ≤1 primary/case so the LEFT JOIN never
    multiplies the count. Good. Unfiltered `count(*)` is still a full scan per page; fine at small volume, ratchet at scale
    (window `count(*) OVER()` folded into the page SELECT, or `reltuples` approx) — carry the locations COUNT ratchet here.
  - **(d) Indexes — proportionate note, NOT a flag at this volume; RATCHET for cases growth.** `cases` has only
    `idx_cases_client (client_id)` + `idx_cases_status (status)` (`0010:29-30`). Gaps for the new query paths:
    - **Default sort `ORDER BY cs.created_at DESC, cs.id DESC` is UNINDEXED** (repo:233). At scale → seq-scan + top-N
      heapsort on the whole table every default page; deep-page OFFSET compounds it. **#1 ratchet item.**
    - **JOIN key `cases.product_id` is UNINDEXED** (`JOIN products p ON p.id=cs.product_id`, repo:46). FK exists
      (`0010:13`) but no index; planner can hash/merge-join against the tiny products table today, but a nested-loop on a
      large `cases` would want `(product_id)`. (`client_id` IS indexed; `clients.id`/`products.id` are PKs.)
    - **Search `pa.name ILIKE '%term%'`** (leading wildcard, repo:218) — `idx_applicants_name` is `lower(name)` btree,
      USELESS for `%…%`. But search is applied to the per-case primary-applicant set (≤1/case via the partial-unique), not
      a free 157k-style scan, so the cost tracks `cases` size, not `case_applicants` size. If case-name search gets hot at
      scale, add a pg_trgm GIN on `case_applicants.name` (mirrors the locations Slice-2 pattern).
    - Subquery FKs already covered (see (b)). Sortable `cs.updated_at`, `cl.name`, `p.name` also unindexed for unfiltered
      sort — same heapsort-at-scale caveat, lower-pri.
    **Disposition:** cases is small TODAY (handful of rows in dev/test) → all paths sub-second, NOT a blocker. But cases is
    the ONE operational table that grows UNBOUNDEDLY over time (unlike the fixed-size master-data tables). **Before cases
    reaches ~10k+ rows, add a migration:** `idx_cases_created_at (created_at DESC, id DESC)` (default sort — highest
    priority), `idx_cases_product (product_id)` (JOIN), and convert the 2 correlated counts to LATERAL/grouped. Coordinate
    with DB auditor; ask for `EXPLAIN ANALYZE` on a seeded large-cases dataset to confirm the default-sort page uses an
    index scan (not heapsort) and the subqueries stay index-cheap.
  - **(e) Budget <2s** — trivially met at current volume (small table, ≤200-row pages, all keys for COUNT + subqueries
    indexed). The created_at-sort heapsort + unfiltered COUNT + per-row subqueries are the only sub-budget risks and ALL
    are scale-gated, not present today. Confirmed PASS.
  - **No N+1 introduced:** exactly 2 SQL round-trips per request (COUNT + page); the per-row subqueries execute inside the
    single page query over the ≤limit window, not as app-layer loops. ✓

## OPEN items (carry forward) — appended 2026-06-06 (Slice 3)
- **RATCHET (index) — cases [UNBOUNDED/operational, the one table that grows forever]:** before ~10k+ rows add
  `idx_cases_created_at (created_at DESC, id DESC)` (default sort — top priority, currently heapsort) + `idx_cases_product
  (product_id)` (JOIN key, only FK with no index). Lower-pri: `updated_at`, `cl.name`/`p.name` sorts; pg_trgm GIN on
  `case_applicants.name` IF `%name%` search gets hot. Subquery keys (`case_applicants.case_id`, `case_tasks.case_id`)
  ALREADY indexed. Coordinate DB auditor + request `EXPLAIN ANALYZE` on a seeded large dataset.
- **RATCHET (correlated subqueries) — cases:** `applicant_count`/`task_count` are 2 per-row scalar subqueries (≤400/page
  at limit 200, both keys indexed → cheap now). Convert to `LEFT JOIN LATERAL (… GROUP BY)` or grouped pre-agg CTE when
  the cases list shows load. Cheap win; not needed at current volume.
- **RATCHET (COUNT) — carried from locations, now spans cases too:** unfiltered `count(*)` is a full scan per page fetch.
  Move to `count(*) OVER()` (one scan) or `reltuples` approx for the bare list at scale. Filtered counts (status/clientId/
  search) ride the existing/needed indexes.

## Log
- **2026-06-06 · Slice 1A — cases-growth index ratchet, migration `0021_cases_growth_indexes.sql` (migration-only, uncommitted)** — **VERDICT: PASS.**
  - This migration is the EXACT realization of the Slice-3 "#1 ratchet" item I prescribed (ledger lines 163-166, 174-178).
    Sequence-clean: 0021 follows 0020 (locations), forward-only, idempotent (`CREATE INDEX IF NOT EXISTS`,
    `CREATE EXTENSION IF NOT EXISTS pg_trgm`). Four indexes, each verified against the live query in
    `cases/repository.ts` + `service.ts`:
  - **(1) Default-sort first page** ✓ — `idx_cases_created_at (created_at DESC, id DESC)` (0021:13). Exact column AND
    direction match for `ORDER BY cs.created_at DESC, cs.id DESC` (repo:233) with default `createdAt desc`
    (`service.ts:31-32`). Planner reads page 1 straight off the index — eliminates the top-N heapsort I flagged as the
    #1 risk. One composite serves desc (fwd scan) and asc (back scan) since both keys move together. This is the
    highest-value index of the four (default page = the most-hit path). ✓
  - **(2) FK join** ✓ — `idx_cases_product (product_id)` (0021:17) backs `JOIN products p ON p.id = cs.product_id`
    (repo:47). Closes the one FK that lacked an index (`client_id` already had `idx_cases_client` from 0010:29).
    Lets a growing `cases` nested-loop/use the index instead of relying on a hash against tiny `products`. ✓
  - **(3+4) Leading-wildcard ILIKE search** ✓ — `idx_cases_case_number_trgm` + `idx_applicants_name_trgm`
    (gin trgm, 0021:22-23) back `cs.case_number ILIKE '%t%' OR pa.name ILIKE '%t%'` (repo:219). Correct index TYPE for
    leading wildcards (b-tree useless; pre-existing `idx_applicants_name = lower(name)` btree serves equality only).
    Planner can BitmapOr the two columns instead of seq-scanning `cases`/`case_applicants`. Mirrors the proven
    Slice-2 locations pg_trgm pattern. ✓
  - **Coverage of the real access paths: COMPLETE for the three hot paths** (default-sort page · FK join · global
    search). No missing index for a hot path. The sortMap (`service.ts:22-30`) also exposes `status`(idx exists 0010:30),
    `clientName`/`productName`/`primaryName`/`updatedAt` as SORTABLE — these remain unindexed for the *unfiltered*
    sort, but per Slice-3 they are lower-pri (non-default, admin/low-concurrency; index `(col,id)` only if operators
    sort the full list by them routinely). NOT a flag.
  - **Over-indexing / write-amplification** — proportionate, NOT a concern. cases is the one UNBOUNDED operational
    table, so amortizing read cost over write cost is the correct trade. 4 indexes on cases (now 6 total w/ 0010's two)
    is modest; the 2 trgm GIN indexes carry the only non-trivial write cost (GIN insert + fastupdate), justified because
    `%…%` search is otherwise a full table scan. Inserts are one-row-per-case (not bulk-loaded) so GIN maintenance is
    bounded. No redundant/overlapping index (each maps to a distinct path).
  - **CTO call — small-table sort indexes (users/VU/templates) are RATCHET/defer-by-design: CONFIRMED.** Correct and
    proportionate. On a few–68-row table the planner ignores a sort index (seq-scan + in-memory sort is cheaper than an
    index read), so such an index is pure write overhead with zero read benefit — deferring is the right call, not a
    gap. Aligns with my Slice-1 disposition (ledger lines 36-47, 50-53). **Boundary I'd hold them to:** GA-deadline
    revisit if ANY of those tables exceeds ~5k rows (where top-N heapsort + deep OFFSET starts to bite); cases got its
    indexes now precisely because it alone grows unbounded. CONFIRMED.
  - **EXPLAIN-at-scale caveat (unchanged):** can't prove index usage locally — dev cases table is tiny; a seeded
    large-cases dataset is needed. Handed to DB auditor (see OPEN) to confirm (1) default page uses index scan not
    heapsort, (2) search uses the trgm bitmap, (3) product join uses idx_cases_product.

## OPEN items (carry forward) — appended 2026-06-06 (Slice 1A)
- **RESOLVED (was Slice-3 #1 ratchet):** cases default-sort `(created_at DESC, id DESC)` + FK `product_id` + global-search
  trgm GIN are now indexed by 0021. The three hot paths are backed.
- **EXPLAIN ANALYZE TODO (DB auditor):** on a seeded large-cases dataset confirm 0021's indexes are actually chosen —
  default page = index scan (no heapsort), `%term%` search = trgm bitmap, product join = idx_cases_product. Not provable
  on the tiny local cases table.
- **CARRY (lower-pri):** non-default sortable columns `clientName/productName/primaryName/updatedAt` unindexed for the
  unfiltered 157k-style sort; add `(col,id)` only if operators sort the full list by them routinely. (status already idx.)
- **CARRY (correlated subqueries):** `applicant_count`/`task_count` still 2 per-row scalar subqueries (both keys indexed →
  cheap now); convert to LATERAL/grouped pre-agg when the cases list shows load. Cheap win, not needed yet.
- **CARRY (COUNT):** unfiltered `count(*)` still a full scan per page; `count(*) OVER()` or `reltuples` approx at scale.
- **RATCHET CONFIRMED (small-table sort idx):** users/VU/report_templates sort indexes deferred-by-design; GA revisit if
  any exceeds ~5k rows. Triple-write invariant: 0021 must be applied to all target DBs at rollout (out of scope here —
  this is a migration-file audit; flag for whoever applies it).

## Log
- **2026-06-06 · Slice 1B — B-22 `/options` endpoints (clients/products/verification-units/users) + 9 FE feeders re-pointed (working tree, uncommitted)** — **VERDICT: PASS.**
  - **(a) Unpaginated full-table read — ACCEPTABLE + SAFER than the old `limit=200`.** Each `options()` repo method is a
    single-table SELECT of USABLE rows only (`WHERE is_active AND effective_from <= now()`), trimmed to id/code/name (+kind
    VU, +username/role users): `clients/repository.ts:57-63`, `products/repository.ts:57-63`,
    `verificationUnits/repository.ts:80-86`, `users/repository.ts:95-101`. These are fixed-size reference tables (clients/
    products dozens, VU ~68, users dozens–low-hundreds). Returning the FULL usable set is the **correct fix for B-22**: the
    old `?active=true&limit=200` SILENTLY TRUNCATED the tail of a `<select>` with no "load more" (Slice-1 ledger lines 44-46,
    56-58) — a correctness bug, not just a perf note. Unpaginated here is strictly safer: a dropdown that drops options is
    worse than one extra cheap query. Payload also SHRINKS vs the old full-row page (3-4 cols vs every column + version/
    audit/effective_from). No `SELECT *`. Confirmed by test (USABLE-only: inactive/future rows excluded —
    `clients.api.test.ts:121-141`, `verificationUnits.api.test.ts:139-169`, `users.api.test.ts:136-152`).
  - **(b) Index use — proportionate, NOT a flag (matches the standing small-table disposition).** The `WHERE is_active`
    predicate: users has `idx_users_active (is_active)` (`0007_users.sql:30`); VU has PARTIAL `idx_verification_units_kind/
    _category … WHERE is_active` (`0001:70-71`) — those serve the kind/category filter when active, and the bare
    `WHERE is_active` here is a tiny scan regardless; **clients/products have NO secondary index** (0002 declares only PK +
    code-unique, no `CREATE INDEX`). At dozens–hundreds of rows the planner seq-scans + filters in <1ms — an index would be
    pure write overhead with zero read benefit (same CTO call confirmed for sort indexes, ledger lines 215-220). `ORDER BY
    name` (VU: `sort_order, name`) is unindexed but a trivial in-memory sort at this scale. **No N+1, no join** — every
    `options()` is one single-table round-trip; the 9 FE feeders each fire ONE query (down from one capped query each — net
    payload reduction, same query count).
  - **(c) Route ordering (correctness, not perf, but verified):** `/options` is registered BEFORE `/:id` on all three
    master-data routers (`clients/routes.ts:13`, `products/routes.ts:13`, `verificationUnits/routes.ts:13`) so it isn't
    captured as `id="options"`; users mounts it before the param routes (`users/routes.ts:13`). Correct.
  - **(d) Budget <2s** — trivially met (single sub-ms scan per endpoint).
  - **RESOLVES the carried B-22 OPEN item (Slice-1 ledger lines 56-58):** the dedicated lightweight options endpoint that
    removes BOTH the `limit=200` truncation risk AND the full-row payload is now built. Item closed.

## OPEN items (carry forward) — appended 2026-06-06 (Slice 1B)
- **B-22 RESOLVED:** dedicated `/options` feeds replace `?active=true&limit=200`+`.items` on all 9 dropdown feeders; no
  truncation, smaller payload, USABLE-only. The Slice-1 truncation OPEN is closed.
- **RATCHET (users `/options` cap — the one growth risk):** clients/products/VU are fixed-size master data (will not grow
  to need a cap). `users` is the only one that could plausibly grow (every field agent is a user). At a few-hundred users
  the unpaginated feed is fine; if a deployment ever reaches ~thousands of users, the reports-to picker should switch to a
  typeahead/server-search (cursor) rather than loading all. Not present at current scale — carry, do not act now.
- **NOTE (no index needed now):** clients/products have no `is_active` index and don't need one at this volume; revisit only
  if these reference tables ever exceed ~5k rows (same boundary as the small-table sort-index ratchet, lines 218-220).

- **2026-06-06 · Slice — Server-side column-filter contract (`resolveFilters` + clients/products `columnFilters`)** — **VERDICT: PASS.**
  - **(a) Leading-wildcard ILIKE on tiny reference tables — ACCEPTABLE now, no index.** Text filters emit `col ILIKE '%value%'` (clients repository.ts:40-43, products :38-43) on `clients.code`/`name` and `products.code`/`name`. A leading `%` defeats btree, forcing a seq-scan — but clients/products are fixed-size master data (dozens of rows; same disposition as the Slice-1B `/options` and small-table sort-index calls). A full seq-scan + ILIKE filter at this cardinality is sub-millisecond; a trigram GIN here would be pure write/maintenance overhead with zero read benefit. Proportionate.
  - **(b) Query count unchanged — no N+1.** Column filters add WHERE predicates to the EXISTING COUNT+items pair (shared `where`/`params`); still exactly 2 queries per list call, no per-row work, no new join. Budget <2s trivially met.
  - **(c) RATCHET (carried-forward, the real growth risk):** this generic filter contract is designed to roll to the grid UI and then to LARGE operational tables (cases, locations 157k). When a `filterMap` is added to those, every leading-wildcard text filter column (case_number, applicant name, location name/path, etc.) WILL need a `gin_trgm_ops` index — exact precedent: migrations 0020/0021 added `idx_cases_case_number_trgm` + `idx_applicants_name_trgm` for the global-search ILIKE. enum filters (`= $N` on indexed status/active cols) are fine. **Gate: before merging any cases/locations filterMap, pair each text filter column with a trgm GIN migration (triple-write) and EXPLAIN-confirm the bitmap scan on a seeded large dataset.** Until then this slice (clients/products only) is index-free by design.
  - **(d) No EXPLAIN needed at this scale** — clients/products too small for the planner to prefer any index; index SELECTION isn't provable and isn't required here.

- **2026-06-06 · B-4 Excel-style header multi-select (§7) — enum `kind = ANY($n)` + `filterClauses` refactor** — **VERDICT: PASS.**
  - (a) **`kind = ANY($n)` on `verification_units` is free** — table is tiny (~dozens of rows); a seq-scan is optimal and a partial index already exists (`0001 idx_verification_units_kind WHERE is_active`) which the planner MAY use for the active-filtered path. No regression, no EXPLAIN needed at this cardinality.
  - (b) **Query count unchanged — no N+1.** The refactor swaps an inline loop for `filterClauses` building the SAME number of WHERE predicates against the SAME shared count+items pair → still exactly 2 queries per list call, no per-row work, no new join. The multi-value `IN` collapses to one bound array param (one `$n`), not N predicates.
  - (c) **No regression for clients/products** — text ILIKE behavior is byte-identical (same `%v%` bind, same `ILIKE` op), just routed through `filterClauses`; both tables remain small enough that the leading-wildcard ILIKE is a sub-ms seq-scan (index-free by design).
  - (d) **RATCHET (carried-forward, unchanged):** when this filter contract rolls to LARGE operational tables (cases ~? / locations 157k), every leading-wildcard text filter column needs a `gin_trgm_ops` index (precedent 0020/0021) AND must be EXPLAIN-confirmed on a seeded dataset before merge. enum filters (`= ANY` / `=` on indexed status/kind/active cols) stay fine. This slice (clients/products text + VU enum) is index-adequate today.

- **2026-06-06 · Slice — Column-filter rollout to the 5 remaining lists (users · report-templates · locations · rates · cases)** — **VERDICT: PASS.**
  - **(a) locations f_pincode/area/city/state — trgm-GIN-backed, the only large table (157k catalog) → fast.** All four columns have `gin_trgm_ops` indexes from migration 0020 (`idx_locations_{pincode,area,city,state}_trgm`, 0020:12-15). A leading-wildcard `col ILIKE '%v%'` (emitted by `filterClauses`) is exactly what pg_trgm GIN accelerates — the planner does a trigram bitmap scan, not a seq-scan, on the 157k rows. Matches the live evidence cited in the brief (`f_state=mahar` → 12754 rows fast). **This is the slice that satisfies the RATCHET I gated in the clients/products + B-4 entries** (no large-table text filter merges without a paired trgm index) — locations is index-adequate. ✅
  - **(b) cases f_caseNumber/primaryName — trgm-GIN-backed (0021); f_status — equality on a tiny low-cardinality col.** `cs.case_number` → `idx_cases_case_number_trgm` (0021:22), `pa.name` → `idx_applicants_name_trgm` (0021:23) — both back the leading-wildcard ILIKE the filter emits, same precedent as the global search. RATCHET SATISFIED for cases too. `cs.status` filter is `= $n` on a 4-value enum col; `idx_cases_status` exists (0010:30) but at low cardinality the planner may prefer seq-scan + filter — fine either way; cases is small today (proactive growth posture). The lean COUNT filter runs over `cases cs LEFT JOIN case_applicants pa` only (no cl/p joins, no per-row subqueries) so the filtered count stays cheap.
  - **(c) rates joined-column filters — small tables, free.** `vu.kind` (enum `= ANY`), `vu.name`, `l.pincode`, `l.area`, `r.rate_type` filter against the shared `RATE_FROM` join graph. verification_units is dozens of rows (a partial `idx_verification_units_kind WHERE is_active` exists, 0001), rates is small, the locations join is by PK (`l.id = r.location_id`). At this cardinality the joins + filter are sub-ms; the `l.pincode/l.area` ILIKE here is on the SMALL joined set (rows already constrained by the rate join), NOT the 157k catalog, so no trgm index needed on this path. Query count unchanged (2 per call). ✅
  - **(d) users / report-templates — tiny reference tables, status/type equality or text on dozens of rows.** users (dozens–low-hundreds) `u.username`/`u.name` ILIKE + `u.role` enum-IN; templates (~180) `code`/`name` ILIKE + `template_type` enum. Sub-ms seq-scan + filter; an index would be pure write overhead (consistent with the standing small-table disposition). No N+1, no new join — filters add predicates to the EXISTING shared count+items pair.
  - **No hot path needs a new index in this slice.** RATCHET (large-table text filters need trgm) is RESOLVED for the two large/operational tables it applied to (locations via 0020, cases via 0021). Budget <2s trivially met across all 5. Triple-write N/A (no new DDL — relies on the already-applied 0020/0021).
  - **CARRY (unchanged):** non-default sortable cols on cases (clientName/productName/primaryName/updatedAt) unindexed for full-list ORDER — add only if a non-default sort becomes hot. `cs.status` filter unindexed-in-practice but tiny — note only if cases volume climbs and status filtering becomes hot (RATCHET, not a gap today).

- **2026-06-07 · B-13 DataGrid Export — synchronous CSV/XLSX, modes `current`+`all` (clients/products) (uncommitted)** — **VERDICT: PASS.**
  - **(a) Boundary / threshold guard — CORRECT, `≥` is the right operator.** `assertExportable(totalCount)` throws 413 when `totalCount >= threshold` (`platform/export/index.ts:47-56`; `EXPORT_JOB_THRESHOLD` default 10000, `packages/config/src/index.ts:19`). mode=`all` fetches `repo.list({ limit: exportThreshold(), offset: 0 })` (`clients/service.ts:70-73`, `products/service.ts:71-74`). Traced the three boundary cases against the COUNT+SELECT pair: **9999 rows** → LIMIT 10000 returns 9999, `9999>=10000` false → exports all 9999 (complete); **exactly 10000** → LIMIT returns 10000, `10000>=10000` TRUE → 413, fetched rows discarded; **10001** → LIMIT caps at 10000 but `totalCount=10001` (the COUNT is unaffected by LIMIT) `>=10000` TRUE → 413. **The synchronous path therefore only ever streams `< threshold` rows — a truncated/incomplete "all" can NEVER leave the server.** `≥` (not `>`) is mandatory here: with `>` a result of exactly 10000 would slip through but the LIMIT-10000 fetch can't prove there isn't a 10001st row, so `≥` is the only leak-safe choice. ✅
  - **(b) "Fetch up-to-10000 then maybe discard" — ACCEPTABLE.** The wasted fetch happens ONLY on the 413-reject path (`totalCount>=10000`); every SUCCESS path fetches exactly the rows it streams. So the boundary "discard" is not a steady-state cost — it's a one-shot read on an oversized export that's being rejected anyway. A pre-COUNT-then-fetch would save that one rejected read but adds a round-trip to every success; not worth it. The fetch is bounded (hard LIMIT 10000), no unbounded scan. ✅
  - **(c) No N+1, reuses the PASS-audited list pair.** `exportData` calls the SAME `repo.list` (single COUNT + single LIMIT/OFFSET SELECT) already audited PASS in the DataGrid slices — exactly 2 SQL round-trips, no per-row work, no new join, no `SELECT *`. mode=`all` reuses the same `search`/`columnFilters`/`sortColumn` resolution as the grid (`resolvePage`+`resolveFilters`), so the export rides the SAME indexes the list does (clients/products are tiny → seq-scan, fine). Note: mode=`all` passes `exportThreshold()` (10000) straight to `repo.list`, deliberately BYPASSING the `limit≤500` pagination cap (`pagination.ts:42`) — correct: that cap guards the interactive list API, not the export ceiling, which is the SEPARATE 10000 job-threshold guard. ✅
  - **(d) XLSX memory at ~10k×6 — ACCEPTABLE for the synchronous tier.** `toXlsx` (`format.ts:55-69`) builds the WHOLE exceljs `Workbook` in memory then `writeBuffer()` → one `Buffer` held entirely in RAM (no streaming). Worst case = 9999 rows × 6 short master-data cols (code/name/effectiveFrom/createdAt/updatedAt/status) — exceljs cell objects are heavy (~1–2KB/cell incl. styling/shared-strings overhead) → order ~60–120MB transient peak per concurrent XLSX export, GC'd after `res.send`. Bounded by the 10000 ceiling and master-data low concurrency (admin-only screens). exceljs is lazy-imported only on the XLSX path (`format.ts:61`) so CSV exports never pay it. Within budget for THIS tier; do NOT stream here. ✅
  - **(e) Budget** — clients/products are dozens of rows today, so a real `all` export is sub-second. The 10000-row ceiling is a proactive guard, not a present cost.
  - **DEFERRED (correct per freeze):** the `≥10000 → report-worker background job` tier is NOT built (`assertExportable` throws 413 instead of enqueuing). This is the right call for the synchronous slice — flagging the ratchet below for when it lands.

## OPEN items (carry forward) — appended 2026-06-07 (B-13 Export)
- **RATCHET (streaming XLSX) — for the report-worker job tier when it lands.** The synchronous `toXlsx` buffers the whole workbook in RAM (`format.ts:68`). At the job tier (≥10k, potentially 100k+ rows on cases/locations) the in-memory `Workbook`+`Buffer` will blow memory. The job worker MUST use exceljs **streaming** (`WorkbookWriter` → write to a temp file / pipe to object storage) or stream CSV row-by-row, NOT the buffered builder. CSV (`toCsv`, `format.ts:47-52`) also array-joins the whole file in memory — same streaming requirement at the job tier. The synchronous builders here are fine BECAUSE the 10000 ceiling caps them; remove that ceiling only together with streaming.
- **RATCHET (export-all indexes on large tables) — when export rolls past master-data.** B-13 today is clients/products only (tiny, index-free by design). When `mode=all` export is enabled on **locations[157k] / cases[unbounded]**, an `all` export with a non-default sort (e.g. sort by city / created_at) fetches up to 10000 rows ORDER BY an UNINDEXED column → top-N heapsort over the whole table per export. The default-sort + search paths are already indexed (0020/0021); the non-default-sort export is the gap. Gate: before enabling `all`-export on locations/cases, confirm the offered export sort columns are index-backed (or restrict export sort to the indexed default), and EXPLAIN-confirm the `LIMIT 10000` fetch on a seeded large dataset. This is the SAME non-default-sort carry already open for those tables, now also reachable via export.

- **2026-06-15 · B-13 EXPORT-as-job slice (ADR-0030) — `platform/export/job.ts` (NEW, `MAX_EXPORT_ROWS=100_000`) + `locations.exportAllForJob` (no page window) + in-process job execution (no BullMQ yet) + `registerJobs.ts` (uncommitted). VERDICT: PASS (2 RATCHETs carried for the streaming-builder + BullMQ-worker follow-ups; no BLOCK, no FLAG today).** This is the realization of the two RATCHETs the 2026-06-07 B-13-sync entry already filed — assessed against them.
  - (1) ✅ **Whole-result-set buffered in RAM — ACCEPTABLE at the 100k cap, but it IS the memory ceiling.** `buildExportFile` (job.ts:24-37) buffers the ENTIRE file: CSV = `Buffer.from(toCsv(rows, selected))` (array-joins the whole file in memory, format.ts:47-52), XLSX = `toXlsx` (builds the WHOLE exceljs `Workbook` then `writeBuffer()`, format.ts:55-69). At `MAX_EXPORT_ROWS=100_000` (job.ts:19): the measured 157k-locations→100k CSV = ~13MB / ~2.3s (per the brief's verified figure) — a 13MB transient `Buffer` is trivial. **XLSX is the real concern**: exceljs cell objects are heavy (~1-2KB/cell incl. shared-strings/styling) → 100k rows × 9 location cols ≈ 900k cells → order **0.9-1.8GB transient peak** per concurrent XLSX job before `writeBuffer()` GCs. For the IN-PROCESS (api role) path this peak competes with live request-handling heap → a couple of concurrent 100k-row XLSX exports could OOM or GC-thrash the api process. ACCEPTABLE TODAY because: (a) locations export is admin-only / low concurrency, (b) the realistic locations CSV is the common path (13MB), (c) the cap bounds it. But the XLSX-at-100k buffered peak is exactly why the streaming-builder RATCHET (below) must land before this rolls to high-volume/high-concurrency resources. ✅ for this slice, WATCH on XLSX.
  - (2) ⚠️ **100k cap SILENTLY truncates 157k→100k — correctness/UX gap, not a perf defect.** `exportAllForJob` (locations/service.ts:162-178) fetches `limit: exportJobRowCap()` = 100_000 with NO total-count check and NO truncation signal — a 157k-row catalog export returns the first 100k by sort order and the user has NO indication 57k rows were dropped (the job SUCCEEDS, `rowCount: 100000` in the result, no warning flag). Performance-acceptable (bounded fetch, no blow-up) but a real UX/correctness gap. **NOTE for the streaming-builder follow-up:** when the streaming builder lifts the buffered-memory constraint, either (a) raise/remove the cap so the full set exports, or (b) surface a `truncated:true` + `totalCount` in the job result so the FE can warn "showing first 100k of 157k". Recorded, not blocking. ⚠️
  - (3) ✅ **Single 100k-row query, no batching — fast on the DEFAULT sort (indexed), top-N heapsort risk on NON-DEFAULT sorts (the carried RATCHET).** `exportAllForJob` issues ONE `repo.list({ limit:100000, offset:0, sortColumn:r.sortColumn })` (locations/service.ts:167-176) — no batching/cursor, one round-trip + one ~13MB transfer. **Default sort (pincode)** is index-backed by `idx_locations_pincode_sort (pincode,id)` (0020, per this ledger's 2026-06-07 location entry) → an Index Scan, NO sort node, even for `LIMIT 100000` — fast (the brief's ~2.3s incl. CSV build). **Non-default sorts** (city/state/area/createdAt/updatedAt/effectiveFrom — all in `LOCATION_PAGE_SPEC.sortMap`): `effective_from` is covered (0015), but **city/state/area/created_at/updated_at have NO covering sort index over the unfiltered 157k catalog** → `ORDER BY <unindexed> LIMIT 100000` = top-N heapsort over the WHOLE table per export (the planner can't index-walk). This is EXACTLY the "export-all non-default-sort heapsort" RATCHET filed 2026-06-07 — now reachable through the job path at 100k (worse than the 10k sync ceiling). No full-scan for the indexed default + trgm-search paths; the gap is the non-default sort. **GATE (carry):** before high-volume non-default-sort exports, either restrict export sort to indexed columns or add covering sort indexes (triple-write) + EXPLAIN-confirm the `LIMIT 100000` fetch on the seeded 157k dataset. ✅ for the default-sort common path today.
  - (4) ⚠️ **In-process execution runs in the api EVENT LOOP — a 100k CSV/XLSX build BLOCKS it; this is THE reason B-7.2 (BullMQ worker) matters.** With no `REDIS_QUEUE_URL`, `enqueue` runs `runJob` in-process on the next tick (jobs/index.ts:123-137) — so `buildExportFile` executes inside the api process. `toCsv` (synchronous array-join over 100k rows) and exceljs `addRow`×100k + `writeBuffer()` are CPU-bound SYNCHRONOUS work on the main thread → the event loop is BLOCKED for the build duration (~2.3s measured for the 100k CSV; XLSX materially longer). During that window the api serves NO other requests (health checks, list calls, logins all stall). ACCEPTABLE as a SHIP-NOW posture ONLY because: it's after the HTTP response (the enqueue request already returned 202, jobs/index.ts comment), locations export is admin/low-concurrency, and it's explicitly the documented degraded path until the worker lands. **But this is precisely the justification for B-7.2:** moving job execution out-of-process onto a BullMQ worker (Valkey) is REQUIRED before export volume/concurrency grows, otherwise every large export is an api-wide latency spike. FLAGGED as the reason B-7.2 is not optional — recorded as a RATCHET, not a BLOCK (the in-process path is the intended, documented interim per ADR-0030). ⚠️
  - DISPOSITION: **PASS** for this slice (locations, admin-only, default-sort common path, 13MB CSV). No BLOCK, no FLAG today. The slice correctly realizes the deferred job tier the 2026-06-07 sync entry anticipated. **CARRIED RATCHETS (both pre-filed 2026-06-07, now ACTIVE):** (R1 — streaming builder) the buffered `toCsv`/`toXlsx` at 100k must move to streaming (`WorkbookWriter`/row-by-row CSV → temp-file/object-storage pipe) before XLSX-at-100k or high concurrency — the buffered XLSX peak (~1GB+) is the memory ceiling; pair the cap-lift/`truncated` signal (point 2) with it. (R2 — out-of-process worker, B-7.2) in-process build blocks the api event loop (~2.3s+/100k) — BullMQ+Valkey worker REQUIRED before volume grows. (R3 — export-all non-default-sort indexes) restrict export sort to indexed cols OR add covering sort indexes (triple-write + EXPLAIN on seeded 157k) before high-volume non-default-sort exports. All three gate the SAME follow-up (the report-worker job tier); locations-default-sort-CSV is within budget now.

## Log
- **2026-06-16 · ADR-0036 BILLING SLICE 5d — rate+commission LATERALs (`platform/billing/laterals.ts` NEW) wired into the Pipeline (tasks) read-model: list SELECT, list COUNT, stats commissionable count (uncommitted). VERDICT: PASS.** Two chained `LEFT JOIN LATERAL … LIMIT 1` (RATE_LATERAL→COMMISSION_LATERAL, the second references `rt.rate_type` so it is correctly placed AFTER the first). Audited adversarially against the 5b carry and the standing budgets.
  - **(a) LIST bounding — CORRECT, laterals run per-RETURNED-row only, gated on billing.** The row SELECT uses `TASK_FROM_BILLING` (TASK_FROM + both laterals) ONLY when `billing` is true (`repository.ts` list: `selectFrom = billing ? TASK_FROM_BILLING : TASK_FROM`); non-billing actors get plain `TASK_FROM` + `NULL::float8` amount cols — laterals never enter the plan. `billing` is set from `canViewBilling` (controller: `grantsAll || permissions.includes(BILLING_VIEW)`), so FIELD_AGENT/TEAM_LEADER (case.view, no billing.view) pay ZERO lateral cost. **The laterals execute once per ROW EMITTED, and the row set is hard-bounded by the paginated `LIMIT $N OFFSET $N` (cap ≤500 enforced at `pagination.ts:42`)** — Postgres applies the LATERAL after the join+filter+sort+limit pipeline produces the page window, NOT over the full scoped set. So ≤500 lateral pairs per list call, each a `LIMIT 1` index probe. The amount cols are deliberately NOT in `TASK_PAGE_SPEC.sortMap` (comment confirms "NOT sortable") → the ORDER BY never forces the laterals to materialize over the whole set to sort on a derived amount. ✅ Bounded correctly.
  - **(b) LIST COUNT — CORRECT, stays lateral-free unless commissionable is active.** `countFrom = commissionable ? TASK_FROM_BILLING : TASK_FROM`. The default/most-common COUNT (no commissionable filter) runs over plain TASK_FROM — no lateral, no regression vs the pre-5d COUNT. The lateral COUNT only fires when the actor BOTH holds billing.view AND ticks the commissionable bucket (`commissionable = billing && !!o.commissionable` — the normalize makes a stray flag inert without its lateral, good). In that path the COUNT lateral IS over the full filtered set (no LIMIT on a COUNT) — see (e) for the bound. ✅ for the common path; the commissionable COUNT is the one unbounded-by-page case, addressed in (e).
  - **(c) STATS — existing buckets UNCHANGED, commissionable isolated + PRE-FILTERED. Pre-filter IS effective.** The status/SLA aggregate (`count(*) FILTER (…)`) is byte-identical over plain `TASK_FROM` — zero regression to pending/assigned/in_progress/completed/revoked/out_of_tat/total. Commissionable is a SEPARATE second query, run ONLY when `o.billing`, over `TASK_FROM_BILLING` with `cWhere = <scope/filter clause> AND ct.status = 'COMPLETED' AND com.commission_amount IS NOT NULL`. **The `ct.status='COMPLETED'` pre-filter IS planner-effective: `ct.status` is a base-relation column on `case_tasks` (the driving table), and the LATERAL is a correlated join — Postgres evaluates base-relation restriction quals on `ct` BEFORE the nested-loop LATERAL fires for that row** (the lateral is the inner side of a nested loop; a row that fails `ct.status='COMPLETED'` is discarded at the scan/filter node and never drives a lateral probe). `idx_case_tasks_status (status)` (0010:72) is available to pre-restrict to COMPLETED rows before the loop. So the rate+commission resolution runs only over COMPLETED rows in scope, NOT the whole pipeline. ✅ Pre-filter confirmed effective.
  - **(d) Indexes — the two resolver indexes EXACTLY cover the laterals; nothing missing for the lateral probes.** RATE_LATERAL filters `client_id, product_id, verification_unit_id, is_active` + temporal, ordered by a location-specificity ladder → `idx_rates_resolve ON rates (client_id, product_id, verification_unit_id, location_id) WHERE is_active` (0013:35) is a partial composite whose leading cols match the equality predicate and whose trailing `location_id` matches the ORDER BY ladder's tiebreak — a tight index range scan per probe, `LIMIT 1` stops early. COMMISSION_LATERAL filters `user_id, rate_type, client_id(nullable), is_active` + temporal → `idx_commission_rates_resolve ON commission_rates (user_id, rate_type, client_id) WHERE is_active` (0058:48) matches exactly (`ORDER BY client_id DESC` rides the index col). Both partials match the `is_active` predicate the laterals carry. **Nothing missing for the lateral resolution itself.** ✅
  - **(e) 5b CARRY re-confirmed + 5d's effect on its urgency — partial `(completed_at)` index is NOT the right shape for 5d; a partial-on-status would help the commissionable COUNT.** 5b prescribed `partial idx_case_tasks(completed_at) WHERE status=COMPLETED` keyed to the DATE-WINDOW cost (the per-task double-LATERAL tracking a date range). **5d does NOT filter `completed_at`** — both the list commissionable filter and the stats commissionable COUNT filter `ct.status='COMPLETED'` (no date window). So 5d does NOT raise the urgency of the `completed_at` partial index (the date-window driver from 5b is absent here). What 5d's commissionable COUNT actually wants is to cheaply enumerate COMPLETED rows in scope before the lateral loop — `idx_case_tasks_status (status)` (full btree, 0010:72) already serves `status='COMPLETED'` equality. **A PARTIAL index `WHERE status='COMPLETED'` would be marginally tighter** (skips the non-completed bulk, smaller index, and as the pipeline fills with non-completed tasks the selectivity of the full status index on the COMPLETED value degrades less) — recommend it as a low-pri ratchet IF the commissionable bucket/stats becomes a hot, frequently-refreshed path at scale. NOT needed today (status btree adequate; COMPLETED is a meaningful fraction so the full index is fine). The 5b `completed_at WHERE status=COMPLETED` carry remains OPEN for the date-windowed billing read-model (its original driver), unaffected by 5d.
  - **(f) N+1 / fan-out — NONE. Both laterals `LIMIT 1` → strict 1:1, COUNT/SUM stay exact.** Each LATERAL returns at most one row (`LIMIT 1`), `LEFT JOIN … ON true` → the parent row is emitted exactly once whether or not the lateral matched (NULL amount on no-match). No row multiplication → `count(*)` over `TASK_FROM_BILLING` equals `count(*)` over `TASK_FROM` for the same WHERE (the laterals can only NULL-extend, never fan out). The commissionable COUNT's `com.commission_amount IS NOT NULL` correctly counts the matched subset without double-counting. One SQL round-trip per query (list = COUNT + page = 2; stats = base agg + optional commissionable = ≤2). No app-layer loop. ✅
  - **(g) Unbounded scan — ONE bounded-by-completed-count path, ACCEPTABLE now, RATCHET at scale.** The list SELECT laterals are page-bounded (≤500). The list COUNT and the stats commissionable COUNT have NO pagination → the lateral resolution runs over EVERY COMPLETED row in the actor's scope (the pre-filter (c) bounds it to COMPLETED, not the whole pipeline, but there is no LIMIT). At small/medium completed-task volume this is sub-second (each lateral is a `LIMIT 1` index probe on the two resolve indexes). **At scale (tens of thousands of COMPLETED tasks in one scope — e.g. a super-admin/manager with a wide subtree refreshing the bucket bar), the commissionable COUNT does N index-probe pairs where N = completed-in-scope** — a real cost on a frequently-polled stats endpoint. Bounded (no fan-out, indexed probes) so no blow-up, but it is the one 5d path whose cost grows with data, not page size. **GATE (carry):** if the Pipeline stats/commissionable bucket becomes a hot polled path at high completed-volume, (1) add the partial `WHERE status='COMPLETED'` index from (e) to tighten the COMPLETED enumeration, and/or (2) consider a materialized/cached commissionable count rather than resolving rate+commission laterals live on every stats poll. EXPLAIN ANALYZE on a seeded large-completed dataset (DB auditor) to confirm the commissionable COUNT uses nested-loop-with-index-probe (not a hash/materialize of the whole rates table). NOT a blocker today.
  - **(h) Budget <2s** — met: non-billing actors pay nothing (lateral-free); billing actors pay ≤500 `LIMIT 1` index probes on the page + (only if commissionable ticked) one scope-bounded COMPLETED COUNT. All probes index-backed (d). Within budget at current volume.
  - DISPOSITION: **PASS.** No BLOCK, no FLAG. Lateral bounding is correct (page-bounded SELECT, billing-gated, pre-filtered stats COUNT, exact 1:1 no-fan-out), resolver indexes exactly cover the probes, existing buckets unregressed. One perf CARRY for the engine/scale follow-up below.
  - **⚠️ OUT-OF-CHARTER HAND-OFF (correctness, NOT perf — for whoever owns tasks/export): the `exportData` repo.list spread DROPPED the `assignedTo` filter.** `service.ts:185-199` — the pre-5d export passed `...(d.assignedTo !== undefined ? { assignedTo: d.assignedTo } : {})`; the 5d edit replaced that exact line with the `commissionable`/`billing` spreads and did NOT re-add `assignedTo`. Net: exporting the Pipeline while filtered by assignee now ignores the assignee filter and exports the whole scoped set (still scope-safe, but wrong rows). `d.assignedTo` is still computed in `domainParams` and still used by `list()`/`stats()` — only `exportData` lost it. Likely an accidental line-replacement, not intentional. Performance-neutral (no extra cost), so PASS stands on the perf axis — flagging to Correctness/Backend reviewer to restore the line.

## OPEN items (carry forward) — appended 2026-06-16 (Slice 5d)
- **CARRY (5d commissionable-COUNT at scale):** the list-COUNT-when-commissionable and the stats commissionable COUNT resolve the rate+commission laterals over EVERY COMPLETED row in scope (no page bound; pre-filtered to COMPLETED, indexed `LIMIT 1` probes → no fan-out, no blow-up). Bounded by completed-in-scope count. If the Pipeline stats/commissionable bucket becomes a hot polled path at high completed-volume (wide-subtree SA/MGR), add a partial `idx_case_tasks (…) WHERE status='COMPLETED'` to tighten COMPLETED enumeration AND/OR cache/materialize the commissionable count instead of live lateral resolution per poll. EXPLAIN-confirm nested-loop-index-probe (not a rates-table hash) on a seeded large-completed dataset. Not present today.
- **5b CARRY re-stated (UNAFFECTED by 5d):** the `partial idx_case_tasks(completed_at) WHERE status=COMPLETED` from 5b is keyed to the DATE-WINDOW billing read-model (per-task double-LATERAL over a date range). 5d filters `status`, not `completed_at`, so 5d does NOT raise that index's urgency. It stays OPEN for the date-windowed billing read-model, its original driver.
- **NOTE (resolver indexes adequate):** `idx_rates_resolve` (0013, partial WHERE is_active) and `idx_commission_rates_resolve` (0058, partial WHERE is_active) exactly cover the two laterals' equality+ladder/tiebreak predicates. No new index needed for the lateral probes themselves.
