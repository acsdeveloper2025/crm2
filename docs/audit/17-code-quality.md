# AUDIT 17: Code Quality

## Scope

Inspected: the whole `apps/` + `packages/` source tree (excluding `node_modules/`, `.git/`, `.turbo/`, `dist/`, `coverage/`, `.claude/worktrees/`), `.dependency-cruiser.cjs` (boundary/circular-dep rules), `knip.json` (dead-code config), `scripts/check-suppressions.mjs`, and `docs/architecture-inventory.md` for baseline context. Deep-read candidates: `apps/api/src/modules/cases/{service,repository,controller}.ts` (largest backend module), `apps/web/src/features/cases/CaseDetailPage.tsx` (largest frontend file), `apps/api/src/modules/{rates,rateTypes,commissionRates}/*` and `apps/api/src/modules/{location,locations}/*` (duplicate-code spot-checks), `apps/api/src/modules/{dashboard,field-monitoring,location}/service.ts` (IST-offset duplication), `apps/api/src/modules/fieldReports/sectionMap.ts` (large-file false-positive check), `apps/worker`/`apps/report-worker` (placeholder-package check).

Commands actually run (all read-only, no installs/mutations):
- `pnpm boundaries` → `depcruise apps packages --config .dependency-cruiser.cjs` (also re-run with `--output-type err-long` to confirm no suppressed warnings)
- `pnpm run deadcode` → `knip`
- `node scripts/check-suppressions.mjs`
- `grep -rn "TODO\|FIXME"` across `apps/`, `packages/` (multiple extension passes: `.ts`/`.tsx`/`.sql`/`.sh`/`.cjs`/`.json`/`.md`, then repo-wide minus excluded dirs)
- `grep -rnE "^\s*//\s*(const|let|var|function|if|for|while|import|export|return|await|class)\b"` and a second pass for `^\s*//.*[;{}]\s*$` to hunt commented-out code blocks
- `grep -rn "console\.(log|warn|error|debug)"` across `apps/api/src`, `apps/web/src`, `apps/worker/src`, `apps/report-worker/src`, `packages/*/src` (excluding tests)
- `find apps/api/src/modules -name "service.ts" | xargs wc -l`, plus a repo-wide `find ... -name "*.ts" | xargs wc -l | sort -rn` and the same for `apps/web/src/**/*.tsx`
- A Python one-off (`re`-based) pass over `apps/api/src/modules/cases/repository.ts` to measure per-function line spans and flag any >60 lines
- `grep -rn` cross-checks for each of knip's "unused export" hits (`getPool`, `ERROR_CODES`, `connectSocket`, `setTheme`, `MAX_BULK_ITEMS`, `enqueueExport`, `runJob`) to confirm they are genuinely unused outside their own file, not false positives
- `diff` between `apps/api/src/modules/rates/service.ts` vs `commissionRates/service.ts`, and `rates/import.ts` vs `commissionRates/import.ts`, to characterize structural similarity vs. true duplication
- `grep -rln "19_800_000\|19800000"` and `grep -n "IST_OFFSET_MS"` to find duplicated IST-offset logic; cross-checked `apps/api/src/platform/` has no `time.ts`/`date.ts` util that should have been reused instead
- `git log --oneline -50` (grepped for wip/temp/fixup/revert/debug commit messages)

