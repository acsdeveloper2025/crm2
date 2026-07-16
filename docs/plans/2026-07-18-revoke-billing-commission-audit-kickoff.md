# Kickoff — 2026-07-18 · Revoke → billing & commission audit (crm2)

**Repo:** ✅ `crm2` (`/Users/mayurkulkarni/Downloads/crm2`) — server-side. No mobile change expected.

## The report (owner, verbatim)

> Audit the **Revoke Task** functionality. When a task is revoked and reassigned to another field agent:
> 1. **Only one bill** should be generated for the verification.
> 2. The **revoked task must not create an additional bill**.
> 3. The **reassigned task** should continue as the active task and be the only one considered for billing.
>
> **Field-agent commission:** a revoked task should **not** be eligible for any commission — none
> calculated, none paid. Commission only for the successfully completed, valid task.
>
> **Current issue:** when a task is revoked and reassigned, the system generates billing for **both**
> tasks (duplicate billing), and the revoked task is also considered during billing calculations.

Ensure: no duplicate billing · revoked tasks excluded from billing · revoked tasks excluded from
field-agent commission · **only the final valid completed task** is used for billing and commission.

---

## ⚠️ Read this first: the code contradicts the report. Find out why before changing anything.

A first pass (2026-07-17) says **both filters already exist**. Do NOT "fix" them until the real
reproduction is found — you would be patching a symptom that the code says cannot happen, which is how
you end up with a second drifted copy of a rule.

| Rule | Where | What it says today |
|---|---|---|
| Billing lines | `apps/api/src/modules/billing/repository.ts:85` | `` const where = [`ct.status = 'COMPLETED'`] `` — **COMPLETED-only.** A REVOKED task cannot produce a billing line. |
| Billing lines (comment) | `billing/repository.ts:27,79` | *"one row per COMPLETED billable task"* / *"COMPLETED-only (a billing line = a billed task)"* |
| Commission summary | `billing/repository.ts:174` | `` const where = [`ct.status IN ('SUBMITTED', 'COMPLETED')`] `` — REVOKED excluded. |
| Commission detail | `billing/repository.ts:219` | same filter. |

**So the reported symptom should be impossible via revoke.** `revokeTaskInPlace`
(`modules/cases/repository.ts`) only transitions **ASSIGNED/IN_PROGRESS → REVOKED** — a COMPLETED task
cannot be revoked, and a REVOKED task is neither COMPLETED nor SUBMITTED.

### The most likely real cause — start here

