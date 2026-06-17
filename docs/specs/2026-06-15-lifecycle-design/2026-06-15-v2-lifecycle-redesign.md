# CRM2 — Case/Task Lifecycle Redesign

Date: 2026-06-15 · Author: CTO · Status: **PROPOSED (design-only, not built)** · ADR: 0032
Audit basis: `docs/specs/2026-06-15-lifecycle-audit/` (01–06). Owner decisions: 2026-06-15. Audit Panel: 5 FLAG / 0 BLOCK, all resolved (§11).

---

## 0. Owner decisions (the frame)

| # | Decision | Effect |
|---|---|---|
| D1 | **Single-layer (field records no result).** The field agent / device submits **evidence only** (form data + attachments + GPS) — never a result. | No v1 field-assessment column; no `task_backend_reviews` two-layer. |
| D2 | **Two independent completion tracks.** Field submission **auto-completes the TASK** (no mandatory review queue). The office **completes the CASE** separately. | TASK terminal = field-driven; CASE terminal = office-driven. |
| D3 | **Per-task office RESULT + one final case VERDICT — both office-authored, separate.** The backend records a result for **every** task (`case_tasks.verification_outcome`); from those it decides **ONE final** case verdict (`cases.verification_outcome`). The report prints per-task results **and** the one final verdict. | Per-task result KEPT (ADR-0025 not superseded — clarified as the office per-task report). Case verdict is net-new and authoritative for the case. |
| D4 | **Native `/api/v2` ingest + a rebased mobile release.** | Build clean `/api/v2` endpoints; device rebase is an accepted prerequisite. Locked contract SHAPES (ADR-0012) honored; only the base path moves `/api/mobile/* → /api/v2/*`. |

**Invariants protected:** KYC = a unit subtype (no separate engine); commission/billing **task-based**; revisit/recheck **lineage**; append-only assignment history + OCC version; default-deny RBAC + scope; append-only hash-chained audit; the **locked mobile dispatch contract** (shapes/headers/Idempotency-Key/409-semantics) — only the base path moves.

**Why this kills v1's fragmentation (VT-000199):** v1 printed `cases.verification_outcome` as a *stale last-write rollup* that never reflected the backend decision. Here `cases.verification_outcome` is an **explicit office verdict**, decided from the recorded per-task results — coherent by construction. The two columns have distinct, non-competing meanings (per-task office report → one derived case verdict), not two rival "results."

---

## 1. The two-track model

```
 ── TASK TRACK (per task; field- or desk-driven) ───────────────────────────────────────────
 PENDING → ASSIGNED → IN_PROGRESS → COMPLETED            (+ REVOKED, CANCELLED off-ramps)
          (assign)    (device start) (device submit / desk complete = AUTO, no review gate)
          ↑ per-task office RESULT recorded by backend on a COMPLETED task (status unchanged)
 ─────────────────────────────────────────────────────────────────────────────────────────
                                       │ rollup (all tasks terminal → AWAITING_COMPLETION)
                                       ▼
 ── CASE TRACK (one case; office-driven) ───────────────────────────────────────────────────
 NEW → IN_PROGRESS → AWAITING_COMPLETION → COMPLETED      (+ REVOKED, CANCELLED off-ramps)
      (1st task)   (all tasks COMPLETED)  (office records ONE final cases.verification_outcome)
 ─────────────────────────────────────────────────────────────────────────────────────────
```

- A field agent **never waits in a review queue** — submitting marks *their* task COMPLETED (D2).
- The per-task office **result** is recorded by the backend on a COMPLETED task; recording it does **not** change task status (decoupled — task is already COMPLETED).
- The case parks in **AWAITING_COMPLETION** until the office records the **one final verdict** and closes it (D2/D3).
- Rework is **always a NEW task** (revisit/recheck), never a re-open of a delivered task — the device-safety rule (§7).

---

## 2. TASK state machine