Did NOT run: `pnpm install`, `pnpm test`, `pnpm build`, anything touching a live DB/network.

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| Dead code | FAIL (Low) | `pnpm run deadcode` (knip) output: `Unused devDependencies (2)` — `@vitest/coverage-v8 package.json:32:6`, `vitest package.json:43:6` (root `package.json`, redundant — every workspace that runs tests already declares its own copy: confirmed via `grep -l '"vitest"' apps/*/package.json packages/*/package.json` → 6 hits: `apps/web`, `apps/api`, `packages/{access,sdk,config,logger}`). Also flags `apps/worker` and `apps/report-worker` entry-pattern "no matches" — verified these are intentional zero-`src/` placeholder packages (`find apps/worker apps/report-worker -type f` → only `package.json` + `.turbo/` logs; `apps/worker/package.json:6` description: `"BullMQ general worker — runs the acs-api-v2 image with ROLE=worker. Implemented in a later build step."`), not dead code, just stale `knip.json` glob hints. | See CODE_QUALITY-04. |
| Unused code (unused exports) | FAIL (Low) | `pnpm run deadcode`: `Unused exports (19)` + `Unused exported types (14)`. Spot-verified 7 of the 19 by direct grep: `getPool` (`apps/api/src/platform/db.ts:6`) used only inside its own file; `ERROR_CODES` (`apps/api/src/platform/errors.ts:8`) used only inside its own file; `connectSocket` (`apps/web/src/lib/socket.ts:13`) used only inside `socket.ts` itself; `setTheme` (`apps/web/src/lib/theme.ts:46`) used only inside `theme.ts`; `MAX_BULK_ITEMS` (`apps/api/src/platform/bulk.ts:28`), `enqueueExport` (`apps/api/src/platform/export/job.ts:134`), `runJob` (`apps/api/src/platform/jobs/index.ts:78`) all likewise self-contained. All confirmed genuine (exported with broader visibility than any actual consumer requires), not knip false positives. | See CODE_QUALITY-01. |
| TODO | PASS | `grep -rn "TODO" apps packages --include="*.ts" --include="*.tsx" --include="*.sql" --include="*.sh" --include="*.cjs" --include="*.json" --include="*.md"` (excluding node_modules/.turbo/dist/coverage/.claude/worktrees) → zero matches. Repeated with a repo-wide `grep -rln` over `.ts`/`.tsx` from `.` → zero matches. | Genuinely zero TODO markers anywhere in scope. |
| FIXME | PASS | Same command set as TODO (combined `grep -rn "TODO\|FIXME"`) → zero matches for FIXME either. | Genuinely zero FIXME markers anywhere in scope. |
| Commented-out code | PASS | Two greps: (1) `^\s*//\s*(const|let|var|function|if|for|while|import|export|return|await|class)\b` → 15 hits, all manually inspected — every hit is a prose sentence beginning with a code keyword used as an English word (e.g. `apps/api/src/modules/commissionRates/import.ts:22` "`// for OFFICE (flat office rate)...`", `apps/web/src/components/ui/data-grid/DataGrid.tsx:583` "`// for hook-bearing cells...`"), none is disabled code. (2) `^\s*//.*[;{}]\s*$` → 26 hits, all are multi-line prose comments that happen to end a sentence with a semicolon before continuing on the next line (e.g. `apps/api/src/modules/cases/repository.ts:786`, `packages/access/src/permissions.ts:39`) — confirmed by reading surrounding context, none is commented-out code. | Zero true commented-out code blocks found. |
| Duplicate code | FAIL (Low) | Identical `IST_OFFSET_MS = 19_800_000` constant + near-identical "compute IST midnight" 4-line algorithm independently re-implemented in 3 files: `apps/api/src/modules/location/service.ts:19,28-30`, `apps/api/src/modules/dashboard/service.ts:9,13-16`, `apps/api/src/modules/field-monitoring/service.ts:49,52-57`. No shared `platform/time.ts` or `platform/date.ts` util exists (`ls apps/api/src/platform/` confirmed no such file) — the billing module instead does IST-calendar bucketing in SQL (`apps/api/src/modules/billing/repository.ts:110-119`, `AT TIME ZONE`), a different, non-duplicated approach. Spot-checked `rates`/`commissionRates`/`rateTypes` and `location`/`locations` module pairs via `diff` — those are NOT duplication: same shared-platform-abstraction shape (`ImportSpec`, `PageSpec`, OCC-versioned service pattern) applied to genuinely different entities/schemas/SQL, and `location` (device GPS ingest) vs `locations` (pincode/area master data) are different domains despite the near-identical name. | See CODE_QUALITY-02. |
| Large functions | FAIL (Low/Medium) | Python span-measurement over `apps/api/src/modules/cases/repository.ts` (1872 lines total, largest non-test file in the repo) found two outsized functions: `addTasks` 121 lines (`L638-759`, read in full — one large parameterized multi-row INSERT loop with embedded conditional `CASE` SQL) and `reassignRevokedTask` 102 lines (`L1258-1360`); `assignTask` 78 lines (`L912-990`) and `revisitTask` 62 lines (`L1195-1257`) also exceed a 60-line bar. Frontend: `apps/web/src/features/cases/CaseDetailPage.tsx` is 2332 lines and contains 30+ component/helper functions defined inline in one file (`grep -n "^function "` → 30 matches from `AddApplicantForm` through `Meta`), none individually extracted into their own module. `apps/api/src/modules/cases/service.ts` (787 lines, only `service.ts` over the suggested ~400-line bar) is comparatively well-decomposed (30 methods on one object, ~18 lines average) — flagged only for file size, not per-function complexity. | See CODE_QUALITY-03 (file-level: CaseDetailPage.tsx) and CODE_QUALITY-05 (function-level: cases/repository.ts). |
| Circular dependencies | PASS | `pnpm boundaries` → `depcruise apps packages --config .dependency-cruiser.cjs` → `✔ no dependency violations found (559 modules, 1858 dependencies cruised)`. The `no-circular` rule is `severity: 'error'` (`.dependency-cruiser.cjs:8-13`) and is CI-gated (part of `pnpm verify`). Re-ran with `--output-type err-long` → identical clean result, confirming no suppressed warnings (e.g. `no-orphans` is `severity: 'warn'` and produced zero output either run). | Strong evidence — this is a real, machine-enforced, currently-green gate, not just an assumption. |
| Code smells | FAIL (Low, rolled into other findings) | Beyond the items above: (a) two near-identically-named modules (`location` vs `locations`) sharing a root word but different domains — naming-clarity risk for new contributors, see CODE_QUALITY-06. (b) Otherwise the codebase is clean on the smells normally seen in audits of this kind: zero `console.*` outside tests (`grep -rn "console\.(log\|warn\|error\|debug)"` across all `src/` dirs minus tests → zero matches, matching the CLAUDE.md machine-enforced rule), zero suppressions (`node scripts/check-suppressions.mjs` → `no-suppressions: clean (546 files scanned)`), clean conventional-commit git history with no wip/temp/fixup/revert noise (`git log --oneline -50` grepped for those keywords → zero matches). | No Critical/High code smells found; only the duplication/file-size items already captured above. |

