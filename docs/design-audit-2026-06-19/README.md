# V2 Frontend Design-Compliance Audit — `apps/web`

**Date:** 2026-06-19 · **Scope:** `apps/web` only (the RN app `crm-mobile-native` is a separate repo / separate audit) · **Type:** AUTHORIZED audit (the "no audits unless asked" freeze was waived by the owner for this run) · **Status:** AUDIT-ONLY — no code changed, no redesign. Remediation is proposed, **not** implemented, pending owner approval.

**Audited revision:** clean worktree at `origin/main` = `11997a1` (latest FE). Code evidence cites this tree. Live visual checks ran against the local dev server (main tree `22bfdfc`); the 5 FE files changed in the 23-commit gap (`DataGrid`, `Billing`, `CommissionRates`, `Pipeline`, `CaseDetail`) were audited from **code** at `origin/main`, not the slightly-stale live render.

## Documents in this folder
| File | Contents |
|---|---|
| [README.md](./README.md) | This index — methodology, executive summary, top patterns, disclosures |
| [CHECKLIST.md](./CHECKLIST.md) | The canonical 13-dimension PASS-rule + reuse-primitive checklist (Phase 1) |
| [MATRIX.md](./MATRIX.md) | Page × Dimension compliance heat-map (22 × 13) |
| [FINDINGS.md](./FINDINGS.md) | All 126 findings, prioritized P0→P3, each with file:line evidence + additive fix |
| [PER_PAGE.md](./PER_PAGE.md) | Per-page detail: every dimension verdict + evidence/gap + overall |
| [REMEDIATION_PLAN.md](./REMEDIATION_PLAN.md) | Prioritized fix plan grouped by cross-cutting pattern (fix a primitive once → applies to N pages) |
| [VISUAL_VERIFICATION.md](./VISUAL_VERIFICATION.md) | Live browser sweep (mobile/tablet/desktop/dark) findings + corroboration |
| [CROSS_SWEEPS.md](./CROSS_SWEEPS.md) | The 4 whole-app specialist sweeps (tokens · tables-parity matrix · a11y · component-reuse) |
| [SKEPTIC.md](./SKEPTIC.md) | Adversarial re-verification — 17 load-bearing verdicts re-checked at source; 2 calibration refinements |
| [../plans/2026-06-20-frontend-design-compliance-fix-plan.md](../plans/2026-06-20-frontend-design-compliance-fix-plan.md) | **Multi-agent fix plan** — Foundation (shared primitives) → Wave 1 (P1) → Wave 2 (contract) → Wave 3 (polish) → Wave 4 (inline add/edit) → Wave K (keyboard); agent assignments, TDD steps, verification matrix |
| [ADD_EDIT_PATTERN.md](./ADD_EDIT_PATTERN.md) | **D14 follow-up audit** — popup-vs-inline add/edit across all pages; owner target = inline (no popups); ADR-gated standardization plan |
| [KEYBOARD_NAV.md](./KEYBOARD_NAV.md) | **D15 follow-up audit** — keyboard navigation; 5 confirmed P1 blockers (DataGrid sort/row-click keyboard-unreachable, etc.) |

## Methodology (multi-agent, adversarial)
1. **Phase 1 — checklist (1 agent):** distilled an objective, testable 13-dimension checklist from `DESIGN_AND_STACK_FREEZE.md`, `ENGINEERING_STANDARDS.md`, `CI_CD_STANDARDS.md`, the `@crm2/ui-theme` tokens, and the actual shared primitives → [CHECKLIST.md](./CHECKLIST.md).
2. **Phase 2 — page audits (22 agents, parallel):** one agent per page/tight-group scored all 13 dimensions PASS/PARTIAL/FAIL/N-A/UNVERIFIED with file:line evidence + severity-ranked findings + the additive fix. Plus cross-cutting specialist sweeps (tokens ✅; tables/a11y/reuse ⚠️ see disclosure).
3. **Live visual verification (orchestrator):** logged in as SUPER_ADMIN against the running app; checked responsive behaviour at 375/768/1280 + dark, the mobile drawer, DataGrid card-stacking, focus-trapped dialogs, status badge tones, and form states → [VISUAL_VERIFICATION.md](./VISUAL_VERIFICATION.md).
4. **Skeptic spot-check (orchestrator):** the dedicated skeptic agent died on the session limit (below), so the load-bearing P1 claims (RBAC leaks on Templates/Cases, Commission-Rates focus-trap) were re-verified by hand against the worktree — **all confirmed**.

