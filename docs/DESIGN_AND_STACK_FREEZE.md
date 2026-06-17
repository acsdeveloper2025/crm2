# CRM2 — Design System & Technology Stack Freeze
**Status:** PERMANENT BASELINE. No UI redesign or tech migration after this. Architecture/workflow/business-model unchanged.

---

## PART 1 — TECHNOLOGY STACK (frozen versions)

| Tech | Version (frozen) | Reason | Risk |
|---|---|---|---|
| **Node.js** | **22 LTS** | current LTS to 2027; max ecosystem stability for a banking app | low |
| **TypeScript** | **5.7+** | latest stable; satisfies + const type params | low |
| **React** | **19** | stable (Dec 2024); Actions, `use`, ref-as-prop | low; shadcn/Radix already compatible |
| **React Router** | **7** | data router, stable; matches v1 (7.x) | low |
| **TanStack Query** | **v5** | server-state standard; no Redux needed | low |
| **Tailwind CSS** | **v4** | new engine, `@theme`, CSS-first tokens; matches v1 | low |
| **shadcn/ui** | **latest CLI** (copy-in, not a dep) | Tailwind v4 + React 19 ready; we own the code | low |
| **Radix UI** | **latest primitives** | a11y primitives under shadcn | low |
| **Prisma** | **REJECTED** (Part 2) | replaced by `pg` 8 + repository + zod | — |
| **PostgreSQL** | **17** | matches v1; partitioning, jsonb, RLS-ready | low |
| **Redis/Valkey** | **Valkey 8** (Redis-compatible) | license-clean (BSD) fork; BullMQ-compatible; Redis 7.4 = fallback | low |
| **Vitest** | **v3** | fast, ESM-native; matches our test-first harness | low |
| **Playwright** | **latest 1.x** | the only E2E we adopt (web flows) | low |
| **pnpm** | **10** | content-addressed; workspace protocol | low |
| **Turbo** | **2** | incremental build + cache across apps/packages | low |
| **Zod** | **3 (latest 3.x)** | the shared contract layer (API+UI+tests); huge ecosystem | Zod 4 migration deferred until `@hookform/resolvers` + tooling settle |
| **OpenAPI tooling** | **@asteasolutions/zod-to-openapi** (emit) + **openapi-typescript** (consume) | one source of truth = our zod; generate the spec, don't hand-write it | low |
| **Docker** | **Engine 27 + Compose v2** | matches v1 deploy box | low |
| **Edge** | **nginx** (frozen infra) | consistency with v1 box + the infra blueprint; Caddy noted as the simpler-TLS alternative if v2 ever gets its own host | low |

**Banned:** no Moment, no Lodash-wholesale, no Enzyme, no CRA, no Webpack-by-hand, no Axios-in-FE (use fetch+sdk), no `react-icons` (use `lucide-react`), no styled-components/emotion (Tailwind only), no Prisma.

---

## PART 2 — PRISMA DECISION

### ❌ **REJECT PRISMA.** Use **raw `pg` + repository pattern + zod contracts + ordered-SQL migrations.**

