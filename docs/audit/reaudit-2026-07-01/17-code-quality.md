# RE-AUDIT 17: Code Quality

Re-audited fresh against post-remediation HEAD (`8ded432`), baseline `b19039e`. All checks read-only.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| CODE_QUALITY-02 | CONFIRMED_FIXED | `apps/api/src/platform/istTime.ts:7,10,16` defines `IST_OFFSET_MS`/`istMidnightUtcMs`/`istHour`. Baseline `git show b19039e:.../dashboard/service.ts` had the offset+`Date.UTC(...)-IST_OFFSET_MS` formula inline; current `dashboard/service.ts:4,12`, `field-monitoring/service.ts:9,54`, `location/service.ts:7,44` all import the helper. Formula is byte-identical to baseline (verified line-by-line). `grep 19_800_000` outside `istTime.ts` → zero stale copies. `apps/api/src/platform/__tests__/istTime.test.ts:1-25` covers offset, day-rollover, and hour mapping. |
| CODE_QUALITY-04 | CONFIRMED_FIXED | `git show b19039e:package.json` had `@vitest/coverage-v8` (L31) + `vitest` (L42); `git show 8ded432:package.json` → both gone (grep empty). `pnpm run deadcode` no longer emits the `Unused devDependencies (2)` block. Registry `COMPLIANCE_GAPS_REGISTRY.md:1673` (MERGED-UNUSED-VITEST-DEPS). |
| CODE_QUALITY-01 | STILL_DEFERRED_AS_DOCUMENTED | `pnpm run deadcode` output: `Unused exports (19)` + `Unused exported types (14)` — exactly the counts documented in `COMPLIANCE_GAPS_REGISTRY.md:1642`. Untouched by remediation. |
| CODE_QUALITY-03 | STILL_DEFERRED_AS_DOCUMENTED | `wc -l apps/web/src/features/cases/CaseDetailPage.tsx` → 2332 (unchanged vs documented 2332). `git diff b19039e..8ded432 -- <file>` empty. Registry `:1645`. |
| CODE_QUALITY-05 | STILL_DEFERRED_AS_DOCUMENTED | `apps/api/src/modules/cases/repository.ts` = 1872 lines; `git diff b19039e..8ded432 -- <file>` empty (untouched). Registry `:1648`. |
| CODE_QUALITY-06 | ACCEPTED_AS_DOCUMENTED | `COMPLIANCE_GAPS_REGISTRY.md:1684` — NO ACTION, `location` vs `locations` naming nit, no functional bug. No code change made. |

## New Findings

None.

Independent verification performed:
- `pnpm boundaries` → `no dependency violations found (566 modules, 1876 dependencies cruised)` — the istTime extraction introduced no new cross-boundary or circular dependency.
- `pnpm run deadcode` → only the pre-existing (deferred CODE_QUALITY-01) unused exports/types plus benign `knip.json` config hints; the fixed vitest-dep block is gone.
- `git diff b19039e..8ded432` on all `.ts/.tsx` → no new `any`, `eslint-disable`, `@ts-ignore/@ts-expect-error`, or `console.*` introduced by the remediation.
- IST behavior parity: extracted `istMidnightUtcMs`/`istHour` are token-for-token identical to the three baseline inline copies (dashboard day boundary, field-monitoring completed-today/overdue window, location shift-window hour gate). No leftover duplicate `IST_OFFSET_MS` definitions anywhere.

## Verdict

PASS. Both claimed fixes (CODE_QUALITY-02 istTime extraction, CODE_QUALITY-04 unused-vitest-deps removal) are real and complete — the helper is behavior-identical to the three baseline copies, fully deduplicated, unit-tested, and introduces no boundary or circular-dependency regression, while the two root vitest devDependencies are confirmed removed. All three deferred items (01, 03, 05) and the one no-action item (06) remain in their exact documented state, untouched by the remediation, with `deadcode` counts matching the registry to the number. Zero new findings of any severity.