## Run status & disclosures
- **COMPLETE.** The first pass (1 checklist + 22 page audits + tokens sweep) hit the account session-token cap, which killed 3 whole-app sweeps + the skeptic mid-run. These were **re-run successfully after the 8pm IST cap reset** (a second completion workflow) — all 4 specialist sweeps ([CROSS_SWEEPS.md](./CROSS_SWEEPS.md)) and the skeptic ([SKEPTIC.md](./SKEPTIC.md)) finished.
- **Skeptic outcome:** 17 load-bearing verdicts re-verified at source — **no false-PASS, no false-FAIL**; the page audits + sweeps are reliable. Two **calibration refinements** (severity/scope, not code-fact errors), already folded into FINDINGS/registry below:
  1. **Templates RBAC leak → P2-latent (not P1):** the code fact (no `useAuth` gating) is solid, but `page.templates` is held only by SUPER_ADMIN in the *seeded* roles, so the leak is reachable only via a custom runtime role. The **Cases-list `+New Case` and Rate-Management** leaks stay **P1** — seeded TL/BE/MGR roles genuinely hit them (`case.view`≠`case.create`; `page.masterdata`≠`masterdata.manage`).
  2. **Billing bespoke-table → scoped down:** the case-lines table sits inside DataGrid's sanctioned `renderExpanded` master-detail slot (not a violation); only the standalone breakdown panels are a fair flag.
- **Tables sweep nuance:** the DataGrid backs **all 19 paginated list pages**; bespoke `<table>`s are confined to detail/child/modal/rollup surfaces where pagination machinery is overkill — defensible, not blanket violations (softens H-5). The real table-layer gaps are **parity** (a list omitting an opt-in DataGrid capability like export/date-filters), e.g. the **Cases list has no export + no date filters** (P2).
- **Live render is the main tree (23 commits behind) for 5 changed files** — those 5 were audited from code at `origin/main`; all other pages render latest.

## Executive summary
The v2 web frontend has an **excellent shared-primitive foundation** and the admin/list surfaces are largely exemplary. Of 286 page×dimension cells: **131 PASS · 88 PARTIAL · 34 FAIL · 32 N/A · 1 UNVERIFIED**. Findings: **0 P0 · 25 P1 · 56 P2 · 45 P3 (126 total)**. Nothing is broken or inaccessible (no P0); the gaps are **consistency of adoption** — newer/bespoke surfaces (Dashboard, Case detail, Case create, Commission Rates, Policies, RBAC Roles, Security, the header popovers) skip primitives that the admin CRUD cluster and the Universal DataGrid already nail.

**The Admin CRUD cluster + DataGrid are the gold standard** — they correctly compose DataGrid + StatusChip + ConflictDialog + BulkStatusActions + ImportModal + apiExport + useFocusTrap + formatDateTime. The remediation is almost entirely *"adopt the primitive that already exists, on the pages that hand-rolled around it."* Every fix is additive; none requires an architecture change.

### Top cross-cutting patterns (fix once → many pages)
| # | Pattern | Sev | Pages affected | Already tracked? |
|---|---|---|---|---|
| R1 | **RBAC-UI client-gating leaks** — write buttons/actions shown to users the server will 403 (no `useAuth().has()` gate) | **P1** (Cases `+New Case`, Rate Management — seeded-role-reachable) + P2-latent (Templates, RBAC Roles, Policies — custom-role-only) | Cases, Rate Management, Templates, RBAC Roles, Policies | **Net-new** ⭐ |
| R2 | **Bespoke dialogs/popovers not focus-trapped** — skip `useFocusTrap` + dialog/menu semantics (axe-gate risk) | 5× P1 | Commission Rates, RBAC Roles, Security, App-Shell Jobs/Bell/Account popovers | partial (C-9) |
| R3 | **Non-standard loading/error states** — bespoke `…`/`Loading…`, no error+Retry, error silently coerced to empty | 4× P1 | Dashboard, CPV, Policies, Security, NotificationBell, Case detail/create | partial (B-7/B-8) |
| R4 | **Forms bypass RHF + `zodResolver(@crm2/sdk)`** — hand-rolled `useState` + button-disable; OCC 409 shown as inline string not `ConflictDialog` | 4× P1 | Commission Rates, Policies, Report Layouts, + admin dialogs | partial (C-10) |
| R5 | **Embedded sub-lists are bespoke `<table>`, not DataGrid** — no pagination/URL-state/filter contract | 3× P1 | Dashboard portfolio, Case detail (tasks/attachments), CPV units, Profile sessions, Billing, Commission | partial (C-9) |
| R6 | **Export/pagination contract bypass** | 2× P1 | Users (`Export Scope` skips the 413/job threshold), Case detail (unbounded arrays), Policies (no export) | partial (B-13) |
| R7 | **Token slips** — `text-st-completed` (dead, non-existent token → unstyled) + `text-amber-600` (raw palette) | 1× P1 | Case create, AddTasksForm | Net-new ⭐ |
| R8 | **Status/money/date not via shared fmt** — status as plain text not `StatusChip`; inline date/₹ | P2/P3 | Cases list, Case detail, Billing, several | Net-new ⭐ |

⭐ = not yet in `COMPLIANCE_GAPS_REGISTRY.md` — the highest-value delta from this audit. R1 (RBAC-UI leaks) is the priority: it is a real authorization-UX inconsistency that newer pages reintroduced after the admin cluster got it right.

See [REMEDIATION_PLAN.md](./REMEDIATION_PLAN.md) for the sequenced plan and [FINDINGS.md](./FINDINGS.md) for every finding with evidence.