| Criterion | Verdict for CRM2 2.0 |
|---|---|
| **Performance** | At ~2 writes/sec peak Prisma is fine — but the **hot paths are reads**: recursive-scope CTEs, MIS aggregations, partition-pruned scans. Prisma can't express these → `$queryRaw`. |
| **Migration management** | Our schema needs **partitioning, CHECK constraints, triggers (status-transition + audit-hash), partial-unique indexes** — Prisma Migrate can't model these; you end up hand-writing SQL inside Prisma migrations anyway. Ordered raw SQL is cleaner and already built. |
| **Type safety** | Already covered: **zod contracts** at the boundary + typed repository return shapes + `camelize`. Prisma's generated types duplicate this without the runtime validation zod gives. |
| **Maintainability** | A **half-Prisma/half-`$queryRaw`** codebase is *worse* than one consistent raw-SQL layer. One mental model wins. |
| **Testing** | Ephemeral-PG harness already applies our SQL migrations top-to-bottom (fixes v1's non-restorable-dump gap). Prisma adds a generate step + client mock surface. |
| **Reporting workloads** | Millions of reports + 95-col MIS = window functions, CTEs, lateral joins — **raw SQL territory**, Prisma's weakest area. |
| **Complex queries** | Hierarchical `WITH RECURSIVE`, partition pruning, `ARRAY_AGG FILTER` — all raw. |

**Locked data-access pattern (already shipped):**
```
db/v2/migrations/*.sql        # ordered, forward-only, idempotent (raw SQL)
db/v2/seed/*.sql              # seed
apps/api/src/platform/db.ts        # pg Pool + camelize + query<T>()
apps/api/src/modules/<m>/repository.ts  # raw SQL, typed returns, conflict mapping
apps/api/src/modules/<m>/service.ts     # zod validation + business rules
packages/sdk                 # zod contracts (the type source for API+UI+tests)
```
**Optional upgrade path (not now):** if compile-time SQL safety is later wanted, adopt **Kysely** (typed query builder) *at the repository layer only* — it composes with raw SQL and partitioning, unlike an ORM. Not a Day-1 need.

> **Should CRM2 use Prisma? → NO. LOCKED.**
> Full data-access rules (repository pattern, reporting via views/matviews, raw-SQL policy) → see **`ENGINEERING_STANDARDS.md`**. The hybrid (Prisma-CRUD + views-reporting) was evaluated there and rejected: the integrity-heavy core (CHECK/triggers/partitions on every table), not just reporting, fights Prisma.

---

## PART 3 — DESIGN SYSTEM FREEZE (80% Twenty CRM · 10% Linear · 10% Salesforce)

| Reference | Verdict | What we take / leave |
|---|---|---|
| **Twenty CRM** | **ADOPT** (primary, 80%) | open-source React+Tailwind+Radix; record-centric, data-dense, calm neutral palette, compact tables, left-nav + workspace — our exact shape |
| **Linear** | **BORROW** (10%) | keyboard-first, **command palette**, speed, subtle 120ms motion, tight density, status semantics |
| **Salesforce (Lightning)** | **BORROW patterns / REJECT chrome** (10%) | take enterprise **data-grid** behaviors, status color semantics, bulk actions; **reject** the dated heavy visual chrome |
| **Phantom UI** | **REJECT** | crypto/wallet aesthetic — glassy, gradient, consumer; violates the data-dense/enterprise goal |
| **Notion** | **BORROW typography only / REJECT layout** | calm type scale + spacing; **reject** the whitespace-heavy document layout (wrong for a data-dense CRM) |

**Design goals locked:** professional · data-dense · fast · enterprise · low cognitive load · long-hour comfort.
**Banned aesthetics:** neobrutalism, glassmorphism, heavy gradients, Dribbble effects, decorative animation. Motion only for state feedback (≤150ms).

---

## PART 4 — THEME SYSTEM (design tokens)

CSS-variable-first (shadcn convention, HSL), consumed via Tailwind v4. **Light = default; dark = optional.** Implemented in `packages/ui-theme` (Part 8).

**Token groups:** `background/foreground · card · popover · primary · secondary · muted · accent · border · input · ring · destructive · success · warning · info · chart-1..5 · radius`.
**Typography:** Inter (UI) + JetBrains Mono (codes/IDs). Scale: 12/13/14(base)/16/20/24/30. Line-height 1.4 body, 1.2 headings. Weights 400/500/600.
**Spacing:** 4px base; 4/8/12/16/24/32. Dense tables row-height 36px.
**Radius:** `--radius: 0.5rem` (md); sm 0.375 / lg 0.75.
**Elevation:** 3 only — `sm` (cards), `md` (popovers/dialogs), `lg` (command palette). No decorative shadows.
**Borders:** 1px `--border`; tables use border + zebra-off (hover highlight only).
**Status colors:** success=green-600, warning=amber-500, info=blue-600, destructive=red-600 — semantic tokens, never raw.
**Charts:** `--chart-1..5` categorical, colorblind-safe; no gradients.
**Tables:** 36px rows, sticky header, monospace for codes/amounts, right-align numerics.
**Forms:** label-top, 1.5 line gap, inline error below field, required asterisk via token.

Full token values live in `packages/ui-theme/src/tokens.css` (Part 8).

---

## PART 5 — COMPONENT LIBRARY (shadcn-based catalog)

Components are **copied into `apps/web/src/components/ui`** (shadcn model — we own them), themed only via tokens.

| Component | Usage rule | Variants | A11y |
|---|---|---|---|
| **Button** | one primary per view | primary · secondary · ghost · destructive · outline; sizes sm/md | focus ring, `aria-disabled`, 44px touch |
| **Input** | always inside a Form field | text/number/date; error state | `<label>` association, `aria-invalid` |
| **Select** | <12 options | single | Radix listbox, keyboard nav |
| **Combobox** | ≥12 options / async | searchable | typeahead, `aria-activedescendant` |
| **Dialog** | focused tasks, blocking | sm/md/lg | focus trap, ESC, `role=dialog` |
| **Drawer** | side context (record peek) | right/bottom | focus trap, restores focus |
| **Table** | dense lists | sortable/selectable | `<th scope>`, sort `aria-sort` |
| **Data Grid** | virtualized large sets | pinned cols, bulk | row `aria-selected`, keyboard cells |
| **Card** | grouped content | flat (default), stat | heading hierarchy |
| **Badge** | static label | neutral/kind | text contrast ≥4.5 |
| **Status Chip** | lifecycle state | success/warning/info/neutral/destructive | not color-only (text + icon) |
| **Form** | RHF + zodResolver | — | error summary, focus first error |
| **Alert** | page/section message | info/success/warning/error | `role=alert` for errors |
| **Tabs** | ≤6 sections | underline | `role=tablist`, arrow keys |
| **Breadcrumbs** | deep nav location | — | `aria-current=page` |
| **Pagination** | server lists | numeric + prev/next | `aria-label` per control |
| **Command Palette** | global ⌘K nav/actions | — | combobox semantics, focus return |
| **Search** | scoped list filter | inline/global | `role=searchbox`, debounce 300ms |

Rules: no raw `<button>/<input>` outside these; icon-only buttons need `aria-label`; every async surface has loading/empty/error states (Part 7).

---

## PART 6 — PAGE DESIGN LANGUAGE

**Layout system:** left nav (240px) + content; content = page header + body. Max content width none (data-dense, full-bleed tables). `px-6 py-5`.
**Grid:** 12-col on forms; stat cards `grid-cols-1 sm:2 md:3 lg:5`; workspace = two-pane (evidence left / decision right, sticky).
**Header:** H1 + one-line subtitle (left), primary action (right), optional counter bar (Pipeline/Dashboard).
**Filter:** single row — search (max-w-xs) + ≤4 selects + active-filter chips + Clear; URL is the source of truth.
**Table:** 36px rows, sticky header, status chip + kind badge columns, right-aligned numerics, row actions in an end menu; loading=skeleton, empty=CTA, error=retry.
**Workspace (Task):** two-pane, status-adaptive; never a modal for the core work surface.

Applied to: Dashboard (KPI cards + counter bar) · Pipeline (filter + dense table) · Cases (case header + unit list + applicants) · Task Workspace (two-pane) · MIS & Billing (tabs) · Master Data (list-shell + dialog).

---

## PART 7 — FRONTEND STANDARDS

**Folder structure (improved — feature-first; `pages/` folded into `features/`):**
```
apps/web/src/
├── app/          # shell: providers, router mount, layout, error boundary
├── routes/       # route table (lazy), redirects from v1 paths
├── features/     # one folder per domain: components + hooks + queries + page
│   └── verificationUnits/{VerificationUnitsPage, VerificationUnitDialog, queries, ...}
├── components/   # shared: ui/ (shadcn primitives) + layout/
├── hooks/        # cross-feature hooks (useDebounce, usePermission, useFeatureFlag)
├── lib/          # sdk client, query keys, formatters, fetch wrapper
├── providers/    # QueryClient, Theme, Auth/Permission context
└── styles/       # imports @crm2/ui-theme tokens
```
> Improvement vs the proposed tree: **drop a separate top-level `pages/`** (it duplicates `features/`) and **drop `services/`** (API access is the typed `@crm2/sdk` in `lib/`). Pages live inside their feature. `app/` is the shell only.

**Standards:**
- **Queries:** TanStack Query; key shape `['<entity>', filters]`; money/KYC screens `staleTime:0`; always invalidate affected keys on mutation; never `queryClient.clear()`.
- **Forms:** react-hook-form + `zodResolver(<sdk schema>)`; schema imported from `@crm2/sdk` (one source); never inline zod.
- **Errors:** typed `SdkError`; every mutation surfaces a toast + inline field errors from the API `issues`.
- **Loading:** skeleton for tables, spinner for full-page; never empty-flash.
- **Empty:** descriptive copy + primary CTA; distinguish no-data vs no-results.
- **Permissions:** `usePermission(code)` gates affordances (UX only); server re-validates. Menu visibility ≠ data scope.

---

## PART 8 — DESIGN TOKEN IMPLEMENTATION (`packages/ui-theme`)

Centralized so **every page/component consumes the same tokens — zero hardcoded colors.**
```
packages/ui-theme/
├── src/tokens.css         # :root (light) + .dark CSS variables — the single color source
├── tailwind-preset.js     # maps the CSS vars → Tailwind color tokens + radius + fonts
└── src/index.ts           # token name constants (for charts/TS usage)
```
- Web app `tailwind.config.js` extends `presets: [require('@crm2/ui-theme/tailwind-preset')]`.
- Web app `styles` imports `@crm2/ui-theme/src/tokens.css`.
- Components use **semantic classes only** (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, status chips). **No `slate-*`, no `#hex`, no `dark:` overrides** (the `.dark` selector swaps the variables).
- The shadcn `components.json` points its CSS variables at the same tokens → shadcn + Tailwind + charts share one source.

---

## PART 9 — FINAL FREEZE

1. **Technology stack:** Node 22 LTS · TS 5.7 · React 19 · RR7 · TanStack Query 5 · Tailwind v4 · shadcn/ui · Radix · **pg (no ORM)** · PostgreSQL 17 · Valkey 8 · Vitest 3 · Playwright · pnpm 10 · Turbo 2 · Zod 3 · zod-to-openapi · Docker/Compose v2 · nginx.
2. **Prisma:** **NO — rejected.** raw `pg` + repository + zod + ordered SQL (Kysely optional later, repo-layer only).
3. **Design style:** 80% Twenty CRM · 10% Linear · 10% Salesforce-patterns; professional/data-dense/calm; banned: neobrutalism, glassmorphism, gradients, decorative motion.
4. **Theme:** CSS-variable tokens (light default, dark optional), Inter + JetBrains Mono, 4px spacing, 0.5rem radius, 3-level elevation, semantic status/chart tokens.
5. **Component library:** shadcn-based catalog (owned in-app), token-themed, a11y-required, loading/empty/error mandatory.
6. **Frontend standards:** feature-first folders; TanStack Query; RHF + zodResolver(@crm2/sdk); typed errors; permission-gated affordances.
7. **Folder structure:** `app · routes · features · components(ui+layout) · hooks · lib · providers · styles` (no `pages/`, no `services/`).
8. **Design tokens:** `packages/ui-theme` (tokens.css + tailwind preset); every surface consumes it; no page-specific colors.
9. **Canonical packages (LOCKED — these 5 only, Day-1):**
   ```
   packages/
   ├── ui-theme     # @crm2/ui-theme    — design tokens (CSS vars) + tailwind preset; the ONLY color source
   ├── sdk          # @crm2/sdk         — zod contracts (DTOs + validation) + typed API client (contracts merged in)
   ├── access       # @crm2/access      — roles, permission codes, authorize() guard, default-deny scope
   ├── config       # @crm2/config      — fail-fast env schema (one source across api/worker/report/web)
   └── test-utils   # @crm2/test-utils  — factories / builders / fixtures / ephemeral-DB harness / assertions
   ```
   No other shared packages Day-1. `components/ui` (shadcn primitives) stays **app-internal** to `acs-web-v2` until a 2nd web consumer exists. A standalone `@crm2/contracts` is NOT created (merged into `sdk`) and `@crm2/ui` is NOT created (app-internal). New packages require a proven ≥2-consumer need — no speculative extraction.

**This is the permanent CRM2 implementation baseline.** No tech migration, no UI redesign after this point.

> **Enforcement:** the stack + design rules above are machine-enforced — see `COLOR_SYSTEM_FREEZE.md` (tokens), `UPPERCASE_DISPLAY_STANDARD.md` (visual casing), and `CI_CD_STANDARDS.md` (Enforcement Matrix). No hardcoded colors, no raw fetch in the FE, tokens-only, a11y + loading/empty/error/permission states are required and gated.

---
*Design + stack freeze only — no architecture/workflow/business change. Versions are current-stable as of 2026-06; pin exact patch versions in package.json at install.*

---

## Pagination, Loading & Long-Running Operations (FROZEN 2026-06-05)
Permanent UX/scalability freeze — SoT **`docs/PAGINATION_AND_LOADING_STANDARDS.md`**, UI index
`UI_STANDARDS.md`. Server-side pagination on every list (default 25 / 25·50·100·200 / 500 MIS /
`>500` forbidden, single envelope); search-first; **Hexagon loader** with real stage-based
percentages (no spinners/old bars/bouncing dots); time-bands 0–300ms none · 300ms–1s skeleton ·
1–3s loader+% · 3–8s loader+%+op · **>8s background job**; skeleton rows on tables; exports +
any `>8s` op are background jobs with bell/toast/in-app completion. No UI redesign — standards only.

---

## Architecture governance (FROZEN 2026-06-05)
The stack + design decisions here are LOCKED in `docs/FROZEN_DECISIONS_REGISTRY.md`. No new
framework / table-or-grid framework / component library / design system / state-management without a
superseding ADR + CTO approval (`docs/ARCHITECTURE_GOVERNANCE.md`). Protected stack: Node 22 · TS ·
PG17 · Valkey 8 · React 19 · Tailwind 4 · shadcn · TanStack Query/Table · Vitest · Playwright · pnpm
· Turbo · `@crm2/logger`. Forbidden design: neobrutalism, glassmorphism, heavy gradients, decorative
motion. DataGrid = the one `@crm2/ui/DataGrid` (TanStack Table) — no AG Grid / alternative grids.

**Responsive-First (FROZEN 2026-06-05, SoT `docs/RESPONSIVE_DESIGN_STANDARD.md`):** the web app is
responsive-first / device-agnostic — every screen designed **mobile-up** and usable at **320 / 768 /
1024 / 1440** with **no desktop-only design and no horizontal overflow**. Responsive nav
(sidebar→hamburger/Sheet `<lg`), grids (`grid-cols-1 md:…`), dialogs (`w-full`+scroll/Sheet), filters
(`flex-wrap`); table strategy desktop-grid → tablet-condensed → mobile card/list. Playwright viewport
testing required. Scope = WEB UI only (NOT offline-/mobile-app-/mobile-workflow-first).
