# Cross-System Lifecycle Gap Map — Case/Task Status & Workflow

Date: 2026-06-15 · Author: CTO (orchestrated audit) · Status: AUDIT (design not yet drafted)
Sources: `01-v2-backend.md`, `02-v2-frontend.md`, `03-mobile.md`, `04-v1-production.md`, `05-zion.md` (this folder).

## 1. Status enums side-by-side

| | CASE statuses | TASK statuses |
|---|---|---|
| **v1 (prod)** | PENDING, ASSIGNED, IN_PROGRESS, SUBMITTED_FOR_REVIEW, COMPLETED, REVOKED (derived rollup) | PENDING, ASSIGNED, IN_PROGRESS, SUBMITTED_FOR_REVIEW, COMPLETED, REVOKED |
| **v2 backend** | NEW, IN_PROGRESS, COMPLETED, CANCELLED (**only NEW→IN_PROGRESS ever fires; no rollup → case never completes**) | PENDING, ASSIGNED, IN_PROGRESS, SUBMITTED_FOR_REVIEW, COMPLETED, REVOKED, CANCELLED (**4 of 7 have zero producers**) |
| **mobile (device)** | none (no case entity; caseId is opaque display) | PENDING, ASSIGNED, IN_PROGRESS, COMPLETED, REVOKED + local SAVED / SUBMITTED_PENDING_SYNC. **SUBMITTED_FOR_REVIEW normalized→COMPLETED at ingest** (agent never sees review) |
| **Zion** | 3 buckets: BUCKET → ASSIGN → COMPLETED + TRASH | unit = document; flat tags (visit type, LOCAL/OGL, BILL Y/N), not states |

## 2. The result/outcome model — the central divergence

- **v1:** TWO-LAYER. Field FE-assessment `verification_reports.final_status` (immutable) **≠** backend final decision `task_backend_reviews.backend_final_result` (append-only, `is_current`). Official = per-task backend decision. **BUG (prod-proven, VT-000199): client PDF prints `cases.verification_outcome`, a stale last-write-wins column — NEVER the backend decision.** = "result fragmentation" (4 result columns). `v_task_finalization` has 0 readers.
- **v2 backend:** SINGLE-LAYER. One `case_tasks.verification_outcome` (POSITIVE/NEGATIVE/REFER/FRAUD), written only by the office `complete` endpoint. No field-assessment column, no `task_backend_reviews`, no `cases.verification_outcome`. Clean — but does NOT implement the stated "FE-assessment ≠ backend-final-result" invariant.
- **Zion:** ONE result field (`FINAL STATUS`), set once by the operator at report time. Coherent by construction.

**Tension:** the kickoff lists "FE-assessment ≠ backend-final-result" as an invariant to PROTECT, but v2's shipped code is single-layer. This must be resolved by the owner (see Decisions doc).

## 3. The missing spine — field execution & ingest (§5)

- v2 `/sync/download` (read-model) is **download-only**; delta arrays are hard-coded empty. There is **NO field-submission ingest endpoint** in v2.
- Consequence: TASK statuses IN_PROGRESS and SUBMITTED_FOR_REVIEW have **no producer** — a field agent on v2 can never move a task past ASSIGNED. The office `complete` accepts a SFR source state that nothing ever creates.
- v1 has the full spine: device start → IN_PROGRESS; submit form → SFR (flag ON) or COMPLETED (flag OFF); office `/finalize` → COMPLETED + commission.
- Mobile is **still on `/api/mobile` (v1)**, not rebased to `/api/v2`. v2 has built only the download half of the mobile contract.

## 4. Revoke / Revisit / Recheck

| Action | v1 behavior | v2 status |
|---|---|---|
| REVOKE | in-place → REVOKED; no commission; no new task | **ABSENT** (REVOKED is a dead enum) |
| REVISIT | NEW child task `task_type=REVISIT`, `parent_task_id` lineage, copies rate, commissions, re-opens case | **ABSENT** |
| RECHECK | NEW KYC task + `recheck_of_kyc_id`, fresh cycle, no commission (KYC rate NULL) | **ABSENT** |
| Zion equiv | revisit = add another document (no lineage); "Refer" = routing/billing tag | — |

**Key safety note (from mobile audit):** re-opening an already-submitted task on the device is DANGEROUS — the device has marked it COMPLETED and purged photos; the conflict resolver ignores the downgrade → work is never redone. v1's "new task" (revisit) model sidesteps this. Any v2 rework MUST be a NEW task, never a re-open of a delivered one.

## 5. Commission / billing touchpoints

- v1: per-task commission, immutable (`ON CONFLICT DO NOTHING`), gated `status=COMPLETED AND status!=REVOKED` + rate_type + assignee + active assignment; deferred to `/finalize` when review flag ON; KYC = no commission.
- v2: entirely unbuilt (only `billing.generate` perm + a dashboard widget + `commission_profile`/`billing_profile` flags exist). Lifecycle must expose the gate (COMPLETED & !REVOKED) for a later billing engine.

## 6. Mobile break-risk register (v2 must honor)

1. Any new lifecycle state reaching the device un-normalized → invisible "UNKNOWN" orphan (lands in no tab, ignored by counts).
2. Re-opening a submitted task → device already COMPLETED + photos purged → silent work loss.
3. Endpoint/verb/slug change (e.g. forced `/api/v2` move) → 404/405 → dead-letter queue, no auto-rebase.
4. Changed 409 semantics → submit false-fails or start/complete idempotency breaks (409=success on start/complete/revoke ONLY, not priority/form-submit).
5. Identity-field churn (`id`, `caseId`, UUID `verificationTaskId`) → rows dropped at schema/upsert; every write throws.

## 7. What v2 must decide / build (feeds the design)

- **D1 Result model:** keep single-layer (Zion-simple, shipped) vs adopt two-layer separation-of-duties (v1 parity, the stated invariant). **KEYSTONE — owner.**
- **D2 Field review gate:** mandatory office finalize for every field task (SFR → office records official result → COMPLETED) vs allow auto-complete. **Owner.**
- **D3 Mobile delivery:** build the ingest spine as a byte-compat mobile surface on v2 (device unchanged) vs `/api/v2` + a later device release. **Owner (architecture).**
- **D4 Case enum + rollup:** align v2's case enum to v1 (add PENDING/ASSIGNED/SUBMITTED_FOR_REVIEW/REVOKED) and build the rollup service. **CTO call, pending D1/D2.**
- **D5 Revoke/Revisit/Recheck:** adopt v1's new-task-with-lineage model (protects the device, gives clean billing/audit). **CTO recommendation = yes (matches the protected invariant); confirm scope.**
