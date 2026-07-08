# Kickoff prompt — Build the Client Setup hub + onboarding workbook (ADR-0092, Batch 3)

> Paste into a fresh session in `/Users/mayurkulkarni/Downloads/crm2`. Everything is designed,
> adversarially reviewed, and **owner-approved** — this session BUILDS. Est. ~5–6 focused sessions
> total (spec §8 slices); this kickoff covers S1 onward, slice by slice.
> **Read in order first:** `CLAUDE.md` → `CRM2_MASTER_MEMORY.md` §8 →
> `docs/specs/2026-07-07-client-setup-hub-design.md` (SoT — Revision 1, post-3-lens-review) →
> `docs/adr/ADR-0092-client-setup-hub-onboarding-workbook.md` (**Accepted**, incl. the UX-8 pick) →
> the audit that motivates it `docs/audit/admin-masterdata-ux-2026-07-07/ADMIN_MASTERDATA_UX_AUDIT.md`
> (§1 journey numbers) → memory `project_admin_masterdata_ux_audit_2026_07_07`.

## Decided & frozen inputs (do NOT re-litigate)
- **ADR-0092 Accepted** (owner 2026-07-08). **UX-8 = option (b)-for-workbook**: strict row errors
  `RATE_TYPE_NOT_ASSIGNED` / `CPV_LINK_MISSING` / unknown-rate-type on the NEW workbook surface only;
  existing endpoints unchanged (additive-only). Residual documented in the ADR.
- Hub `/admin/client-setup`: stepper embedding EXISTING pages via a **controlled `clientId?` prop**
  (page hides its own client picker when provided) + additive `?returnTo=` on the 4 record pages;
  checklist = client-side counts (commission count **only when `has('masterdata.manage')`** — else
  "—", no request); endpoints per spec §3.3 as CORRECTED in Rev 1 (`/client-products?clientId=` +
  summed `unitCount`; there is NO `/api/v2/cpv`).
- Workbook: 5 sheets through the existing per-module ImportSpecs + ONE named delta (CPV `unitCode`
  optional, blank/'UNIVERSAL' → null — mirrors `rateTypeAssignments/import.ts:18-19,99-100`);
  per-entity pending projections (codes / link PAIRS incl. same-sheet CPV phase-1→2 / assignment
  TUPLES); preview-honesty rules (future-`effectiveFrom` warning; valid-pending = conditional);
  `CLIENT_MISMATCH` guard; per-sheet AND total 10k cap (413); TWO `import_log` rows for the CPV
  phase; engine seams = sheet-selector through parse/preview/confirm + `buildWorkbookTemplate(specs[])`
  + ImportModal 5-panel extension (all named in spec §4.3/S4/S5).
- **No migration expected** (next mig stays `0117`); next ADR = `0093`. No new packages. `/api/v2`
  additive-only; never break mobile.

## Current state (as of 2026-07-08)
- Batches 1+2 of the same plan are **LIVE on STAGING** (`main` @ `be330fb`+; prod promotion pending
  owner). Relevant new precedents on main you should reuse: RTA `bulk-deactivate` + `parseBulkIds`
  (platform/bulk.ts), CPV `POST /cpv-units/bulk` (SAVEPOINT loop, per-row statuses, `xmax=0`
  CREATED/REACTIVATED), export-style web tests w/ exported constants (RateRecordPage/CommissionRate
  pages), `?clientId` filter wiring patterns, CSV import already works engine-wide (magic-byte sniff).
- 3 follow-up cards (RTA audit rows, ImportModal copy, format.ts comment) were fixed at session end
  2026-07-08 — check `git log` for `fix/queue-cards` commits before assuming.

## How to build (repo method)
- Subagent-driven per `docs/plans/2026-07-07-admin-masterdata-ux-simplification-plan.md` batch
  pattern: worktree off latest `main` (`git worktree add /tmp/crm2-hub -b feat/client-setup-hub`),
  task-brief → implementer (sonnet) → task reviewer → fix loops → per-slice `pnpm verify`
  (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/crm2_test LC_ALL=C; colima/docker
  `crm2_test_pg` must be up) → browser-verify on crm2_dev (:54329, admin/admin123; launch-entry
  pattern web-uxq/api-uxq in `.claude/launch.json` shows the -C worktree trick) → final whole-branch
  review → owner ship gate (push=staging; prod separate).
- **First action:** write the slice plan `docs/plans/2026-07-0X-client-setup-hub-plan.md` from spec
  §8 (S1 hub shell+RBAC+nav → S2 controlled-prop + returnTo wiring on the 4 pages → S3 checklist →
  S4 template generator → S5 workbook import runner + UX-8 guards + CPV delta → S6 e2e + a11y +
  responsive), each slice = tasks with exact files/tests per the writing-plans format, then execute
  S1. One slice per ship gate; owner OK before each push.
- Known agent gotchas: implementers sometimes stall "waiting for background test run" (tell them
  synchronous-only; nudge via SendMessage to resume) and can die at usage limits AFTER finishing
  (verify + commit as controller); web tests are export-style ONLY (no RTL/jsdom — ADR-gated);
  e2e specs live in `apps/web/e2e/` and CI runs them (local `pnpm verify` does NOT).

## Standing rules (unchanged)
Cave mode · ask before push/deploy/live-DB (build itself = autonomous CTO) · commits author Mayur,
conventional, NO AI trailer, never `--no-verify` · secret sweep before push · update
`CRM2_MASTER_MEMORY.md` §8 + registry §ADMIN-MASTERDATA-UX-2026-07-07 (UX-1/UX-2 flips) + memory
file `project_admin_masterdata_ux_audit_2026_07_07` at ship · tokens-only styling · one DataGrid ·
`@crm2/sdk` only from FE.