## Findings

### CODE_QUALITY-01
- **Category:** Dead Code / Unused Exports
- **Severity:** Low
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-1164 (Irrelevant Code)
- **Location**
  - **File:** Multiple — `apps/api/src/platform/db.ts`, `apps/api/src/platform/errors.ts`, `apps/api/src/platform/bulk.ts`, `apps/api/src/platform/export/job.ts`, `apps/api/src/platform/import/{format,index}.ts`, `apps/api/src/platform/jobs/index.ts`, `apps/api/src/platform/scope/index.ts`, `apps/api/src/modules/rateTypes/service.ts`, `apps/api/src/modules/shared/masterDataImport.ts`, `apps/web/src/lib/{serverClock,socket,theme}.ts` (19 unused exports), plus 14 unused exported types in `apps/api/src/modules/{fieldReports/sectionMap,mis/resolver,mis/service}.ts`, `apps/api/src/platform/{access/index,access/repository,audit,bulk,jobs/index,mail/index,pagination,scope/index}.ts`, `apps/web/src/lib/sessionManager.ts`.
  - **Line Number:** `apps/api/src/platform/db.ts:6` (`getPool`), `apps/api/src/platform/errors.ts:8` (`ERROR_CODES`), `apps/web/src/lib/socket.ts:13` (`connectSocket`), `apps/web/src/lib/theme.ts:46` (`setTheme`) — representative sample, full list in the knip output below.
