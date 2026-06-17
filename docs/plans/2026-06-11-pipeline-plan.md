# Pipeline (Operations) — build plan

Design: `docs/specs/2026-06-11-pipeline-design.md`. Per-slice workflow: scope → build →
`pnpm verify` ALONE (fresh :5433) → Audit Panel (CEO+Security+API+DB, ledger-appended) →
browser-verify live → commit (author Mayur, conventional, no AI trailer) → push (standing
approval) → memory update.

## Slice 0 — cases.api seed-flake root-cause (fix FIRST, CEO ledger priority)
Test factory helpers (`seedCaseWithTask` et al.) assert response status before dereferencing
bodies so a failed seed reports the real upstream error instead of `tasks[0] undefined`.
Rides with slice 1's commit train as its own commit.

## Slice 1 — tasks module: scoped paginated task list + stats + export
- `platform/scope`: `DimensionDef.taskPredicate?` + `composeScopePredicate(..., level)`;
  VERIFICATION_TYPE task leg `ct.verification_unit_id = ANY`; registry-lockstep test extended.
- `modules/tasks`: repository (TASK_FROM 1:1 joins, list/COUNT/stats/export sharing one WHERE
  builder + `taskScopePredicate`), service (TASK_PAGE_SPEC), controller, routes
  (`/stats`,`/export` before any param routes). SDK `tasks.ts` (TaskView, TaskStats) + client.
- Tests: envelope/sort/filter/limit-cap/injection-drop · hierarchy visibility (SELF/SUBTREE) ·
  VT task-level (user sees only tasks of assigned units — not whole cases) · territory expand ·
  custom-role RESTRICT fail-closed · detailless module (no /:id yet) · export modes + 403 ·
  stats scoped.
- Verify: list/stats/export live on dev :4000.

## Slice 2 — assignment hardening (mig 0036)
- Migration 0036: `case_tasks.version` + `task_assignment_history` (append-only trigger,
  pg_constraint-guarded, applied to dev :54329).
- Eligibility query (worker_role ∩ hierarchy ∩ territory-for-located-cases);
  `/tasks/assignable-users?taskIds=` intersection; `/cases/:id/assignable-users` upgraded.
- assign/unassign: scope-guard (out-of-scope → 404) + OCC (`version` required → 400/409) +
  history row in-tx; `CaseTaskView.version`; AssignTaskSchema + version.
- `POST /tasks/bulk-assign` per-row OCC/scope/eligibility/history.
- FE CaseDetailPage assign panel: send version + ConflictDialog on 409.
- Tests: OCC 400/404-vs-409 · scope-IDOR 404 · eligibility (wrong worker_role / out-of-territory
  / desk-role skip / unlocated skip) · history rows (assign→reassign→unassign trail) ·
  bulk per-row outcomes · intersection pool.

## Slice 3 — FE Pipeline page
- `features/pipeline/PipelinePage.tsx` + route `/pipeline` + nav enable (gate `case.view`).
- DataGrid: columns per design · status bucket bar (scoped counts) · row-select + Assign dialog
  (intersection pool, per-row results) · export · date filters · row-click → case.
- Playwright: pipeline list + bucket filter + a11y scan; browser-verify a real bulk assign
  persisted (fresh API read).

## Slice 4 — close-out
- Registry/ledger updates: B-20 residuals (assignment history, assignableUsers narrowing, VT
  task-level) → FIXED; MASTER_MEMORY build-order row; COMPLIANCE entries; memory file
  `project_crm2_operations_phase.md`.
- Full `pnpm verify` + Playwright; final Audit Panel.