**Enum** (`case_tasks.status`): `PENDING, ASSIGNED, IN_PROGRESS, COMPLETED, REVOKED, CANCELLED`. `SUBMITTED_FOR_REVIEW` stays in the CHECK as an **inert** value (no producer/consumer; device-safe — kept per DB-auditor: removing it forces a narrow + zero-row scan + risks device enum tolerance).

| From → To | Trigger | Actor / perm | Surface | Side-effects |
|---|---|---|---|---|
| (create) → PENDING | add task, unassigned | office / `case.create` | web | task_number, audit |
| (create) → ASSIGNED | add task, assign-at-create | office / `case.create`+`case.assign` | web | assignment_history, version, notify |
| PENDING → ASSIGNED | assign / bulk-assign | office,MGR,TL / `case.assign` | web | assignment_history, version++, notify; eligibility re-check (pool∩hierarchy∩territory) |
| ASSIGNED → PENDING | unassign | office / `case.assign` | web | assignment_history(UNASSIGNED), version++ |
| ASSIGNED → ASSIGNED | reassign | office / `case.assign` | web | assignment_history(REASSIGNED), version++, notify |
| ASSIGNED → IN_PROGRESS | **device start** | field agent (assignee) / `task.execute` | **mobile** | started_at, version++, **409=success** |
| IN_PROGRESS → COMPLETED | **device submit** (form+attachments) | field agent (assignee) / `task.execute` | **mobile** | completed_at, form/attachments persisted, version++, **409=success**, notify office, rollup |
| ASSIGNED/IN_PROGRESS → COMPLETED | **desk complete** (KYC/OFFICE task) | backend user / `field_review.complete` | web | completed_at/by, version++, audit, rollup (may also set the per-task result in the same call) |
| (COMPLETED, status unchanged) | **record per-task office result** (`verification_outcome`+remark) | backend user / `field_review.complete` | web | result set on the task, audit; **no status change** |
| ASSIGNED/IN_PROGRESS/COMPLETED → REVOKED | revoke task (reason) | backend,MGR / `task.revoke` (web); device-initiated allowed for own active task | web/mobile | reason, version++, audit, **no commission**, rollup, REVOKED → device delta |
| PENDING/ASSIGNED → CANCELLED | cancel task | office / `case.assign` | web | audit, version++ (administrative kill before work) |

**Guards:** scope/IDOR → 404; OCC `version` mismatch → 409 STALE_UPDATE; illegal transition → 409 INVALID_TRANSITION. Every status writer **bumps `version`**. `task.execute` is **FIELD_AGENT-only** AND the endpoint asserts `assigned_to = actor` explicitly (do not rely on scope alone — Security MUST-FIX). Device may not drive COMPLETED → REVOKED.

---

## 3. CASE state machine

**Enum** (`cases.status`): `NEW, IN_PROGRESS, AWAITING_COMPLETION, COMPLETED, REVOKED, CANCELLED` (today: NEW/IN_PROGRESS/COMPLETED/CANCELLED → add AWAITING_COMPLETION, REVOKED).

| From → To | Trigger | Actor | Side-effects |
|---|---|---|---|
| (create) → NEW | create case | office / `case.create` | audit |
| NEW → IN_PROGRESS | first task created/assigned | rollup (auto) | — |
| IN_PROGRESS → AWAITING_COMPLETION | **all non-revoked tasks COMPLETED** | rollup (auto) | notify office queue |
| AWAITING_COMPLETION → COMPLETED | **office records ONE final `cases.verification_outcome` + closes** | backend user / `case.finalize` | verdict+remark set, completed_at/by, **case OCC version**, audit, notify |
| AWAITING_COMPLETION/COMPLETED → IN_PROGRESS | a revisit/recheck task added (re-open) | rollup (auto) | clears/invalidates the case verdict (must re-finalize), back-to-work |
| NEW/IN_PROGRESS/AWAITING_COMPLETION → REVOKED | revoke whole case | MGR,SA / `case.revoke` | audit |
| NEW/IN_PROGRESS → CANCELLED | cancel case | office,MGR / `case.create` | audit |