- **Evidence:**
  ```
  $ pnpm run deadcode
  Unused exports (19)
  posIntParam                      apps/api/src/modules/rateTypes/service.ts:15:14
  MASTER_IMPORT_COLUMNS            apps/api/src/modules/shared/masterDataImport.ts:11:14
  MASTER_IMPORT_SAMPLE             apps/api/src/modules/shared/masterDataImport.ts:17:14
  MAX_BULK_ITEMS                   apps/api/src/platform/bulk.ts:28:14
  getPool                function  apps/api/src/platform/db.ts:6:17
  ERROR_CODES                      apps/api/src/platform/errors.ts:8:14
  neutralizeFormula      function  apps/api/src/platform/export/format.ts:44:17
  hasExportBuilder       function  apps/api/src/platform/export/job.ts:56:17
  enqueueExport           function  apps/api/src/platform/export/job.ts:134:17
  parseImportXlsx         function  apps/api/src/platform/import/format.ts:85:23
  parseImportCsv           function  apps/api/src/platform/import/format.ts:145:17
  importThreshold          function  apps/api/src/platform/import/index.ts:58:17
  assertImportable         function  apps/api/src/platform/import/index.ts:80:17
  hasJobProcessor          function  apps/api/src/platform/jobs/index.ts:33:17
  runJob                    function  apps/api/src/platform/jobs/index.ts:78:23
  dimensionDef                     apps/api/src/platform/scope/index.ts:6:22
  serverClockOffsetMs      function  apps/web/src/lib/serverClock.ts:27:17
  connectSocket             function  apps/web/src/lib/socket.ts:13:17
  setTheme                  function  apps/web/src/lib/theme.ts:46:17
  Unused exported types (14)
  SectionFieldDef  interface  apps/api/src/modules/fieldReports/sectionMap.ts:18:18
  MisColumnDesc    interface  apps/api/src/modules/mis/resolver.ts:64:18
  MisColumn        type       apps/api/src/modules/mis/service.ts:171:15
  ColumnDataType   type       apps/api/src/modules/mis/service.ts:171:26
  HierarchyMode    type       apps/api/src/platform/access/index.ts:3:31
  HierarchyMode    type       apps/api/src/platform/access/repository.ts:9:13
  AuditAction      type       apps/api/src/platform/audit.ts:2:13
  BulkRowStatus    type       apps/api/src/platform/bulk.ts:17:13
  JobContext       interface  apps/api/src/platform/jobs/index.ts:18:18
  MailMessage      interface  apps/api/src/platform/mail/index.ts:11:18
  FilterField      interface  apps/api/src/platform/pagination.ts:17:18
  DimensionDef     type       apps/api/src/platform/scope/index.ts:6:61
  IdleConfig       interface  apps/web/src/lib/sessionManager.ts:32:18
  IdleCallbacks    interface  apps/web/src/lib/sessionManager.ts:36:18
  ```
- **Why it is a problem:** These symbols are exported (public module surface) but used only within their own defining file — exporting them is either accidental (leftover from a refactor that inlined the only call site) or speculative (export "just in case"). Each one is a small ongoing maintenance/cognitive tax: a reader sees `export` and assumes there's an external consumer; a future refactor of the "private" implementation risks unknowingly breaking something that looks public.
- **Real world attack scenario:** N/A — this is a maintainability issue, not an exploitable security defect. No PII/case/commission data path is affected.
- **Business impact:** Low. Slightly elevated risk of accidental breakage during refactors of `cases`/`billing`-adjacent platform helpers (`bulk.ts`, `import/index.ts`, `jobs/index.ts`) if a developer trusts the `export` keyword as "this is a real contract" when it isn't.
- **Recommended fix:** Either (a) drop the `export` keyword on symbols genuinely only used file-locally (verified above for the 7 sampled), or (b) if the export is deliberate forward-prep, add a short comment saying so. Treat the remaining 12 unsampled hits the same way after a quick per-file check.
- **Estimated effort:** S (1-2 hours — mechanical, knip already enumerates every site)
- **Priority:** P3
- **Status:** OPEN

