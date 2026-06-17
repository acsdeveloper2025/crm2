# Next session — make the Playwright `e2e` CI gate green

## Context (state at handoff)

CRM2 (this repo, `acsdeveloper2025/crm2`) is **deployed and live** on
`https://crm.allcheckservices.com`. The push→deploy pipeline (`.github/workflows/deploy.yml`)
is green and auto-deploys on push to `main`.

The comprehensive CI workflow (`.github/workflows/ci.yml`) is green on **4 of 5 jobs**:
`secret-scan ✅ · static ✅ · test ✅ · build ✅ · e2e ❌`. **Your job: make `e2e` green.**

Commit rules (CONTRIBUTING.md — enforced): author **`Mayur Kulkarni <mayurkulkarni786@gmail.com>`**,
conventional commits, **no AI/Co-Authored-By trailer**, **never `--no-verify`**, direct commits to
`main` are allowed (no PR). `main` is the deploy line — every push rebuilds + redeploys.

## What `e2e` checks

`apps/web/e2e/` (Playwright), config `apps/web/playwright.config.ts`:
- 4 viewport projects — **Mobile 375 · Tablet 768 · Laptop 1280 · Desktop 1440**.
- `setup` project (`auth.setup.ts`) logs in `admin/admin123` once (CI's fresh DB seeds that via
  migration 0009 — note prod's admin password was rotated, but CI is a throwaway DB).
- Specs: `viewport.spec.ts` (responsive), `a11y.spec.ts` (axe), `datagrid.spec.ts`,
  `layout.spec.ts` (mobile nav drawer focus-trap), `pipeline.spec.ts`, `login.spec.ts`.

## The two gaps to close

### 1. Responsive retrofit (the bulk of it)

`viewport.spec.ts` asserts, for **15 pages** (`/admin/clients`, `/admin/products`,
`/admin/verification-units`, `/admin/users`, `/admin/locations`, `/admin/rates`, `/admin/cpv`,
`/admin/templates`, `/admin/rbac`, `/admin/system`, `/cases`, `/pipeline`, `/billing`,
`/admin/commission-rates`, `/admin/report-layouts`), at all 4 viewports:
- **no horizontal overflow** (`scrollWidth - clientWidth ≤ 1px`) — observed e.g. Commission Rates
  overflows by 6px on Mobile;
- a reachable **nav trigger** (the `open/collapse menu` hamburger);
- the **primary action** button is visible (where specified);
- pages marked `card: true` must show a **table→card transform on mobile** (`<md`): each row becomes
  a stacked, labelled card (RESPONSIVE_DESIGN_STANDARD §"Table strategy").

Source of truth: `docs/RESPONSIVE_DESIGN_STANDARD.md` + `docs/DATAGRID_STANDARD.md` (the DataGrid is
the single table component — `apps/web/src/components/ui/data-grid/`; the mobile card view belongs
there so every list inherits it). Memory flags the app as desktop-first with this retrofit pending.

**Approach:** fix the shared shell (sidebar→Sheet/drawer `<lg`, container `min-w-0`/`overflow-x`),
then the DataGrid mobile card transform once (covers most `card` pages), then page-specific overflow
offenders (toolbars/filter bars that don't wrap). Iterate page-by-page at 375px.

### 2. Operational data for the grid/pipeline specs

`datagrid.spec.ts` (row-select bulk bar, master-detail CPV expansion) and `pipeline.spec.ts`
(row-select → Assign dialog with eligibility pool) **time out** in CI because the e2e DB has only
the admin seed — **no clients/products/CPV/cases/tasks** to act on. The `e2e` job in
`.github/workflows/ci.yml` only runs `db/v2/migrations/*` (admin) — it does **not** run the seed
files or create operational rows.

**Approach (pick one, keep it deterministic):**
- add an e2e seed step/fixture (SQL or a small seed script) that creates a handful of
  clients/products/CPV links/cases/tasks before the Playwright run; **and/or**
- make the specs self-seed via the API in a `beforeAll` (mirror how api integration tests build
  state). Prefer a fixture that's stable so assertions are deterministic.

## How to run e2e locally (fast iteration)

```bash
cd acs-crm-v2
pnpm install
# bring up local DBs + seed the dev DB so pages have data
docker compose up -d
for f in db/v2/migrations/*.sql; do psql postgresql://postgres@127.0.0.1:54329/crm2_dev -f "$f"; done
psql postgresql://postgres@127.0.0.1:54329/crm2_dev -f db/v2/seed/verification_units.seed.sql
psql postgresql://postgres@127.0.0.1:54329/crm2_dev -f db/v2/seed/locations.seed.sql
# (create a few clients/products/cpv/cases/tasks via the UI or API for the grid/pipeline specs)
pnpm --filter @crm2/web exec playwright install chromium
pnpm --filter @crm2/web test:e2e            # boots api :4000 + web :5273 itself
pnpm --filter @crm2/web test:e2e -- viewport.spec.ts --project=Mobile   # one spec/one viewport
pnpm --filter @crm2/web exec playwright show-report                      # inspect failures
```

## Done when

`pnpm --filter @crm2/web test:e2e` is green locally at all 4 viewports, then push to `main` and
confirm the `e2e` job (hence the whole `ci.yml`) is green. Keep `static/test/build` green — run
`pnpm verify` before pushing.