**REVISIT (ADR-0033), not revoke.** `revisitTask` re-opens a **COMPLETED** task by creating a NEW
lineage-linked task (`cases/service.ts` ~:586 — *"the parent must be COMPLETED … Creates a NEW
lineage-linked task"*). If the replacement also completes, you now have **two COMPLETED tasks for one
verification** → **two billing lines**, which matches "billing for both tasks" exactly. The owner may be
describing the revisit flow using the word "revoked".

Distinguish the three lineage flows before touching any SQL — they have different parents and different
billing consequences:

| Flow | Parent must be | Creates | Both COMPLETED? |
|---|---|---|---|
| `revisitTask` | **COMPLETED** | new lineage task | **YES — the duplicate-billing candidate** |
| `reassignRevokedTask` | **REVOKED** | new ASSIGNED replacement | No — parent is REVOKED, not billable |
| auto-revoke sweep (**new**, ADR-0095) | ASSIGNED/IN_PROGRESS | nothing | No |

### Other candidates, in order

1. **`bill_count`, not row count.** Billing multiplies `rt.bill_amount * ct.bill_count`
   (`billing/repository.ts:258,274`). `billCount` is set at **assign** time. Does a replacement task
   inherit or re-add a bill count? Two tasks each with `bill_count = 1` = two bills even if each row is
   "correct".
2. **Commission includes `SUBMITTED`** (`:174`, `:219`), not just COMPLETED. A task the agent submitted
   but the office never completed still earns commission. Is that intended? It is a real difference from
   the billing rule (COMPLETED-only) and the owner's words are *"successfully completed and valid task"*.
3. **`COMMISSION_LATERAL` joins on `ct.assigned_to`** (`platform/billing/laterals.ts:64`) — and **revoke
   deliberately KEEPS `assigned_to`** (the assignee is retained for lineage, and it is what makes the
   revoke reach the device). So a revoked task still resolves a commission rate; only the status filter
   keeps it out. If any commission query is missing that filter, the revoked agent gets paid. **Grep every
   consumer of `COMMISSION_LATERAL` and check each one's status predicate.**
4. **A snapshot path.** Billing uses `COALESCE(snapshot, live)` (`:285`, `COMPLETED_BAND` at `:48`) — if a
   rate/commission was snapshotted onto a task before it was revoked, is the snapshot still readable
   anywhere that does not filter status?
5. **MIS / exports / dashboards.** The billing page is not the only surface that counts money. The
   2026-07-14 audit found a **LIVE `/rates/export` cross-client pricing leak** (see
   `docs/COMPLIANCE_GAPS_REGISTRY.md`) — export paths have their own SQL and drift independently.

---

## Method

1. **Reproduce first, on data.** Ask the owner for a case number showing the duplicate. Without it, build
   one on staging: complete a task → revisit it → complete the replacement → look at the billing page.
   Then: assign → revoke → reassign → complete → look again. **One of those two produces the duplicate;
   the other does not.** That single fact redirects the whole audit.
2. **Find every rule, then diff the copies.** The interesting finding is usually that copies of one rule
   already disagree. `grep -rn "status = 'COMPLETED'\|status IN (" apps/api/src/modules/billing
   apps/api/src/platform/billing apps/api/src/modules/mis` — bill lines, bill summary, commission
   summary, commission detail, MIS, exports. Do they agree on which statuses are billable?
3. **One definition, imported.** If a rule is re-typed, extract it the way `TASK_OVERDUE_SQL`
   (`platform/tat/overdue.ts`) was after the same disease cost a live prod bug on 2026-07-15 — four
   hand-typed copies, two drifted, two screens disagreeing about the same task. That file's header is the
   precedent to copy.
4. **Test-first, and verify the revert.** `pnpm verify` green + integration tests (need `DATABASE_URL`;
   ephemeral Postgres on `:5433`, `LC_ALL=C`). **A test that cannot fail is worthless:** re-introduce the
   bug and confirm the test goes red. Beware relative assertions — on 2026-07-17 a sweep test asserted
   `WINDOW ± 1` and stayed green when the window changed 45→0. Assert absolutes.
5. **Money is never lazy.** Do not simplify away a status filter you cannot explain. If two rules
   genuinely differ (billing COMPLETED-only vs commission SUBMITTED+COMPLETED), that may be *correct* —
   document why, do not merge them. Similar ≠ same.

## Landmines

- **`ct.bill_count` is a multiplier, not a flag.** Fixing "duplicate rows" without checking `bill_count`
  fixes half the bug.
- **Revoke keeps `assigned_to`** — deliberate (`cases/repository.ts` ~:1471; the device matches on it).
  Anything reasoning "revoked ⇒ unassigned" is wrong.
- **Commission has snapshot + live paths** (`COALESCE(snapshot, live)`). Two places to get status wrong.
- **A new source of REVOKED rows shipped 2026-07-17** — the ADR-0095 abandonment sweep auto-revokes
  ASSIGNED/IN_PROGRESS tasks past 45 days, hourly, in prod. Billing is COMPLETED-only so this *should* be
  inert, but it means **revoked rows are about to become far more common**. If any money path counts them,
  this audit just became urgent. Confirm inertness early.
- **`/api/v2` is additive-only. Migration BEFORE code** (deploys do not run migrations). Next migration =
  **0121**, next ADR = **0096** (re-verify: `ls db/v2/migrations | tail -1`, `ls docs/adr | tail -2`).
- **Billing ⟂ commission is a deliberate split** (2026-06 era) — do not re-couple them.
- The append-only audit guard blocks deletes on prod; backups in `~/crm2-prod-backups/`.

## Definition of done

The reproduction is named (revisit vs revoke+reassign) and fixed at the root, not per-caller · every
money rule ends **FIXED / DEFERRED / WONTFIX** in `docs/COMPLIANCE_GAPS_REGISTRY.md`, none silently
dropped · one definition per rule, imported, with a test that fails on revert · `pnpm verify` green ·
staging verified on real data before prod · ADR if a frozen surface moves · nothing pushed without the
owner's OK.

---

## State at handoff (2026-07-17)

- **crm2 `main` = `8ae54eb`, pushed. `prod` fast-forwarded to the same commit — LIVE on AWS**
  (deploy `29506656979` green; health 200). CI green: static · secret-scan · test · build · e2e.
- **ADR-0095 abandonment sweep is LIVE on prod**: hourly, auto-revokes ASSIGNED/IN_PROGRESS past 45 days,
  notifies the dispatching backend user. No migration. 9 integration checks.
  ⏳ **Owner still to run the backlog count** — the first sweep revokes everything already past the window
  (capped 200/tick, hourly):
  ```sql
  SELECT count(*) FROM case_tasks
  WHERE status IN ('ASSIGNED','IN_PROGRESS') AND assigned_at < now() - interval '45 days';
  ```
- **Mobile `v1.0.83` released** (`crm-mobile-native`) — fixes a staging pin break; v1.0.82's staging APK
  cannot connect on devices that trust ISRG Root X2. Tell testers to install **1.0.83**.
- Next migration = **0121** · next ADR = **0096** (re-verify).

### Still open from 2026-07-17 (not part of this audit, but do not lose them)

- 🔴 **`attachmentForAccess` (`modules/cases/repository.ts:1870`) has no `kind` filter** — a `case.create`
  holder can delete **frozen field evidence** through the docs endpoint, bypassing the SUBMITTED freeze
  the device path enforces. Zero test coverage on that route; it also orphans the photo's `thumbnail_key`.
  **Owner call:** is admin photo-deletion an intended DPDP capability? If yes it still needs its own gate;
  if no, add `AND ca.kind = 'OFFICE_REF'` and split a reader for the URL route.
- **MIS "Field Photos" (`modules/mis/reportTypes.ts:326`) omits `deleted_at IS NULL`** — over-reports vs
  the report's own `totals.photoCount`.
- **DPDP:** mobile auto-save PII is unbounded for tasks that never reach a terminal state (the 7-day purge
  is manual-tap-only).
- **Mobile save-gate never verified on-device** — `smokefa` has 0 ASSIGNED tasks; needs one assigned.
</content>