### CODE_QUALITY-02
- **Category:** Duplicate Code
- **Severity:** Low
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-1041 (Use of Redundant Code)
- **Location**
  - **File:** `apps/api/src/modules/location/service.ts`, `apps/api/src/modules/dashboard/service.ts`, `apps/api/src/modules/field-monitoring/service.ts`
  - **Line Number:** `location/service.ts:19,28-30`; `dashboard/service.ts:9,13-16`; `field-monitoring/service.ts:49,52-57`
- **Evidence:**
  ```
  // apps/api/src/modules/dashboard/service.ts:9,13-16
  const IST_OFFSET_MS = 19_800_000;
  function windows(): DashboardWindows {
    const now = Date.now();
    const ist = new Date(now + IST_OFFSET_MS);
    const istMidnightUtcMs =
      Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS;
  ...

  // apps/api/src/modules/field-monitoring/service.ts:49,52-57
  const IST_OFFSET_MS = 19_800_000;
  function windows(): { startOfToday: string; overdueCutoff: string } {
    const now = Date.now();
    const overdueCutoff = new Date(now - OVERDUE_WINDOW_HOURS * MS_PER_HOUR).toISOString();
    const ist = new Date(now + IST_OFFSET_MS);
    const istMidnightUtcMs =
      Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS;
  ...

  // apps/api/src/modules/location/service.ts:19,28-30
  const IST_OFFSET_MS = 19_800_000;
  function istHour(iso: string): number {
    return new Date(Date.parse(iso) + IST_OFFSET_MS).getUTCHours();
  }
  ```
  `ls apps/api/src/platform/` confirms no `time.ts`/`date.ts` shared util exists for either of them to import instead.
- **Why it is a problem:** The "IST midnight" calculation (constant `19_800_000` + the `Date.UTC(...) - offset` algorithm) is copy-pasted verbatim into `dashboard/service.ts` and `field-monitoring/service.ts` (a related single-line variant in `location/service.ts`). A correctness fix or improvement (e.g., switching to `Intl.DateTimeFormat` with an explicit `Asia/Kolkata` timezone, which is more self-documenting and avoids hand-rolled offset arithmetic) requires finding and editing all three sites; missing one silently reintroduces a day-boundary mismatch between the Dashboard and Field Monitoring consoles (a behavior the field-monitoring comment explicitly says it depends on: `field-monitoring/service.ts:48` "the field operates in India").
- **Real world attack scenario:** N/A — not a security defect. Worst case is a data-correctness bug: the Dashboard "today" stats and Field Monitoring "today" stats silently disagree if one copy is fixed/changed and the others aren't.
- **Business impact:** Low-to-Medium if it drifts: ops/managers cross-referencing Dashboard vs. Field Monitoring "completed today" / "overdue" numbers could see inconsistent counts after a future edit to only one copy.
- **Recommended fix:** Extract one `istMidnight(now: number): number` (or similar) helper into `apps/api/src/platform/` (no existing `time.ts`, so this is a new ~10-line file) and have `dashboard/service.ts` and `field-monitoring/service.ts` both call it; `location/service.ts`'s `istHour` can stay separate (different shape) but should import the same `IST_OFFSET_MS` constant rather than redeclaring it.
- **Estimated effort:** S (1 hour)
- **Priority:** P3
- **Status:** OPEN

### CODE_QUALITY-03
- **Category:** Large Function / God Component
- **Severity:** Medium
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-1121 (Excessive McCabe Cyclomatic Complexity) — approximate fit, no direct CWE for file-size/God-object
- **Location**
  - **File:** `apps/web/src/features/cases/CaseDetailPage.tsx`
  - **Line Number:** 1-2332 (whole file); component boundaries at lines 71, 266, 403, 438, 929, 1085, 1141, 1190, 1248, 1425, 1445, 1464, 1568, 1620, 1641, 1662, 1767, 1794, 1833, 1911, 1938, 1980, 2025, 2095, 2112, 2180, 2245