**Rollup service** (NEW — `caseStatusSync.recompute(caseId)`, called in-tx after every task status write): one **single aggregate query** over the case's tasks; **locks the `cases` row LAST** in a consistent order (cases→tasks elsewhere) to avoid deadlock; subsumes the existing un-OCC'd `addTasks` NEW→IN_PROGRESS flip (`repository.ts:380`) so there is **one** case-status writer. Ladder: `manual REVOKED (terminal) → COMPLETED (manual finalize only, never auto) → AWAITING_COMPLETION (all non-revoked tasks COMPLETED, ≥1 task) → IN_PROGRESS (any active task) → NEW (no tasks)`. **All-tasks-REVOKED does NOT auto-revoke the case** — case REVOKED is a manual MGR action only (resolves Principal M1). **COMPLETED is re-openable** by a revisit/recheck (resolves Principal M2 — COMPLETED is not terminal; rung above).

---

## 4. Result & report model (D1/D3)

| Layer | Column | Author | When | Printed? |
|---|---|---|---|---|
| Field evidence | form_data, attachments, GPS | field agent (device) | device submit | as evidence/appendix |
| **Per-task office result** | `case_tasks.verification_outcome` (POS/NEG/REFER/FRAUD) + remark | **backend user** | after task COMPLETED (or with desk-complete) | yes — per task |
| **Final case verdict** | `cases.verification_outcome` + `result_remark` | **backend user (`case.finalize`)** | at case completion, derived from per-task results | yes — the one official verdict |

- The field agent / device records **no result**. Single-layer.
- The client report prints the **per-task results** + the **one final case verdict** (`cases.verification_outcome`) — correct by construction (an explicit office decision, not a stale rollup). Fixes v1 VT-000199.
- **Anti-staleness:** a revisit/recheck re-opens the case (→IN_PROGRESS) and **invalidates the case verdict** → office must re-finalize (prevents the verdict drifting from changed task results).

---

## 5. Field-execution ingest spine (§5 — the missing half) — `/api/v2`

Honor the **locked contract** (ADR-0012): `Idempotency-Key` on every write; **409=success on start/complete/revoke ONLY** (NOT form-submit, NOT priority); multipart attachments `geoLocation`/`clientSha256`/`photoType`/`operationId`, EXIF-stripped, backend-watermarked. `:id` = task **UUID** (device throws on non-UUID).

| Endpoint (`/api/v2`) | From device call | Effect |
|---|---|---|
| `GET /sync/download` | (exists) | add execution fields (completedAt/formData/attachmentCount — already typed in `MobileSyncTask`, additive) + **populate the delta arrays** (revokedAssignmentIds/deletedTaskIds, today hard-coded `[]` at `sync/service.ts:86-90`). **Keep the `{success,message,data}` envelope — do NOT normalize to the list `Paginated` shape** (API-Contract FLAG; add a key-survival contract test). Never emit a null-`caseId` row. |
| `POST /verification-tasks/:id/start` | `/start` | ASSIGNED→IN_PROGRESS, started_at, 409=success |
| `POST /verification-tasks/:id/verification/:formType` | `/verification/{slug}` | persist form data (does not complete); 409 ≠ success here. Pin the 9 form-type slugs in the compat matrix. |
| `POST /verification-tasks/:id/attachments` (multipart) | `/attachments` | store bytes (MinIO/S3 ADR-0021), link to task, sha256 dedupe; reuse ADR-0025-B2 `case_attachments`; **scope-guard the upload** |
| `POST /verification-tasks/:id/complete` | `/complete` | IN_PROGRESS→COMPLETED (field auto), 409=success, rollup |
| `POST /verification-tasks/:id/revoke` | `/revoke` | →REVOKED, 409=success |
| `PUT /verification-tasks/:id/priority` | `/priority` | priority change (409 ≠ success) |

Auth = the assignee; **explicit `assigned_to = actor`** + scope (404 IDOR-safe). The device 404s on these paths until rebased (slice 6) — accepted, shape-preserving so the rebase is path-only.

---

## 6. Migration sketch (next = 0052)

