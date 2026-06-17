# Pagination, Loading Experience & Long-Running Operations Standards (CRM2)

> **Permanent UX & scalability freeze (2026-06-05).** No redesign · no architecture change · no
> data-model change. This document is the **single source of truth** for pagination, loading
> perception, user feedback, and long-running operations. All list pages, APIs, loaders, and
> exports MUST comply. Cross-linked from: `ACS_CRM_2.0_MASTER_MEMORY.md` (§7.6 + status),
> `docs/ENGINEERING_STANDARDS.md`, `docs/DESIGN_AND_STACK_FREEZE.md`, `PERFORMANCE_STANDARDS.md`,
> `UI_STANDARDS.md`, `BUILD_GUIDE.md`, `AGENT_RULES.md`, `docs/MANAGEMENT_LIST_STANDARD.md`,
> `docs/CI_CD_STANDARDS.md`, `PROJECT_INDEX.md`.

---

## 1 — Pagination standard (server-side, mandatory)

**Every list page uses server-side pagination.** No endpoint may return unlimited rows.

Mandatory for: Dashboard widgets · Pipeline · Cases · Tasks · Verification Units · Users ·
Billing · Commission · MIS · Reports · Audit Logs · Notifications · Attendance · Field
Monitoring · Client Management · Product Management · Location Management · Rate Management ·
Templates.

**Required query parameters** (one standard, every list endpoint):

| Param | Type | Notes |
|---|---|---|
| `page` | int ≥ 1 | 1-based page number |
| `limit` | int | page size — one of the allowed sizes below |
| `search` | string | free-text; server decides searchable columns |
| `sortBy` | string | a whitelisted sortable column |
| `sortOrder` | `asc` \| `desc` | default `asc` |
| `filters` | object (JSON / repeated params) | domain filters; server-whitelisted |

## 2 — Page-size rules

- **Default: `25`.**
- **Allowed: `25`, `50`, `100`, `200`.**
- **Extended maximum: `500`** — MIS / reporting only.
- **Above 500: FORBIDDEN.** A request for more than 500 must instead require **filters** OR an
  **export** (background job, §5). Servers clamp/`400` anything over the cap; never return
  unlimited rows.

Intent: 25 = default operational · 50 = medium · 100 = power users · 200 = heavy review ·
500 = MIS/reporting.

## 3 — Search-first design

Users must **not** click through Page 1 → Page 2 → … → Page 1000. Every major screen supports
**search + filters + sorting**. The expected workflow is:

```
50,000 rows  →  filter  →  ~200 rows  →  paginate
```

Pagination is the tail of a narrowing flow, never the primary navigation.

## 4 — API response envelope (single standard)

All list APIs return exactly this shape (no custom pagination formats):

```jsonc
{
  "items":      [ /* the page rows */ ],
  "totalCount": 50234,      // total rows matching search+filters (pre-pagination)
  "page":       1,          // echoed
  "pageSize":   25,         // = the request `limit`, echoed
  "totalPages": 2010,       // ceil(totalCount / pageSize)
  "sort":       { "sortBy": "createdAt", "sortOrder": "desc" },
  "filters":    { /* echoed applied filters */ }
}
```

> Request uses `limit`; the response echoes it as `pageSize`. This is intentional and uniform.

## 5 — Export strategy (never paginate exports)

Exports do **not** use pagination. Exports run as **background jobs**: MIS Export · Billing
Export · Commission Export · Audit Export · Report Export. Process:

```
generate file  →  store file  →  notify user  →  allow download
```

Any "give me everything" request becomes an export job, not a large page.

## 6 — Loading-experience time bands

| Elapsed | Behaviour |
|---|---|
| **0–300 ms** | **No loader.** Avoid flicker. |
| **300 ms – 1 s** | **Skeleton loading only.** |
| **1 s – 3 s** | Animated loader **+ percentage**. |
| **3 s – 8 s** | Animated loader **+ percentage + current-operation text** (e.g. "Fetching Cases — 64%", "Generating Report — 78%", "Preparing MIS Export — 43%"). |
| **> 8 s** | Becomes a **background job** (§10). |

## 7 — Loader design standard

**Forbidden:** spinning circles · old-style progress bars · bouncing dots.

**Required:** a **modern geometric loader — the Hexagon Loader.** It displays the **current
operation**, **percentage complete**, and an optional **sub-step**. Example:

```
Generating Report
74%
Building PDF
```

## 8 — Real progress tracking (no fake percentages)

Percentages MUST reflect actual work stages — never an animated guess. Canonical stage maps:

- **Report generation:** 10% Loading Case · 25% Loading Tasks · 40% Loading Photos · 60%
  Building Template · 80% Rendering PDF · 100% Complete.
- **MIS export:** 15% Loading Data · 35% Applying Filters · 55% Calculating Metrics · 75%
  Building Excel · 100% Ready.
- **Case creation:** 20% Validation · 40% Creating Case · 60% Creating Tasks · 80% Financial
  Snapshot · 100% Complete.

## 9 — Table loading (skeleton rows)

Tables use **skeleton rows**. Never an empty white screen; never a large blocking spinner.
Skeleton rows are mandatory for: Pipeline · Cases · Tasks · MIS · Billing · Reports · Users
(and every list table by extension of §6).

## 10 — Long-running operations (> 8 s → background job)

Any operation expected to exceed **8 seconds** MUST become a background job: PDF generation ·
MIS export · Billing export · Commission export · bulk imports · bank-API batch sync · report
regeneration. **The user must be able to keep working** while it runs.

## 11 — Background-job UX

While a job runs, show: `Preparing Export — 67%` · "You may continue working." · "Notification
will be sent when complete." Completion is delivered via the **Notification Bell**, a **Toast**,
and an **In-App Notification** (optional **Email**).

## 12 — Performance budgets

| Surface | Budget |
|---|---|
| Dashboard | < 2 s |
| Pipeline | < 2 s |
| Case open | < 2 s |
| Task Workspace | < 2 s |
| MIS filters | < 3 s |
| Exports | background job |

## 13 — Database requirements

Every paginated endpoint MUST: use **indexes** on the sort/filter columns · **avoid full table
scans** · **avoid `SELECT *`** (return only required columns) · have its **query plan reviewed**.
Count and page queries are parameterized and index-backed.

## 14 — Machine enforcement (CI gates)

Automated tests fail CI when standards are violated:

- **Pagination validation** — every list endpoint accepts `page/limit/search/sortBy/sortOrder/
  filters` and returns the §4 envelope; rejects `limit > 500`.
- **Query-count validation** — a paginated request issues a bounded number of queries (count + page).
- **N+1 detection** — list endpoints must not fan out per-row queries.
- **Performance validation** — endpoints meet §12 budgets against a large seeded dataset.
- **Large-dataset testing** — correctness + bounded latency at 50k+ rows.

These activate per endpoint as it adopts the standard (see `docs/CI_CD_STANDARDS.md`,
pending-activation matrix). CI fails on any violation once active.

## 15 — Compliance & retrofit obligation

The standard is **frozen now**; implementation follows it going forward. Existing list endpoints
built before this freeze (Verification Units, Clients, Products, CPV, Rates, Locations) currently
return capped/unpaginated results and are **non-compliant** — they MUST be retrofitted to §1/§4
before GA. Tracked as a standing obligation in `ACS_CRM_2.0_MASTER_MEMORY.md` §8. No new list
endpoint may ship non-compliant.

---

*Change this frozen standard only via a superseding ADR + CTO + domain-owner sign-off
(`LONG_TERM_PROTECTION.md`).*