- **Evidence:**
  ```
  $ wc -l apps/web/src/features/cases/CaseDetailPage.tsx
  2332 apps/web/src/features/cases/CaseDetailPage.tsx

  $ grep -n "^function \|^export function " apps/web/src/features/cases/CaseDetailPage.tsx
  71:export function CaseDetailPage() {
  266:function AddApplicantForm({ caseId }: { caseId: string }) {
  403:function VerdictHistory({ caseId }: { caseId: string }) {
  438:function TasksSection({
  929:function AssignForm({
  1085:function CompleteForm({
  1141:function ReasonForm({
  1190:function CaseFinalizeForm({
  1248:function AttachmentsSection({
  1425:function DataEntrySection({ caseId }: { caseId: string }) {
  1620:function PickupSection({ caseId }: { caseId: string }) {
  1767:function MobileReportSection({ caseId, tasks }: { caseId: string; tasks: CaseTaskView[] }) {
  2025:function FieldPhotosSection({ caseId }: { caseId: string }) {
  2245:function CaseReportSection({ caseId }: { caseId: string }) {
  ... (30 total)
  ```
- **Why it is a problem:** This single file is by far the largest in the frontend (the next-largest, `DataGrid.tsx`, is 1353 lines and is the deliberately centralized "Universal DataGrid" per `docs/DATAGRID_STANDARD.md`, a different category). `CaseDetailPage.tsx` instead bundles 30 conceptually-separate components — applicant forms, task assignment/completion/finalize forms, attachments, data-entry, pickup, mobile report rendering, field-photo gallery+lightbox+GPS overlay, case-report rendering — all as module-private functions in one file. This makes the file slow to navigate, increases merge-conflict surface (every case-detail-page change touches the same file), and works against the dependency-cruiser `no-cross-feature-internals` boundary rule's spirit of feature isolation (the rule only blocks *cross-feature* imports; it doesn't stop one feature's *own* file from growing unbounded).
- **Real world attack scenario:** N/A — pure maintainability/velocity risk, not a security defect.
- **Business impact:** Medium over time: the case detail page is the single most central screen in the CRM (every verification workflow funnels through it); a 2300-line file raises the cost and risk of every future change to case detail UX (task assignment, field photos, reports), and increases the odds of an unrelated edit causing a regression elsewhere in the same file.
- **Recommended fix:** Split into sibling files under `apps/web/src/features/cases/` (e.g. `CaseDetailTasksSection.tsx`, `CaseDetailAttachments.tsx`, `CaseDetailFieldPhotos.tsx`, `CaseDetailDataEntry.tsx`, `CaseDetailPickup.tsx`, `CaseDetailReport.tsx`), each exported and re-imported by `CaseDetailPage.tsx`, respecting the existing `no-cross-feature-internals` boundary (everything stays inside the `cases` feature folder, so the dependency-cruiser rule is unaffected). Pure refactor, no behavior change — should be done incrementally, not in one PR, to keep risk low on the highest-traffic screen in the app.
- **Estimated effort:** L (this is a multi-PR refactor of the busiest screen in the product; ponytail note: do NOT attempt this opportunistically inside an unrelated change — it deserves its own reviewed, test-backed PR)
- **Priority:** P2
- **Status:** OPEN

### CODE_QUALITY-04
- **Category:** Dead Code / Unused Dependencies
- **Severity:** Low
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-1164 (Irrelevant Code)
- **Location**
  - **File:** `/Users/mayurkulkarni/Downloads/crm2/package.json`
  - **Line Number:** 32, 43
- **Evidence:**
  ```
  $ pnpm run deadcode
  Unused devDependencies (2)
  @vitest/coverage-v8  package.json:32:6
  vitest               package.json:43:6
  ```
  Cross-check: `grep -l '"vitest"' apps/*/package.json packages/*/package.json` → `apps/web/package.json`, `packages/access/package.json`, `packages/sdk/package.json`, `apps/api/package.json`, `packages/config/package.json`, `packages/logger/package.json` (6 workspaces, each with its own `vitest`/`@vitest/coverage-v8`). The root has no `vitest`-invoking script (`test` at `package.json:14` is `turbo run test`, which dispatches to per-package scripts).