- **0052_case_lifecycle.sql:**
  - `cases.status` CHECK → drop-then-add `(NEW, IN_PROGRESS, AWAITING_COMPLETION, COMPLETED, REVOKED, CANCELLED)`. **Strict superset → no data migration** (DB-auditor confirmed). No `ADD CONSTRAINT IF NOT EXISTS` in pg → drop-then-add.
  - **`cases.version integer NOT NULL DEFAULT 1`** — `cases` has NO version column today (verified: 0017/0036 never added it). Required for case-level OCC on `case.finalize` (a money/race path). **DB MUST-FIX.**
  - `cases.verification_outcome` (CHECK POS/NEG/REFER/FRAUD, NULL ok) · `cases.result_remark` · `cases.completed_at` · `cases.completed_by` (FK-less, matches pattern).
  - `case_tasks.started_at` · `case_tasks.form_data jsonb`. `completed_at`/`completed_by` already exist (0041) — **reuse, do not re-add**. `case_tasks.verification_outcome` (0041) **KEPT as the per-task office result** (D3 — not demoted).
- **0053_task_lineage.sql:** `case_tasks.parent_task_id` (self-FK, ON DELETE NO ACTION) · `case_tasks.task_origin` CHECK `(ORIGINAL, REVISIT, RECHECK)` DEFAULT 'ORIGINAL' (backfills existing rows) · partial `idx_case_tasks_parent ON case_tasks(parent_task_id) WHERE parent_task_id IS NOT NULL`.
- Rollup + AWAITING_COMPLETION queue need **no new index** (existing `idx_case_tasks_case` 0010:70 + `idx_cases_status` 0010:30 cover them; v2 volumes tiny).
- `appendAudit` on finalize/revoke in-tx (reuses the 0017 immutable audit_log trigger); verify `FINALIZE`/`REVOKE` against the audit_log action CHECK (add to the union if absent).
- Forward-only, idempotent, triple-write (file → test:5433 auto → dev:54329 `psql -f`); no v2 prod.

---

## 7. Revoke / Revisit / Recheck (v1-parity, device-safe)

| Action | Mechanism | Commission | Case effect | Device safety |
|---|---|---|---|---|
| **REVOKE** | task → REVOKED in place; reason | none | rollup recomputes; case stays unless manually revoked | device handles REVOKED natively; revokedAssignmentIds delta |
| **REVISIT** | **NEW** task, `task_origin=REVISIT`, `parent_task_id` lineage, copies CPV+rate; reassignable | commissions normally | re-opens case → IN_PROGRESS, invalidates verdict | new sync row; never re-opens a delivered task |
| **RECHECK** | **NEW** desk/KYC task, `task_origin=RECHECK`, lineage; fresh | per rate (KYC may be NULL) | re-opens case → IN_PROGRESS, invalidates verdict | same |

