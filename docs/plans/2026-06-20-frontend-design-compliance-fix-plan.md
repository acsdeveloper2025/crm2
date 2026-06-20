# Frontend Design-Compliance Fix — Multi-Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended)
> or `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> Build in a fresh git worktree (`superpowers:using-git-worktrees`). **Never push/merge/deploy without
> explicit owner OK** (push→main auto-deploys to prod). Commits: author `Mayur Kulkarni
> <mayurkulkarni786@gmail.com>`, conventional, **NO AI/Co-Authored-By trailer**, never `--no-verify`,
> commit only at green gates. AUDIT-ONLY until the owner approves this plan — do not start before then.

**Goal:** bring every `apps/web` page to full v2 design-system + page-standard compliance by adopting
existing shared primitives — closing the 25 P1 / 56 P2 / 45 P3 findings from
[docs/design-audit-2026-06-19/](../design-audit-2026-06-19/README.md) (FINDINGS.md is the per-item spec:
exact file:line + fix for all 126). Zero architecture change; every fix is additive.

**Architecture:** three layers, built in order. **(F) Foundation** — build/extend the missing shared
primitives once (centralized `has()`, `formatMoney()`, `WorkStatusChip`, a shared `Popover`, a `Tabs`
helper, a token-name guard). These edit SHARED files, so they are done SERIALLY first. **(Wave 1–3)
Page fixes** — each agent owns DISJOINT page files and consumes the foundation, so they run in PARALLEL.
Build order: **Foundation → Wave 1 (P1) → Wave 2 (P1/P2 contract) → Wave 3 (P2/P3 polish).**

**Tech Stack:** React + react-query + Tailwind (frozen `@crm2/ui-theme` tokens), `@crm2/sdk`,
Vitest (unit), Playwright + axe (web e2e — gate `ci` workflow, NOT in `pnpm verify`).

**Verification gate per task:** task tests pass → `pnpm verify` green (typecheck → lint → format →
no-suppressions → boundaries → test → build) → for any UI behavior, the CI `ci` workflow (a11y +
viewport e2e) green AND browser-verify in the preview (perform the action, confirm it persists — per
`feedback_browser_verify_perform_actions`). Commit only at green.

**Audited revision:** `origin/main` `11997a1`. Re-baseline (`git fetch && rebase`) before starting —
parallel sessions are active.

> **2026-06-20 follow-up — two new dimensions added** ([ADD_EDIT_PATTERN.md](../design-audit-2026-06-19/ADD_EDIT_PATTERN.md), [KEYBOARD_NAV.md](../design-audit-2026-06-19/KEYBOARD_NAV.md)): **Wave 4** standardizes add/edit to **Twenty-style inline-grid editing + record-page routes (no modal/overlay forms)** per **[ADR-0051](../adr/ADR-0051-inline-grid-editing-no-modal-forms.md) (owner-accepted 2026-06-20)**. **Wave K** fixes keyboard navigation. **Reconciliation:** Wave-1 task A3 (focus-trap the Commission-Rates *dialog*) and the form-dialog parts of R2 become **moot** once those forms move to record pages in Wave 4 (D4) — skip A3 if Wave 4 runs; the header popovers (A4) and OCC/import/confirm dialogs are NOT forms and keep their focus-traps regardless. The Wave-K DataGrid keyboard P1s (sort/row/cell) are **built into Wave-4 D1** (the editable grid must be keyboard-operable), so do them together.

---

## Multi-agent orchestration model (per `docs/governance/BUILD_METHOD.md`)

| Phase | Agents | Parallelism | Why |
|---|---|---|---|
| **Foundation (F1–F6)** | 1 agent (or orchestrator inline) | **SERIAL** | Edits shared files (`AuthContext`, `format.ts`, `components/`, `eslint`/test). Parallel edits here collide. Land + commit first. |
| **Wave 1 (A1–A6)** | up to 6 | **PARALLEL** | Disjoint page files; all depend on Foundation merged. Clears every reachable P1. |
| **Wave 2 (B1–B3)** | up to 3 | **PARALLEL** | Contract adoption; folds into registry C-9/C-10/B-13. |
| **Wave 3 (C1–C3)** | up to 3 | **PARALLEL** | Polish; consumes F1/F2/F4. |

**Conflict rule:** every parallel agent's file set is disjoint (enforced by the assignments below). FE-only
+ disjoint ⇒ a single shared branch `feat/design-compliance` is sufficient; reach for one worktree per
agent only if an agent must touch a shared file (none should — that's what Foundation is for).
**Gate between waves:** orchestrator runs `pnpm verify` + the `ci` e2e + a browser smoke before starting
the next wave. **Skeptic pass:** after Wave 1, a reviewer agent re-verifies each P1 is actually closed
(RBAC button hidden for a non-perm role; axe green on the dialog) — evidence before "done."

---

## FOUNDATION (serial — do first, one commit each)

### Task F1: Centralize `has(perm)` in `useAuth()`

**Files:**
- Modify: `apps/web/src/lib/AuthContext.tsx` (add `has` to `AuthState` at `:7` + the provider value)
- Test: `apps/web/src/lib/AuthContext.test.tsx` (create)

- [ ] **Step 1 — failing test**
```tsx
// AuthContext.test.tsx — has() honors grantsAll + permissions list
import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
// render useAuth within a provider seeded with a user; assert:
//   grantsAll=true  → has('anything') === true
//   permissions=['case.view'] → has('case.view') true, has('case.create') false
//   no user → has('x') === false
```
- [ ] **Step 2 — run, expect FAIL** (`has` not on the returned object). `pnpm --filter @crm2/web test AuthContext`
- [ ] **Step 3 — implement:** add to `AuthState` and compute once in the provider:
```ts
// AuthState interface
has: (perm: string) => boolean;
// in the provider value (mirrors the existing Layout.tsx:83-84 logic verbatim):
const has = (perm: string) =>
  !!user && (user.grantsAll === true || (user.permissions ?? []).includes(perm));
