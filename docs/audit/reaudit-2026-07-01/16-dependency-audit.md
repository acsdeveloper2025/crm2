# RE-AUDIT 16: Dependency Audit

Re-audit of area 16 against post-remediation HEAD (`8ded432`), baseline `b19039e`. READ-ONLY.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| DEPENDENCY_AUDIT-01 (remove unused root `vitest` + `@vitest/coverage-v8`) | CONFIRMED_FIXED | `package.json:30-42` — root `devDependencies` no longer lists `vitest`/`@vitest/coverage-v8`. `git diff b19039e..8ded432 -- pnpm-lock.yaml` = 6 removed lines, 0 added: only the two root spec blocks gone. Per-workspace declarations correctly retained (`apps/api/package.json:51,55`, `apps/web/package.json:39`, `packages/sdk/package.json:17,19`, `packages/logger/package.json:18,20`, `packages/config/package.json:19`, `packages/access/package.json:17`). Root has no test script of its own (`package.json:22` `verify` → `pnpm test` → `turbo run test`, delegated per-workspace; no root `vitest.config.*`). |
| DEPENDENCY_AUDIT-04 (add Dependabot config) | CONFIRMED_FIXED | `.github/dependabot.yml:5-23` — valid schema `version: 2`, two ecosystems (`npm` at `/`, `github-actions` at `/`), weekly schedule, `open-pull-requests-limit: 5`, `groups.routine` batching patch/minor so majors stay separate. Structurally sound. |
| DEPENDENCY_AUDIT-02 (transitive-license scope note) | ACCEPTED_AS_DOCUMENTED | `docs/audit/16-dependency-audit.md:55-68` — documented scope boundary (direct prod deps license-checked; full transitive SPDX sweep out of scope). No code change expected or made; unchanged in the remediation diff. |
| DEPENDENCY_AUDIT-03 (puppeteer CDN fetch) | STILL_DEFERRED_AS_DOCUMENTED (retraction verified) | Retraction premise confirmed against live repo: pnpm@9 (`package.json:11`) with **no** `.npmrc`/`onlyBuiltDependencies` allowlist blocks the `puppeteer` postinstall by default. `.github/workflows/ci.yml:~77` comment states verbatim *"pnpm blocks the puppeteer postinstall Chrome download, so fetch the expected build explicitly"* → `pnpm --filter @crm2/api exec puppeteer browsers install chrome`. So the original finding's premise (CI silently pulls an unpinned Chromium via the postinstall on `pnpm install`) is factually incorrect; retraction is sound. `puppeteer` still present (`apps/api/package.json:37`). |

## Live `pnpm audit --prod` result

```
2 vulnerabilities found — Severity: 2 moderate
uuid <11.1.1 (GHSA-w5hq-g745-h8pq) — buffer bounds check in v3/v5/v6 when buf provided
Paths: apps/api > exceljs@4.4.0 > uuid@8.3.2
       apps/api > firebase-admin@14.0.0 > @google-cloud/storage@7.21.0 > gaxios@6.7.1 > uuid@9.0.1  (7 paths total)
```

Both "vulnerabilities" are the **same** `uuid` advisory reached via two distinct transitive chains (`exceljs`, `firebase-admin`). Pre-existing prod transitives: `git show b19039e:pnpm-lock.yaml | grep -c "uuid@8.3.2\|uuid@9.0.1"` = 4 (present at baseline). The remediation diff touches **zero** prod-dependency lines (`git diff b19039e..8ded432 -- pnpm-lock.yaml` adds nothing, removes only the 2 devDep spec blocks). The original audit already traced this advisory as non-exploitable here (both consumers call only `uuid.v4()`, never the vulnerable `v3/v5/v6(buf)` path; crm2 code never imports `uuid` directly) — `docs/audit/16-dependency-audit.md:23`.

## New Findings

None. The lockfile change introduced no new package and no changed transitive resolution (6 lines removed, 0 added; all removed lines are the two root devDep specs). No regression from remediation. The `uuid` moderate advisory is pre-existing, unchanged, and already documented as non-exploitable in this repo.

## Verdict

**PASS.** Both claimed fixes are real and complete: the root `vitest`/`@vitest/coverage-v8` duplicates are removed surgically (per-workspace test deps intact, lock diff is exactly those 6 lines) and `.github/dependabot.yml` is a valid v2 config covering npm + github-actions weekly with sensible grouping. The RETRACTED-03 premise holds against the live repo (pnpm@9 blocks the postinstall; CI fetches Chrome explicitly), and ACCEPTED-02 remains a documented scope note. `pnpm audit --prod` returns only the same pre-existing, non-exploitable `uuid` moderate advisory via untouched prod transitives — not introduced or worsened by this remediation. Zero new Medium+ findings.