**Hard rule:** never transition a `COMPLETED` task back to active on the device. Rework = a new task (mobile landmine #2).

---

## 8. RBAC (default-deny; new perms — Security PASS, seed exactly these + parity test)

| Perm | Holders | Used by |
|---|---|---|
| `task.execute` (NEW) | FIELD_AGENT only (own assigned; explicit `assigned_to=actor`) | device start/submit/complete |
| `task.revoke` (NEW) | BACKEND_USER, MANAGER | revoke task |
| `field_review.complete` (exists) | BACKEND_USER, SA | desk-complete + record per-task office result |
| `case.finalize` (NEW) | BACKEND_USER, SA | record final case verdict + close |
| `case.revoke` (NEW) | MANAGER, SA | revoke whole case |
| `case.assign`/`case.create`/`case.view` (exist) | per matrix | assign/create/read |

KYC_VERIFIER stays **read-only** (view+download evidence; no execute/complete/finalize) — ADR-0025 unchanged. **Every** endpoint composes `resolveScope` + scope predicate (404 out-of-scope). **`case.finalize` + the AWAITING_COMPLETION queue MUST apply CASE-grain row-level scope** — the cases list has no row-scope today (carried OPEN since 2026-06-06); without it a BACKEND_USER could finalize out-of-portfolio cases (horizontal privesc on the authoritative verdict). **Security: blocking for slice 1.** Office-queue `ORDER BY` via sortMap whitelist; scope on items **and** COUNT.

---

## 9. Web / mobile split

- **Mobile (field agent only):** start, save-draft (local, no API), submit form, upload attachments, complete, revoke, priority. Never sees a review state; submit == task complete.
- **Web (office/backend/MGR/TL/KYC):** create case, add tasks, assign/reassign/unassign, desk-complete, **record per-task office result**, **case-finalize (record final verdict + close)**, revoke, revisit, recheck, Pipeline queue, the new **AWAITING_COMPLETION office queue** (Pipeline bucket).
- KYC_VERIFIER: web read-only evidence view.

---

## 10. Build slices (on approval — NOT this session). Each: migration→sdk→api→web→tests, `pnpm verify` green, Audit Panel, browser-verify.

1. **mig 0052** (+ `cases.version`) + case rollup service (single writer) + per-task office-result recording + `case.finalize` (case verdict + close, **case-grain scope**) + result/verdict UI.
2. **Field ingest spine `/api/v2`** (start/submit/complete/revoke/attachments) honoring the locked contract + sync delta arrays + **contract tests against the locked shapes** (device stays on v1 until slice 6).
3. **mig 0053** + revisit/recheck (new-task-with-lineage) + revoke.
4. Pipeline AWAITING_COMPLETION bucket + status labels (REVOKED/AWAITING_COMPLETION) + result/verdict display.
5. Commission/billing gate (**per-task** on TASK COMPLETED & !REVOKED, independent of result/verdict) — engine later.
6. crm-mobile-native rebase `/api/mobile → /api/v2` + coordinated device release (separate repo).

**Ordering note (Principal):** slice 1 (rollup) before slice 2 (ingest) → AWAITING_COMPLETION is only fully exercisable after slice 2; slice 2 ships contract tests since the device stays on v1 until slice 6.

---

## 11. Audit Panel resolutions (2026-06-15 — 5 FLAG / 0 BLOCK)

| Auditor | Finding | Resolution |
|---|---|---|
| CEO | F1 commission timing contradiction (auto-complete vs settle-at-finalize) | **Per-task on TASK COMPLETED & !REVOKED**, independent of case verdict (protects the task-based-billing invariant). §10.5. |
| CEO | F2 multi-task one-result regression | **Owner-resolved:** per-task office results recorded for all tasks → one final case verdict derived. §0 D3, §4. |
| CEO | F3/F4 finalize TOCTOU; dual-column fragmentation | `cases.version` OCC (§6); two columns given distinct non-competing meanings + verdict-invalidation on re-open (§4). |
| Principal | M1 two REVOKED paths | All-tasks-revoked does NOT auto-revoke; case REVOKED manual-only. §3. |
| Principal | M2 COMPLETED not terminal | COMPLETED **re-openable** via revisit/recheck; rung specified. §3. |
| Principal | M3 demote-readers trap | Per-task column **kept** (no demotion) per D3 → readers unaffected. §6. |
| Principal | M4 complete schema requires result | Field/desk `/complete` records **no** result; per-task result is a **separate** office action; verdict only in `case.finalize`. §2/§4. |
| Principal | S1/S2 rollup deadlock/N+1; single writer | Single aggregate query, lock `cases` last; subsumes the `addTasks` flip. §3. |
| DB | M1 `cases` has no `version` | Added in 0052. §6. |
| DB | audit on finalize/revoke; parent_task_id index | Folded. §6. |
| Security | task.execute hierarchy-scoped not assignee | FIELD_AGENT-only + explicit `assigned_to=actor`. §2/§8. |
| Security | case.finalize/queue inherit no-row-scope (blocking) | CASE-grain scope mandated for slice 1. §8. |
| API-Contract | don't normalize sync envelope; pin verbs/slugs; no null caseId | Folded as build-contract notes. §5. |