```
- [ ] **Step 4 — run, expect PASS**
- [ ] **Step 5 — replace the 3 local duplicates** to consume it (no behavior change):
  - `apps/web/src/components/Layout.tsx:83-84` → `const { user, has } = useAuth();` (drop local `has`)
  - `apps/web/src/features/commissionRates/CommissionRatesPage.tsx:296-298` → consume `has` from `useAuth()`
  - `apps/web/src/features/reportLayouts/ReportLayoutsPage.tsx:694-695` → consume `has` from `useAuth()`
- [ ] **Step 6 — `pnpm verify` green → commit** `feat(web): expose has(perm) from useAuth, dedupe local copies`

### Task F2: `formatMoney()` in the shared formatter

**Files:** Modify `apps/web/src/lib/format.ts`; Test `apps/web/src/lib/format.test.ts`
- [ ] **Step 1 — failing test:** `formatMoney(50)==='₹50.00'`, `formatMoney(null)==='—'`, `formatMoney(undefined)==='—'`.
- [ ] **Step 2 — run, expect FAIL**
- [ ] **Step 3 — implement** (preserves the exact existing output `₹${n.toFixed(2)}` so no visual diff):
```ts
/** Rupee display formatter — single source for every money cell. '—' for null/undefined. */
export function formatMoney(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : `₹${n.toFixed(2)}`;
}
```
- [ ] **Step 4 — run, expect PASS** → commit `feat(web): add formatMoney to lib/format`
  (Consumers swapped in Wave 3 / C1 — not here, to keep this task isolated.)

### Task F3: `WorkStatusChip` — shared workflow-status badge

**Files:** Create `apps/web/src/components/WorkStatusChip.tsx`; Test `apps/web/src/components/WorkStatusChip.test.tsx`
- [ ] **Step 1 — failing test:** renders the frozen token class for a known status and a neutral fallback for unknown.
```tsx
// COMPLETED → 'text-st-approved' (matches PipelinePage/CaseDetailPage maps); unknown → 'bg-surface-muted'
```
- [ ] **Step 2 — run, expect FAIL**
- [ ] **Step 3 — implement.** Lift the canonical status→token map from the most-complete existing map
  (`PipelinePage.tsx:28-36` `STATUS_TONE`) into this component as the single source; ensure `COMPLETED →
  text-st-approved` (per the audit; the 8 frozen status names have no `completed`). Reuse the exact chrome
  string already duplicated across pipeline/case-detail/dedupe:
```tsx
const TONE: Record<string, string> = { /* lift verbatim from PipelinePage.tsx:28-36, add COMPLETED→approved */ };
export function WorkStatusChip({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ');
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${TONE[status] ?? 'bg-surface-muted'}`}>{label}</span>;
}
```
- [ ] **Step 4 — run, expect PASS** → commit `feat(web): add shared WorkStatusChip`
  (Consumers — Pipeline, Case detail, Dedupe, Cases list — swapped in Wave 3 / C1.)

### Task F4: shared `Popover` (focus-trapped menu primitive)

**Files:** Create `apps/web/src/components/ui/Popover.tsx`; Test `…/Popover.test.tsx`
- [ ] **Step 1 — failing test:** opening moves focus into the panel; `Escape` closes and restores focus to the
  trigger; panel has `role="menu"`, trigger has `aria-haspopup` + `aria-expanded`; outside-click closes.
- [ ] **Step 2 — run, expect FAIL**
- [ ] **Step 3 — implement:** compose the existing `useFocusTrap<HTMLDivElement>(open, onClose)`
  (`lib/useFocusTrap.ts`) + the existing dropdown chrome (`right-0 z-50 mt-2 rounded-md border border-border
  bg-popover text-popover-foreground shadow-lg`, lifted from `JobsTray.tsx:110`). Expose `<Popover
  trigger={…} aria-label=…>{items}</Popover>`. Mirror the DataGrid menus (`DataGrid.tsx:461,527`) which already
  use `role="menu"` + `useFocusTrap`.
- [ ] **Step 4 — run, expect PASS** → commit `feat(web): add shared focus-trapped Popover primitive`
  (Consumers — JobsTray/NotificationBell/UserMenu — swapped in Wave 1 / A4.)

### Task F5: token-name guard (prevents dead `st-*` classes like H-7)

**Files:** Create `apps/web/src/lib/tokens.test.ts`
- [ ] **Step 1 — implement a source-scan test** (Vitest) that greps `apps/web/src/**/*.{ts,tsx}` for
  `(?:text|bg|border)-st-([a-z-]+)` and asserts every captured name ∈ the frozen set
  `{pending,assigned,in-progress,submitted,under-review,approved,rejected,revisit}` (and `-bg` variants).
  This fails today on `text-st-completed` (CaseCreatePage.tsx:257) — proving it works.
- [ ] **Step 2 — run, expect FAIL** (catches the existing dead class)
- [ ] **Step 3 — leave failing until A2 fixes the class**, then it stays green as a regression guard.
  Commit with A2 (so the repo never has a red test). → `test(web): guard against unknown st-* tokens`

### Task F6: scroll-region a11y helper (optional, small)

**Files:** Modify `apps/web/src/index.css` OR add a `ScrollRegion` wrapper in `components/ui/`
- [ ] Provide a one-line way to make a bespoke `overflow-x-auto` table wrapper keyboard-focusable
  (`tabIndex={0} role="group" aria-label="… (scroll horizontally)"`, matching `DataGrid.tsx:653-657`).
  A tiny `<ScrollRegion>` component is cleanest; Wave 2/B2 consumes it. → commit `feat(web): add a11y ScrollRegion helper`

### Task F7: `<Button>` variant system (per [ADR-0052](../adr/ADR-0052-button-action-emphasis-system.md))
**Files:** Create `apps/web/src/components/ui/Button.tsx`; update `apps/web/src/index.css:14-19` (`.btn`/`.btn-ghost` → thin aliases of the new variants during migration); test `components/ui/Button.test.tsx`.
- [ ] Build `<Button variant size>` — **owner-locked looks (ADR-0052):** `primary` (filled blue), `secondary` (**bordered** neutral), `destructive` (**filled red**), `ghost` (borderless utility), `link` (text). Sizes `sm|md`; icon-button form (square, requires `aria-label`, ≥44px); `loading`/`disabled` states. All using **existing** tokens (`bg-primary`, `border-input`, `bg-destructive`) + the global `:focus-visible` ring. **No new colors.**
- [ ] TDD: each variant renders its token classes; icon-button without `aria-label` fails a lint/test; `loading` shows a spinner + disables. → commit `feat(web): shared Button variant system (ADR-0052)`.
- [ ] **Migration (mechanical, reviewed) — apply the locked [action→variant mapping](../design-audit-2026-06-19/BUTTON_INVENTORY.md):** Create/New/Save → `primary`; **Edit/Export/Import/Activate → `secondary`**; Deactivate/Delete/Revoke → `destructive`; Cancel/Columns/Views/pager/More → `ghost`. Convert the **21 bare `text-primary` link-buttons** (mostly Edit + status actions) and bespoke one-offs → `<Button>`. Enforce **one `primary` per view**. **Supersedes Wave-3 C3's** "bespoke button → `.btn-ghost`" item. → commit per area.

**FOUNDATION GATE:** `pnpm verify` green (F5 goes green once A2 lands — sequence A2 right after Foundation, or land F5+A2 together). Commit, then start Wave 1.

---

## WAVE 1 — P1 fixes (parallel; each agent = one task)

> Each agent: read the cited findings in `docs/design-audit-2026-06-19/FINDINGS.md` (P1 section) for exact
> file:line, apply the pattern below, add the test, `pnpm verify` + browser-verify, commit.

### Task A1 (Agent W1-RBAC): close RBAC-UI client-gating leaks — findings R1 / registry H-1
**Files:** `features/cases/CasesPage.tsx:69`, `features/rateManagement/RateManagementPage.tsx`,
`features/templates/TemplatesPage.tsx:98,103,124,133`, `features/access/RolesPage.tsx`,
`features/policies/PoliciesPage.tsx`. **Pattern (consumes F1):**
```tsx
const { has } = useAuth();
// gate each write affordance with the SAME perm the server write endpoint enforces:
{has('case.create') && <button className="btn" onClick={() => navigate('/cases/new')}>+ New Case</button>}
// Cases→case.create · Rate Mgmt→masterdata.manage · Templates/ReportLayouts→report_template.manage
// RBAC Roles→(its manage perm) · Policies→(its manage perm). Mirror the server route guard exactly.
```
- [ ] **Step 1 — Playwright test (per page):** a user whose role lacks the write perm does NOT see the write
  control; a SUPER_ADMIN does. (Seed a limited role via the e2e seed.)
- [ ] **Step 2 — run, expect FAIL** for Cases/Rate-Mgmt (today the button shows for `case.view`/`page.masterdata` roles).
- [ ] **Step 3 — add the gates.** Priority: Cases + Rate Management (seeded-role-reachable, true P1).
  Templates/RBAC/Policies are P2-latent (custom-role-only per the skeptic) but fix in the same pass — same one-line pattern.
- [ ] **Step 4 — run, expect PASS** → browser-verify with a non-admin seeded role → commit
  `fix(web): gate write actions on server perms (RBAC-UI parity)`

### Task A2 (Agent W1-Tokens): fix the 2 token slips — findings R7 / registry H-7
**Files:** `features/cases/CaseCreatePage.tsx:257`, `features/cases/AddTasksForm.tsx:173`
- [ ] **Step 1 — F5 token test is failing** (from Foundation) on `text-st-completed`.
- [ ] **Step 2 — fix:** `text-st-completed` → `text-success` (or `text-st-approved` to match COMPLETED tone maps);
  `text-amber-600` → `text-warning`.
- [ ] **Step 3 — run F5, expect PASS** → `pnpm verify` → browser-verify the success banner is now colored → commit
  `fix(web): replace dead text-st-completed + raw text-amber-600 with frozen tokens`

### Task A3 (Agent W1-Dialog): focus-trap the Commission Rates dialog — findings R2 / a11y P1
**Files:** `features/commissionRates/CommissionRatesPage.tsx:121-129`
- [ ] **Step 1 — Playwright/axe:** open the dialog → Tab cycles inside; Escape closes + restores focus; axe clean; has accessible name.
- [ ] **Step 2 — run, expect FAIL**
- [ ] **Step 3 — implement** (mirror every other dialog, e.g. `MasterDataCrud.tsx:247-248`):
```tsx
const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);
// <div role="dialog" aria-modal="true" aria-labelledby="commission-rate-dialog-title" ref={dialogRef}>
//   <h2 id="commission-rate-dialog-title">…</h2>
```
- [ ] **Step 4 — run, expect PASS** → commit `fix(web): focus-trap + label the commission-rates dialog`

### Task A4 (Agent W1-Popovers): header popovers adopt shared Popover — findings R2 / a11y P1 (consumes F4)
**Files:** `components/JobsTray.tsx`, `components/NotificationBell.tsx`, `components/UserMenu.tsx`
- [ ] **Step 1 — Playwright/axe:** each popover traps focus, Escape restores focus, panel `role="menu"`, trigger `aria-haspopup`.
- [ ] **Step 2 — run, expect FAIL**
- [ ] **Step 3 — replace each hand-rolled open/outside-click/Escape + panel markup with `<Popover>` (F4).**
  Removes the triplicated effect+markup and closes the trap gap at once.
- [ ] **Step 4 — run, expect PASS** → browser-verify all three menus → commit `fix(web): header popovers use shared focus-trapped Popover`

### Task A5 (Agent W1-States): standardize loading/error states — findings R3 / states P1
**Files:** `features/dashboard/components/PortfolioTable.tsx`, `features/security/SecurityPage.tsx`,
`components/NotificationBell.tsx:112`, `features/cpv/CpvPage.tsx:478`, `features/policies/PoliciesPage.tsx`
- [ ] **Step 1 — tests:** a failed feed fetch renders an error + Retry (not silent-empty); loading uses `HexagonLoader`.
- [ ] **Step 2 — run, expect FAIL** (today errors coerce to `[]`/`0`).
- [ ] **Step 3 — implement:** replace bare `…`/`Loading…` with `HexagonLoader` (+ `useLoadingBand` to avoid <300ms flicker,
  matching `BillingPage.tsx:37`); stop coercing fetch errors to empty — render an error+Retry row; Security MFA must not default to OFF before load.
- [ ] **Step 4 — run, expect PASS** → browser-verify (throttle/kill the API to see error state) → commit `fix(web): standard loading/error states on dashboard/security/notifications/cpv/policies`

### Task A6 (Agent W1-CI): extend the a11y + viewport gate coverage — findings a11y P2 (regression prevention)
**Files:** `apps/web/e2e/a11y.spec.ts` (PAGES), `apps/web/e2e/viewport.spec.ts` (PAGES)
- [ ] **Step 1 — add the uncovered routes** to both PAGES lists: `/cases/:id`, `/cases/new`, `/dashboard`,
  `/profile`, `/security` (+ `/admin/departments,designations,policies`, `/dedupe`, `/field-monitoring`).
  Reuse `auth.setup.ts` + the e2e seed already wired in `ci.yml`. Document any deliberate omission inline (as `/admin/locations` does).
- [ ] **Step 2 — run the `ci` e2e** — fix any newly-surfaced serious/critical axe violations (or file them as follow-ups if out of Wave-1 scope) → commit `test(web): add uncovered routes to axe + viewport gates`

**WAVE 1 GATE:** `pnpm verify` + `ci` e2e green + a reviewer/skeptic agent confirms each P1 closed (RBAC controls hidden for a seeded non-perm role; axe green on Commission-Rates dialog + the 3 popovers; error states render). **Recommend shipping Wave 1 as one PR** — clears every reachable P1 at near-zero blast radius.

---

## WAVE 2 — P1/P2 contract adoption (parallel; folds into registry C-9/C-10/B-13)

### Task B1 (Agent W2-Forms): forms → RHF + zodResolver(@crm2/sdk); OCC via ConflictDialog — findings R4 / H-4
**Files:** `features/commissionRates/CommissionRatesPage.tsx`, `features/policies/PoliciesPage.tsx`,
`features/reportLayouts/ReportLayoutsPage.tsx` (+ admin dialogs as the P2 tail).
- [ ] Per page: replace raw `useState` + `disabled={!a||!b}` with `react-hook-form` + `zodResolver(<existing @crm2/sdk schema>)`
  (inline per-field errors); surface 409 `STALE_UPDATE` via the shared `ConflictDialog` (reload-adopts-version / discard),
  mirroring `MasterDataCrud.tsx`. Test: invalid field shows inline error; a simulated 409 opens `ConflictDialog`. → commit per page.

### Task B2 (Agent W2-Tables): embedded tables → responsive + focusable (consumes F6) — findings R5 / H-5
**Files:** `features/cases/CaseDetailPage.tsx` (3 tables), `features/cpv/CpvPage.tsx` (enabled-units),
`features/billing/BillingPage.tsx` (standalone breakdown panels only — NOT the `renderExpanded` case-lines, per skeptic),
plus the bespoke scroll wrappers in `CaseCreatePage`/`ProfilePage`/`UsersPage`/`ImportModal`.
- [ ] Apply the `.rtable` + `data-label` cell pattern + the F6 `ScrollRegion` (tabIndex/role/aria-label) to each;
  migrate to DataGrid ONLY where the list can grow (CPV enabled-units). Test: viewport e2e shows no horizontal page overflow + scroll region is focusable. → commit per page.

### Task B3 (Agent W2-Export): export/pagination contract — findings R6 / B-13
**Files:** `features/cases/CasesPage.tsx` (add `exportFn` + `dateFilters`), `features/users/UsersPage.tsx`
(route `Export Scope` through `apiExport` 413/job), `features/policies/PoliciesPage.tsx` (add `exportFn`),
`features/cases/CaseDetailPage.tsx` (paginate the task/attachment arrays or document array-by-design).
- [ ] Wire each via the DataGrid `exportFn`/`apiExport` contract IF the backend export endpoint exists; where it
  doesn't, file an additive backend gap (do NOT invent endpoints). Test: export menu present + respects filters. → commit per page.

**WAVE 2 GATE:** `pnpm verify` + `ci` e2e green + browser-verify (OCC conflict dialog; export download; mobile no-overflow).

---

## WAVE 3 — P2/P3 polish (parallel; consumes F2/F4)

### Task C1 (Agent W3-Format): adopt WorkStatusChip + formatMoney — findings R8 / d9 (consumes F2,F1)
**Files:** swap status rendering to `WorkStatusChip` in `PipelinePage`, `CaseDetailPage`, `DedupePage`,
`CasesPage` (was plain text); swap `money`/`lineMoney` to `formatMoney` in `CommissionRatesPage`,
`RateManagementPage`, `BillingPage`. Delete the now-dead local maps/helpers. Test: status cell renders the chip; money cell renders `₹…`. → commit.

### Task C2 (Agent W3-Filters): URL-state filters on remaining lists — findings d3
**Files:** `CaseDetailPage` (task filter → URL/grid), `CommissionRatesPage`, `RateManagementPage`,
`DedupePage`, `FieldMonitoringPage`, `RolesPage`, `ReportLayoutsPage` — add `filterable` columns / `dateFilters`
where the endpoint whitelists them (DataGrid `q`/`f_*` contract). → commit per page.

### Task C3 (Agent W3-Consistency): consistency + touch targets — findings d6/d12/d13 (consumes F4)
**Files:** `UsersPage` (de-dup the double `Import` button — VISUAL_VERIFICATION); `LocationsPage` (bespoke inline
create form → shared `+ New` dialog, or document the batch variant); `MasterDataCrud.tsx:260` +
`VerificationUnitDialog.tsx:122-129` (stop `.toUpperCase()` in `onChange` — coerce at submit; WYSIWYG rule);
`DataGrid.tsx:681` (+ bespoke tables) add `scope="col"` on `<th>`; adopt a shared `Tabs`
helper (extract from `CaseDetailPage.tsx:438-461` + `UsersPage.tsx:600-616`). → commit per concern.
**Note:** row-action text-links, the `FieldMonitoringPage:244` bespoke button, and all button affordance/touch-target fixes are now handled by the **F7 `<Button>` system (ADR-0052)**, not ad-hoc `.btn-ghost` — do them there.

**WAVE 3 GATE:** `pnpm verify` + `ci` e2e green + browser-verify. Update `COMPLIANCE_GAPS_REGISTRY.md §H`
dispositions FIXED as each lands.

---

## WAVE 4 — Twenty-style inline-grid editing (D14 — per ADR-0051, owner-accepted 2026-06-20)

> **Decision ([ADR-0051](../adr/ADR-0051-inline-grid-editing-no-modal-forms.md)):** add/edit = **inline-grid (spreadsheet-style) cell editing** for flat entities + a **full record-page route** for complex entities; **no modal/overlay forms.** Scope = entity add/edit forms ONLY; OCC `ConflictDialog`, `ImportModal`, confirm prompts, action dialogs (Assign), header menus stay. This is the largest item in the plan — sequence it AFTER Wave 1–3. Reference no-modal patterns already in-repo: CaseCreate route, CaseDetail inline-row, Locations inline add, RateMgmt `AddRateForm`.

### Task D1 (FOUNDATION — the big build): make the Universal DataGrid editable
**Files:** `apps/web/src/components/ui/data-grid/DataGrid.tsx` (+ new `data-grid/CellEditor.tsx`, `data-grid/useInlineEdit.ts`); tests in `data-grid/*.test.tsx` + a Playwright spec.
- [ ] Add `editable` + `editor` (text|select|date|checkbox) to `DataGridColumn`; an edit-state hook; click-or-Enter to enter a cell editor; **Enter/blur commit, Escape cancel**; **per-row OCC** (carry `version`, guarded PATCH → 409 `STALE_UPDATE` → reuse `ConflictDialog` or an inline row-conflict); **per-field zod validation** (`@crm2/sdk` schema) with inline error; optimistic update + rollback.
- [ ] **Keyboard** (also resolves the Wave-K DataGrid P1s): Tab/Shift-Tab + arrow keys move the active cell; Enter edits/commits; Escape cancels; sortable headers + row controls operable (see K1).
- [ ] TDD per behavior (commit persists; 409 surfaces; invalid field blocks commit; keyboard cell-nav works) → `pnpm verify` → commit. **This is the gating dependency for D3.**

### Task D2 (FOUNDATION): inline add-row in the DataGrid
**Files:** `DataGrid.tsx` (+ the add-row affordance).
- [ ] An "add" control inserts a blank **editable row** (top or bottom); filling + commit POSTs the new entity via the page's `createFn`; Escape discards. TDD: keyboard-reachable, creates a row, validates. → commit.

### Task D3 (parallel, per page): convert FLAT entities to inline-grid editing + delete their dialogs
Each agent makes its page's columns `editable`, wires create via the D2 add-row, and **deletes the `*Dialog`/`MasterDataDialog`** add/edit modal. Disjoint files ⇒ parallel. (Date-sensitive / effective-dated fields per ADR-0017 that don't fit a cell → defer that field's edit to the record page in D4.)
- [ ] Clients, Products (via `MasterDataCrud` → editable grid — converts both at once).
- [ ] Departments, Designations, VerificationUnits.
- [ ] Policies, Locations, RateManagement, CPV (the split pages — finish the edit half inline).
Each: TDD (cell edit persists; add-row creates; no `role="dialog"` add/edit form remains) → browser-verify → `pnpm verify` → commit.

### Task D4 (parallel, per entity): full record-page routes for COMPLEX entities + delete their dialogs
Forms too rich for cell-editing get a dedicated route (`/admin/<entity>/new`, `/admin/<entity>/:id`) with inline field editing — mirror `CaseCreatePage`/`CaseDetailPage`. Add the routes to `App.tsx`; RBAC-guard each route (closes H-1 for these).
- [ ] **Users** (2-tab Profile/Access → record page), **Roles** (→ record page), **ReportLayouts** (designer → record page), **CommissionRates** (cascading pickers → record page). Delete `UserDialog`/`RoleDialog`/`LayoutDesignerDialog`/`CommissionRateDialog` (the last also closes the A3 focus-trap P1).
Each: TDD + browser-verify (create + edit on the route persist) → `pnpm verify` → commit.

### Task D5: enforce + clean up
- [ ] Add a guard test: **no entity add/edit surface renders `role="dialog"`** (grep `apps/web/src/features` for add/edit `*Dialog` usage = 0). Update `docs/DATAGRID_STANDARD.md` + `docs/MANAGEMENT_LIST_STANDARD.md` to document the editable-grid + record-page pattern. → commit.

**WAVE 4 GATE:** the `role="dialog"` add/edit guard test is green; `pnpm verify` + `ci` e2e (incl. keyboard cell-edit) green; browser-verify a representative flat entity (inline cell edit + add-row) and a complex entity (record-page create+edit) end-to-end.

## WAVE K — Keyboard navigation (D15)

### Task K1 (Foundation — shared DataGrid, fixes every grid): sortable headers + row-click keyboard-operable — **P1**
**Files:** `apps/web/src/components/ui/data-grid/DataGrid.tsx:681-695` (headers), `:773-784` (rows).
- [ ] Render sortable header label as a `<button>` (or `role=button tabIndex=0 onKeyDown` Enter/Space → `toggleSort`), keep `aria-sort`. Test: keyboard sorts the grid.
- [ ] Make `onRowClick` rows keyboard-reachable: primary cell as a real link, or `tabIndex=0 role=button onKeyDown` Enter/Space → navigate, with a focus ring. Test: keyboard opens a row's detail. → commit `fix(web): DataGrid sort + row-open keyboard operable`.

### Task K2 (Foundation — shared CSS): restore the `.input` focus ring — P2
**Files:** `apps/web/src/index.css:11-13`.
- [ ] `.input` sets `outline-none` which suppresses the global `:focus-visible` ring (`packages/ui-theme/src/tokens.css:238-240`) for text inputs only — add `focus-visible:ring-2 focus-visible:ring-ring`. (Buttons/links already inherit the global ring — do NOT mass-edit them; the audit's "global P1" was overstated, see KEYBOARD_NAV skeptic note.) → commit.

### Task K3 (parallel): per-surface keyboard P1/P2 fixes
- [ ] **RateManagement `SearchableSelect`** (`RateManagementPage.tsx:78-115`): add keyboard selection (ArrowUp/Down + Enter, or native `<select>`/listbox roles) — today it commits on `onMouseDown` only → keyboard cannot select (blocks inline Add-Rate). **P1.**
- [ ] **RBAC "Cannot deactivate" overlay** (`features/access/RolesPage.tsx:224-235`): give it `role=dialog`+`aria-modal`+`useFocusTrap`+Escape (or replace with a toast). **P1.**
- [ ] **Header popovers** (Jobs/Bell/Account) — same as Wave-1 A4 (adopt the shared focus-trapped `Popover`); add arrow-key roving where `role=menu`. 
- [ ] **Skip-to-content** (`components/Layout.tsx:227`): add a visually-hidden focus-visible "Skip to content" anchor + `id="main" tabIndex=-1` on `<main>`. **P2.**
- [ ] **MustAcceptPoliciesPage scroll region** (`:33`): `tabIndex=0 role=region aria-label` so keyboard users can scroll the policy text. **P2.**
- [ ] **DataGrid menus / multi-select filter**: add ArrowUp/Down roving in `role=menu` (or drop `role=menu` for a labelled button group); Enter/Escape on `ColumnFilterInput`. **P3.**

**WAVE K GATE:** the axe + viewport e2e (extended by A6) green incl. keyboard-operability checks; manual keyboard pass on a grid (sort + open row via keyboard) and the converted inline forms.

## Verification matrix (proof per finding-class)

| Finding class | Proof required |
|---|---|
| RBAC-UI (A1) | Playwright: seeded non-perm role does NOT see the control; SUPER_ADMIN does. |
| A11y dialogs/popovers (A3/A4) | axe gate green on the open dialog/menu + focus-trap/Escape e2e (`datagrid.spec.ts` pattern). |
| Loading/error (A5) | browser-verify with the API killed → error+Retry, not blank/empty. |
| Tokens (A2) | F5 token test green + visual: success banner colored. |
| CI coverage (A6) | the new routes appear in `a11y.spec`/`viewport.spec` PAGES and run green. |
| Forms/OCC (B1) | inline field error + simulated 409 → `ConflictDialog`. |
| Tables/responsive (B2) | viewport e2e: no horizontal page overflow at 375; scroll region focusable. |
| Export (B3) | export menu present; downloaded file respects active filters; ≥10k → job/202. |
| Status/money (C1) | status cell = `WorkStatusChip`; money cell via `formatMoney`. |
| Inline add/edit (Wave 4) | grep-guard test: no entity add/edit surface renders `role="dialog"`; browser-verify add+edit work inline + persist. |
| Keyboard (Wave K) | keyboard-only e2e: sort a grid + open a row via keyboard; select a `SearchableSelect` option via keyboard; Tab to content via skip-link. |

---

## Self-review (per writing-plans)

- **Spec coverage:** every README R-pattern (R1–R10) maps to a task — R1→A1, R2→A3+A4, R3→A5, R4→B1,
  R5→B2, R6→B3, R7→A2, R8→C1, R9→C2, R10→C3; a11y CI coverage→A6; the missing primitives→F1–F6. The long
  tail (per-page file:line) lives in FINDINGS.md, which each agent reads for its task.
- **Type consistency:** `has` (F1) consumed by A1; `formatMoney` (F2) by C1; `WorkStatusChip` (F3) by C1;
  `Popover` (F4) by A4; `ScrollRegion` (F6) by B2 — names are stable across tasks.
- **No invented APIs:** code uses verified signatures (`useFocusTrap<T>(open,onClose)`, `useAuth()`, the
  existing `has` logic, the existing `₹${n.toFixed(2)}` output, the existing dropdown chrome). Where a
  backend export endpoint may not exist (B3), the plan files a gap instead of inventing it.

---
*Plan for the 2026-06-19 design audit. AUDIT-ONLY until owner approval. Linked from
[design-audit README](../design-audit-2026-06-19/README.md) + `COMPLIANCE_GAPS_REGISTRY.md §H` + PROJECT_INDEX.*
