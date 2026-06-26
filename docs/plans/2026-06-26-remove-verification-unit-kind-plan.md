# Build plan — Remove `verification_units.kind` · ADR-0070

**Owner-directed 2026-06-26** (overrides the audit's "keep"; the impact analysis's risks are BINDING
mitigations). Branch `feat/remove-verification-unit-kind` off `origin/main b96a418`. **ADR-0070, mig 0097.**
Frozen-area (FROZEN #9, ADR-0001/0002) → ADR-0070 supersedes; owner directive = sign-off.

## Approach: promote `worker_role` to the single discriminator
`kind` ⟺ `worker_role` is 1:1 for all live data (DB CHECK): `FIELD_VISIT⟺FIELD_AGENT`, `KYC_DOCUMENT⟺KYC_VERIFIER`.
`DESK_DOCUMENT` is dead (0 rows, not creatable in the UI) → it disappears with `kind` (no replacement needed;
`worker_role` has 2 values). Everything `kind` drove re-derives from `worker_role`:
- `visitTypeForKind(kind)` → **`visitTypeForRole(workerRole)`**: `FIELD_AGENT→FIELD`, else `→OFFICE`. Same
  strict binding, same `400 VISIT_TYPE_UNIT_MISMATCH` at create/assign/bulk (preserves A2026-0623-05).
- DB CHECKs re-keyed: `kind <> 'FIELD_VISIT' OR (…)` → `worker_role <> 'FIELD_AGENT' OR (…)` (the consequent
  already names worker_role); same for KYC.
- SDK `applyInvariants`: `d.kind === 'FIELD_VISIT'` → `d.workerRole === 'FIELD_AGENT'` (KYC likewise).
- View field `unitKind` (FIELD_VISIT/KYC_DOCUMENT) → **`unitWorkerRole`** (FIELD_AGENT/KYC_VERIFIER); web
  re-keys `kind === 'FIELD_VISIT'` → `workerRole === 'FIELD_AGENT'`.

**Re-run safety is FREE now** (the tracked runner shipped `b96a418`): mig 0097 applies once; the 11 old
kind-referencing migrations never re-run. No guarding tax. The only raw-replay site, `migrations.rerun.test.ts`,
is EVOLVED to drive the tracked runner (`db/v2/migrate.sh`) 3× instead of raw `psql` (matches prod; 0086 runs once).

## Work (multi-agent, disjoint after the spine)

**Foundation (CTO inline — everything depends on it):**
- `db/v2/migrations/0097_drop_verification_unit_kind.sql`: drop `chk_vu_field_visit`/`chk_vu_kyc_document` +
  `idx_verification_units_kind`, `DROP COLUMN IF EXISTS kind`, re-add the two CHECKs keyed on `worker_role`.
  Idempotent (DROP IF EXISTS → ADD). `db/v2/seed/verification_units.seed.sql`: drop the `kind` column + its
  value from every row.
- `packages/sdk/src/verificationUnit.ts`: remove `KINDS` + `kind` (DTO, `VerificationUnitOption`, `baseShape`,
  `UpdateVerificationUnitSchema`); `visitTypeForKind`→`visitTypeForRole`; re-key `applyInvariants` on `workerRole`.
  `cases.ts`: `unitKind`→`unitWorkerRole`. SDK tests repointed.
- `apps/api/src/platform/__tests__/migrations.rerun.test.ts`: drive `migrate.sh` 3× (SEED_DIR empty); assert
  schema converges + `kind` column gone + 2nd/3rd run apply 0.

**Fan-out (disjoint modules, after the spine lands — driven by `tsc` error list):**
- A — `cases` (service visit-type binding 300-309/434-436, repo `unitKindByIds`→`unitWorkerRoleByIds`,
  `taskUnitKind`→`taskWorkerRole`, TASK_VIEW_COLS `unit_kind`→`unit_worker_role`) + cases tests.
- B — `tasks` (service sort/filter/export + bulk visit-type 278, repo `unit_kind`→`unit_worker_role`) + tests.
- C — `rates` + `cpv` + `verificationUnits` modules (SELECT/list-filter/options/export/import drop kind;
  the VU admin create/update no longer takes kind) + tests.
- D — web: `VerificationUnitRecordPage` (kind picker → drop; worker_role drives the profile),
  `VerificationUnitsPage` (kind badge/filter → worker_role), `RateManagementPage`/`RateRecordPage` (filter +
  field/KYC split → worker_role), `ReportLayoutRecordPage` (`kind==='FIELD_VISIT'`→`workerRole==='FIELD_AGENT'`),
  `fieldReportTasks.ts` + web tests.

NOTE: do NOT touch `case_attachments.kind` (OFFICE_REF/FIELD_PHOTO) or the filter-builder `{kind:'text'}`
descriptors — unrelated to verification_units.kind.

## Risks / binding mitigations (from the impact analysis)
1. **Visit-type strict binding** preserved via `visitTypeForRole` (same 400). TDD it.
2. **DB invariants** preserved by re-keying CHECKs on worker_role (no weakening) — verify byte-equivalence.
3. **Mobile contract**: the sync feed never exposed `kind`; `unitKind` is web-only (case-detail/task list).
   Confirm no device path reads it before renaming. (R2)
4. **No DESK_DOCUMENT rows** — seed has none; audit confirmed none creatable. (R5)
5. **Frozen** → ADR-0070 + FROZEN #9 update + COMPLIANCE note (A2026-0623-05 binding moves kind→worker_role).
6. **No new migration bundled with the runner** rule is satisfied (runner already shipped separately).

## Done = full `pnpm verify` GREEN + evolved rerun test + adversarial security/correctness review (no widening,
binding preserved) + browser-verify (create a unit by worker_role; assign a task → visit-type binding holds;
report renders) + fresh-scratch seed check. Then STOP for owner push.