- **Why it is a problem:** This duplicates a finding already raised in `docs/audit/16-dependency-audit.md` (DEPENDENCY_AUDIT-01) from the dependency-audit angle; flagged here too because it is also squarely a "dead/unused code" hit under this audit's own checklist (knip's own `deadcode` script is this audit's prescribed tool). Not a security issue — pure housekeeping.
- **Real world attack scenario:** N/A.
- **Business impact:** Negligible — two redundant `devDependencies` entries in the root lockfile/manifest, no functional effect.
- **Recommended fix:** Remove the two root-level entries (`package.json:32,43`); each workspace already pins its own version. See also `docs/audit/16-dependency-audit.md` DEPENDENCY_AUDIT-01 for the same fix from the dependency-management angle — fix once, resolves both findings.
- **Estimated effort:** S (5 minutes)
- **Priority:** P3
- **Status:** OPEN

### CODE_QUALITY-05
- **Category:** Large Function
- **Severity:** Low
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-1121 (Excessive McCabe Cyclomatic Complexity) — approximate
- **Location**
  - **File:** `apps/api/src/modules/cases/repository.ts`
  - **Line Number:** 638-759 (`addTasks`, 121 lines), 1258-1360 (`reassignRevokedTask`, 102 lines), 912-990 (`assignTask`, 78 lines)
- **Evidence:** (full `addTasks` read; representative excerpt)
  ```
  638:  async addTasks(
  ...
  693:          const [inserted] = await q<{ id: string }>(
  694:            `INSERT INTO case_tasks
  695:               (case_id, verification_unit_id, applicant_id, address, trigger, priority,
  696:                visit_type, rate_type_id, pincode_id, area_id, assigned_to,
  697:                assigned_by, assigned_at, status,
  698:                task_number, created_by, updated_by, latitude, longitude, tat_hours)
  699:             VALUES ($1, $2, $3, $4, $5, $6,
  700:                     -- ADR-0050/0068: an OFFICE task's rate type is auto-stamped 'OFFICE' (desk work
  701:                     -- has no LOCAL/OGL trip band); FIELD uses the picked $16 (LOCAL/OGL). The code is
  702:                     -- resolved to rate_types.id (NULL code → NULL id, e.g. KYC).
  ...
  713:                     COALESCE($15::int, CASE $6::varchar
  714:                       WHEN 'URGENT' THEN 4 WHEN 'HIGH' THEN 8 WHEN 'MEDIUM' THEN 24 WHEN 'LOW' THEN 48
  715:                       ELSE 24 END))
  716:             RETURNING id`,
  ```
  Python span-measurement: `addTasks` 121, `reassignRevokedTask` 102, `assignTask` 78, `revisitTask` 62 lines (all >60-line threshold).
- **Why it is a problem:** `addTasks` mixes a multi-row insert loop, FIELD-rate-type derivation business logic (lines 676-692), a single large parameterized SQL statement with embedded conditional `CASE` clauses, append-only history bookkeeping, and case-status recomputation in one function. It is well-commented with ADR references explaining every non-obvious branch (not undocumented spaghetti), but the line count and mixed responsibilities (business-rule derivation + SQL construction + history side-effect) make it harder to unit-test the rate-derivation branch in isolation from the INSERT.
- **Real world attack scenario:** N/A — maintainability concern, not a security defect. A bug here (e.g. in the priority→TAT-hours `CASE` mapping or the `fieldRateType` derivation gate) would manifest as wrong task TAT deadlines or a task created without a required field-commission rate, not as an exploitable vulnerability.
- **Business impact:** Low-Medium: `addTasks`/`assignTask`/`reassignRevokedTask` are on the critical path for case/task creation and assignment (core CRM workflow); their size increases the cost of safely extending task-creation logic (e.g. a future ADR adding another rate-type rule) and the risk of a change in one branch unintentionally affecting an unrelated branch in the same function.
- **Recommended fix:** Extract the FIELD-rate-type derivation branch (lines ~673-692) into a named helper (it largely already delegates to `deriveFieldRateTypeForNewTask`, so this is close — the remaining win is extracting the per-task INSERT+history-write pair into a `insertOneTask(q, caseId, seq, t, userId)` helper called from the loop, shrinking `addTasks` itself to orchestration: count → loop calling the helper → recompute status). No behavior change required.
- **Estimated effort:** M (a few hours, needs the existing `cases.api.test.ts` suite — 3088 lines, already covers `addTasks` — to stay green through the extraction)
- **Priority:** P3
- **Status:** OPEN

### CODE_QUALITY-06
- **Category:** Code Smell — Naming Clarity
- **Severity:** Informational
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** N/A
- **Location**
  - **File:** `apps/api/src/modules/location/` and `apps/api/src/modules/locations/`
  - **Line Number:** N/A (directory-level)
- **Evidence:**
  ```
  $ ls apps/api/src/modules | grep -iE "rate|location"
  commissionRates
  location
  locations
  rateTypeAssignments
  rateTypes
  rates
  ```
  `location/service.ts` (3507 bytes) is device GPS-fix ingest (`locationService.capture`, ADR-0026/0027/0028 — tracking shift-window gating, clock-skew backstop). `locations/service.ts` (12416 bytes) is pincode/area/city master-data CRUD (`locationService.list/exportData/createBatch/update`, backed by a 157k-row catalog per its own comment). Confirmed via direct read of both `service.ts` files — entirely different domains, zero shared logic, both legitimately needed.
- **Why it is a problem:** Two modules differing only by a trailing "s" but covering unrelated domains (live GPS tracking vs. static geography master data) is a minor but real cognitive trap for anyone grepping/searching the codebase (`grep -rn "locationService"` matches both; an IDE "go to module" on `location` is one keystroke from the wrong one).
- **Real world attack scenario:** N/A.
- **Business impact:** Negligible — onboarding/navigation friction only, no functional risk observed (each module's own imports are correctly scoped, confirmed no cross-import between them in the `pnpm boundaries` clean run).
- **Recommended fix:** Optional rename for clarity (e.g. `location` → `deviceLocation` or `gpsTracking`, leaving `locations` as the geography master-data module) — low priority, would touch routes/imports across the module; only worth doing opportunistically alongside other work in either module, not as a standalone change.
- **Estimated effort:** S if ever done (mechanical rename, but touches route registration + imports — verify boundaries stay green after)
- **Priority:** P3
- **Status:** OPEN

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 4 |
| Informational | 1 |

**Overall verdict: PARTIAL.**

The two machine-enforced gates this audit could run directly — `pnpm boundaries` (circular-dependency/architecture-boundary check) and the no-suppressions/no-`console.*` rules — are genuinely clean with strong evidence (559 modules / 1858 dependencies cruised, zero violations; 546 files scanned, zero suppressions; zero `console.*` outside tests). TODO/FIXME markers and commented-out code are also genuinely absent repo-wide — this is an unusually clean codebase on those two axes, helped by the project's heavy ADR-comment convention (explanatory prose rather than disabled code or deferred-work markers). The findings that do exist are all Low/Informational housekeeping (19 unused exports + 14 unused types per knip, 2 redundant root devDependencies, one real 3-file duplication of an IST-offset calculation, naming proximity between `location`/`locations`) plus one Medium structural concern: `apps/web/src/features/cases/CaseDetailPage.tsx` at 2332 lines is a genuine God-component bundling 30 sub-components for the single most central screen in the CRM, and the `cases` module's backend repository (1872 lines, with a few 60-120-line functions) is the codebase's largest single concentration of complexity — consistent with `cases` being the core domain entity, but still the place most worth a deliberate, test-backed decomposition pass if/when that screen needs heavy further iteration.
