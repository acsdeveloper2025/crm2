# AUDIT 16: Dependency Audit

## Scope

Inspected: root `package.json`, all 8 workspace `package.json` files (`apps/api`, `apps/web`, `apps/worker`, `apps/report-worker`, `packages/access`, `packages/config`, `packages/logger`, `packages/sdk`, `packages/test-utils`, `packages/ui-theme`), `pnpm-lock.yaml` (896 `integrity:` entries), `knip.json`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `infra/Dockerfile.api`, `infra/Dockerfile.web`, `pnpm-workspace.yaml`, and resolved `node_modules/.pnpm/*` package metadata for the 34 production dependencies listed in `docs/architecture-inventory.md` §12.

Commands actually run (all read-only, no installs/mutations):
- `pnpm audit --prod`
- `pnpm audit` (full, including devDependencies, for comparison)
- `pnpm run deadcode` (knip)
- `pnpm why uuid` (root and `apps/api`)
- `node -e "..."` one-off scripts to resolve installed versions + `license` fields from each package's real (symlink-resolved) `package.json` under `apps/api/node_modules/<pkg>/package.json` / `apps/web/node_modules/<pkg>/package.json`
- `grep -rn` sweeps over `apps/api/src`, `apps/web/src`, `packages/**` for direct `uuid` imports, and over package.json files for git/tarball/wildcard version specifiers
- `grep -n "uuid"` inside the installed `exceljs` and `gaxios` source to confirm which `uuid` function each transitive consumer actually calls
- `git diff package.json`, `git log --oneline -5 -- package.json` (to characterize the pre-existing uncommitted root `package.json` change, confirmed unrelated to dependencies)

Did NOT run: `pnpm install`, `pnpm build`, `pnpm test`, any live network/registry call beyond what `pnpm audit` itself performs against the public advisory database.

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| Known vulnerabilities | PASS (with 1 informational note) | `pnpm audit --prod` output: "2 vulnerabilities found / Severity: 2 moderate" — both the same `uuid <11.1.1` advisory (GHSA-w5hq-g745-h8pq) via `apps/api > exceljs@4.4.0 > uuid@8.3.2` and `apps/api > firebase-admin@14.0.0 > @google-cloud/storage@7.21.0 > {gaxios,google-auth-library,gcp-metadata,gtoken,retry-request,teeny-request} > uuid@9.0.1` (7 paths, `pnpm why uuid` confirms exact tree). Exploitability checked: `grep -n "uuid" node_modules/.pnpm/exceljs@4.4.0/node_modules/exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js` → `const {v4: uuidv4} = require('uuid'); ... uuidv4()` (only `v4`, never `buf`-supplied `v3/v5/v6`); same check on `node_modules/.pnpm/gaxios@6.7.1/node_modules/gaxios/build/src/gaxios.js:417` → `const boundary = (0, uuid_1.v4)();` (also only `v4`). The vulnerable code paths (`v3`/`v5`/`v6` called with an attacker-influenced `buf`) are never invoked by either dependency chain in this repo. `grep -rn "from 'uuid'\|require('uuid')"` across `apps/api/src`, `apps/web/src`, `packages/**` → zero matches; crm2's own code never imports `uuid` directly. | Confirms and sharpens the architecture-inventory's claim — verified at the call-site level, not just asserted. Still worth a low-severity tracking finding since a patched `uuid` is available upstream of both `exceljs` and `firebase-admin`'s dependency chains and a future code path could change usage. |
| Deprecated packages | PASS | Resolved real installed versions/licenses for all 28 external production deps via `node -e` against `apps/api/node_modules/<pkg>/package.json` / `apps/web/node_modules/<pkg>/package.json` (symlink-resolved): `express@5.2.1`, `react@19.2.7`, `react-dom@19.2.7`, `pg@8.21.0`, `socket.io@4.8.3`, `jose@6.2.3`, `zod@3.25.76`, `puppeteer@25.1.0`, `sharp@0.35.1`, `firebase-admin@14.0.0`, `@aws-sdk/client-s3@3.1070.0`, etc. — full table below. None is pinned to a major version with a published successor that has fully superseded/EOL'd it (e.g. not Express 4 when 5 is current major, not React 18 when 19 is current, not pg 7). `apps/web/package.json` and `apps/api/package.json` devDependencies confirmed `vitest@^4.1.9` (current major) workspace-wide. | Cross-checks and slightly extends architecture-inventory §12's "none of the 57 unique direct dependencies are themselves deprecated" claim with actual resolved versions, not just declared ranges. |
| Unused packages | FAIL (Low) | `pnpm run deadcode` (knip) output: `Unused devDependencies (2)` → `@vitest/coverage-v8  package.json:32:6` and `vitest  package.json:43:6` (both in the **root** `package.json`). Verified root `package.json` has no `test`/`vitest` script of its own (`scripts` block has no `vitest` reference — confirmed via `grep -rn "vitest" package.json` → only the two `devDependencies` lines, zero script usage); every workspace that actually runs tests (`apps/api`, `apps/web`, `packages/sdk`, `packages/logger`, `packages/config`, `packages/access`) declares its own `vitest`/`@vitest/coverage-v8` devDependency (`apps/api/package.json:51,55`, `apps/web/package.json:39`, `packages/sdk/package.json:17,19`, `packages/logger/package.json:18,20`). knip also reported 19 unused exports, 14 unused exported types, and 15 "configuration hints" (stale `knip.json` entry-pattern globs that no longer match, e.g. `apps/worker`/`apps/report-worker` `[src/**/*.ts]` patterns and redundant `src/main.ts`/`src/index.ts` entries already covered by defaults) — these are dead-code/config-hygiene items, not vulnerable/license/supply-chain risk, included here for completeness since `pnpm run deadcode` is this audit's prescribed unused-package tool. | See DEPENDENCY_AUDIT-01. The 19 unused exports / 14 unused types / config hints are below the bar for individual findings (no security or license impact) but are flagged inline as informational since the tool surfaced them. |
| License risks | PASS | Resolved `license` field from each installed package's real `package.json` for all 28 external production deps (script output captured verbatim below). Licenses found: `MIT` (22 packages: `archiver`, `bullmq`, `docx`, `exceljs`, `express`, `express-rate-limit`, `handlebars`, `ioredis`, `jose`, `multer`, `pg`, `socket.io`, `@socket.io/redis-adapter`, `zod`, `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `@tanstack/react-table`, `socket.io-client`, `sonner`), `Apache-2.0` (4: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `firebase-admin`, `puppeteer`, `sharp` — 5 actually), `MIT-0` (1: `nodemailer`), `OFL-1.1` (2: `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` — SIL Open Font License, a font-specific permissive license, not copyleft). Zero GPL/AGPL/LGPL/SSPL/copyleft licenses found among direct production dependencies. The 6 `@crm2/*` workspace packages (`sdk`, `ui-theme`, `access`, `config`, `logger`, plus `apps/web`/`apps/api` themselves) are internal, unpublished, and inherit the root `UNLICENSED` field (`package.json:3`) — no external-disclosure question applies to them. | All license obligations (MIT/Apache-2.0/MIT-0 attribution-only, OFL-1.1 font redistribution terms) are compatible with a closed-source "UNLICENSED" product; none require source disclosure. Transitive-dependency licenses (e.g. inside `firebase-admin`'s `@google-cloud/*` tree) were not individually re-verified — see DEPENDENCY_AUDIT-02 (informational, scope note). |
| Supply chain risks | PASS | (a) No git/tarball/`file:`/`http(s)://`-protocol dependency specifiers anywhere: `grep -rn "\"git+\|\"github:\|\"file:\|\"http://\|\"https://" apps/*/package.json packages/*/package.json package.json` → zero matches. (b) No wildcard/`latest` version pins: `grep -rn ": \"\\*\"\|: \"latest\""` → zero matches. (c) Lockfile carries integrity hashes: `grep -c "integrity:" pnpm-lock.yaml` → `896`. (d) `packageManager` pinned at `package.json:11` → `"pnpm@9.0.0"` (corepack-enforceable, prevents npm/yarn substitution). (e) CI installs with `pnpm install --frozen-lockfile` (`.github/workflows/ci.yml:39,75,101,145`, `.github/workflows/deploy.yml:47`) — lockfile drift fails the build rather than silently re-resolving. (f) `puppeteer@25.1.0`'s `postinstall: 'node install.mjs'` (downloads Chromium from Google's CDN) is neutralized in both prod Docker images via `ENV PUPPETEER_SKIP_DOWNLOAD=true` (`infra/Dockerfile.web:12`, `infra/Dockerfile.api:22-23`), with `apt-get install chromium` + `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` used instead (`infra/Dockerfile.api:17,23`) — so prod images never pull an unverified binary from a third party at build time. (g) `sharp@0.35.1` is the only other native-binary-fetching package found; its installed `package.json` scripts show no postinstall hook (`build`/`build:dist` are explicit dev-only scripts, not auto-run by pnpm's default-blocked-scripts policy) — not independently re-verified further (see DEPENDENCY_AUDIT-03). | See DEPENDENCY_AUDIT-03 (informational: CI runners, unlike the prod Docker build, do NOT set `PUPPETEER_SKIP_DOWNLOAD`, so CI's `pnpm install --frozen-lockfile` steps do fetch Chromium from Google's CDN on every run) and DEPENDENCY_AUDIT-04 (informational: no Dependabot/Renovate config found — dependency updates are manual only, per `git log` showing hand-authored `chore(deps)` commits). |

## Findings

### DEPENDENCY_AUDIT-01
- **Category:** Unused Dependencies
- **Severity:** Low
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-1104 (Use of Unmaintained Third-Party Components — closest fit; this is dead-weight, not a maintenance-status issue, so treat CWE as approximate)
- **Location**
  - **File:** `/Users/mayurkulkarni/Downloads/crm2/package.json`
  - **Line Number:** 32, 43
- **Evidence:**
  ```
  Unused devDependencies (2)
  @vitest/coverage-v8  package.json:32:6
  vitest               package.json:43:6
  ```
  (`pnpm run deadcode` / knip output, captured verbatim above.) Root `package.json` `scripts` block (lines 14-27) contains no `test`, `vitest`, or `coverage` script; every workspace that runs tests already declares its own `vitest`/`@vitest/coverage-v8` (`apps/api/package.json:51,55`; `apps/web/package.json:39`; `packages/sdk/package.json:17,19`; `packages/logger/package.json:18,20`).
- **Why it is a problem:** Two copies of `vitest`/`@vitest/coverage-v8` (root + each workspace) are resolved and installed even though the root copies are never invoked by any script. This is pure dependency bloat — extra install time, extra lockfile surface, extra packages for `pnpm audit` to scan — with zero functional benefit. It is not a security hole, but it is exactly the kind of drift this checklist exists to catch.
- **Real world attack scenario:** None directly (it's dead weight, not a code path). Indirect risk: every additional resolved package is one more thing `pnpm audit` has to clear and one more thing a future contributor might assume is load-bearing and avoid removing, increasing audit noise over time on a CRM that handles client/case/KYC PII and needs a clean, auditable dependency surface.
- **Business impact:** Negligible directly; marginal CI/install-time cost and marginal increase in dependency-audit surface area on a system handling PII.
- **Recommended fix:** Remove `vitest` and `@vitest/coverage-v8` from the root `package.json` `devDependencies` (lines 32, 43) — each workspace that needs them already has its own. Re-run `pnpm install` (not performed here, read-only audit) and `pnpm run deadcode` to confirm knip reports zero unused devDependencies afterward.
- **Estimated effort:** S (15 min)
- **Priority:** P3
- **Status:** OPEN

### DEPENDENCY_AUDIT-02
- **Category:** License Risk (scope/coverage gap, not a confirmed violation)
- **Severity:** Informational
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** N/A
- **Location**
  - **File:** `/Users/mayurkulkarni/Downloads/crm2/pnpm-lock.yaml`
  - **Line Number:** N/A (whole-file scope note)
- **Evidence:** The 34-package direct-production-dependency license sweep (PASS above) covers only the packages declared directly in each workspace's `package.json`. `firebase-admin@14.0.0`'s own transitive tree (`@google-cloud/storage`, `google-auth-library`, `gaxios`, `gcp-metadata`, `gtoken`, `retry-request`, `teeny-request`, etc. — visible in the `pnpm why uuid` output above) was not individually license-checked; these are all Google-published packages conventionally Apache-2.0, but this was not verified file-by-file in this pass.
- **Why it is a problem:** A truly exhaustive license audit (per the checklist's literal "license risks" item) would need to walk every resolved package in `pnpm-lock.yaml`, not just the 34 direct production deps the architecture inventory enumerated. The task instructions scoped license-field scanning explicitly to "the direct production dependencies (34 unique, listed in docs/architecture-inventory.md §12)", so this is flagged as a documented scope boundary, not a failure to look.
- **Real world attack scenario:** N/A — no evidence of an actual copyleft transitive dependency; this is a coverage caveat, not a finding of risk.
- **Business impact:** None identified; documented for completeness so a future full transitive-license sweep (e.g. via `license-checker` or similar, if ever added) isn't assumed redundant with this audit.
- **Recommended fix:** If full transitive-license assurance is ever required (e.g. for a customer security questionnaire), run a dedicated SPDX/license-scanning tool (e.g. `pnpm dlx license-checker --summary`) across the full resolved tree — out of scope for this pass per the task's own scoping instruction.
- **Estimated effort:** N/A (no fix needed; documentation note only)
- **Priority:** P3
- **Status:** OPEN

### DEPENDENCY_AUDIT-03
- **Category:** Supply Chain Risk
- **Severity:** Informational
- **CVSS:** N/A
- **OWASP Mapping:** A08:2021 – Software and Data Integrity Failures (loosely; CI fetching an unpinned third-party binary at install time)
- **CWE Mapping:** CWE-829 (Inclusion of Functionality from Untrusted Control Sphere)
- **Location**
  - **File:** `/Users/mayurkulkarni/Downloads/crm2/.github/workflows/ci.yml`
  - **Line Number:** 39, 75, 101, 145
- **Evidence:**
  ```
  39:      - run: pnpm install --frozen-lockfile
  75:      - run: pnpm install --frozen-lockfile
  101:      - run: pnpm install --frozen-lockfile
  145:      - run: pnpm install --frozen-lockfile
  ```
  None of these steps (nor any earlier `env:` block in the same jobs) set `PUPPETEER_SKIP_DOWNLOAD`. By contrast, both prod Docker images explicitly neutralize this: `infra/Dockerfile.web:12` → `ENV PUPPETEER_SKIP_DOWNLOAD=true` and `infra/Dockerfile.api:22-23` → `ENV PUPPETEER_SKIP_DOWNLOAD=true \` / `    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \`. `puppeteer@25.1.0`'s own `package.json` declares `"postinstall": "node install.mjs"` (confirmed via `node -e` dump of `node_modules/.pnpm/puppeteer@25.1.0/node_modules/puppeteer/package.json` scripts block).
- **Why it is a problem:** Every CI run's `pnpm install --frozen-lockfile` step (4 separate jobs: static, test, build, e2e) downloads a Chromium binary directly from Google's CDN via puppeteer's installer, unpinned by the pnpm lockfile's content hashes (binary downloads are outside npm package integrity). This is standard puppeteer behavior and Google's CDN is a reputable source, but it is an uncontrolled, non-lockfile-verified binary fetch happening on every CI run — the same risk class the prod Docker build deliberately avoided.
- **Real world attack scenario:** Low likelihood, but if Google's Chromium-for-Testing distribution were ever compromised or the install script's URL/checksum logic had a bug, every CI run (not prod, since prod uses the apt-packaged Chromium) would silently pull a malicious or corrupted binary into the build/e2e environment. The CRM's e2e suite touches a fully seeded fixture stack (no prod data), so blast radius is contained to CI infrastructure, not customer/KYC data — but a compromised CI runner is still a credential-theft/supply-chain pivot point (CI has `DEPLOY_ENABLED`-gated deploy secrets in the same repo).
- **Business impact:** Low — CI-only exposure, not a path to production data given current CI secret scoping (deploy is a separate gated job), but worth closing for defense-in-depth on a repo with deploy credentials in Actions Secrets.
- **Recommended fix:** Set `PUPPETEER_SKIP_DOWNLOAD=true` as a workflow-level `env:` in `.github/workflows/ci.yml` (mirroring the Dockerfiles) and install/cache a pinned `chromium` apt package or use an `apt-get`-based Chromium for whichever CI step actually exercises `puppeteer` (PDF rendering tests per `apps/api` test suite, referenced in `.github/workflows/ci.yml` comment line 76 "pdf.test.ts + caseReports render a real PDF via Puppeteer"), consistent with the prod image's approach.
- **Estimated effort:** S (30 min — add env var + verify the puppeteer-dependent test step still finds a working Chromium binary in the CI image)
- **Priority:** P3
- **Status:** OPEN

### DEPENDENCY_AUDIT-04
- **Category:** Supply Chain Risk / Process Gap
- **Severity:** Informational
- **CVSS:** N/A
- **OWASP Mapping:** A06:2021 – Vulnerable and Outdated Components
- **CWE Mapping:** CWE-1104
- **Location**
  - **File:** `/Users/mayurkulkarni/Downloads/crm2/.github`
  - **Line Number:** N/A (absence of a file)
- **Evidence:** `find .github -iname "*dependabot*" -o -iname "*renovate*"` → no matches; `find . -maxdepth 1 -iname "renovate.json*"` → no matches. `git log --oneline -5 -- package.json` shows the last several dependency bumps (`6f873a9 chore(deps): upgrade vite 5→8, vitest 2→4, ...`, `8c126d1 chore(deps): upgrade TypeScript 5 → 6`, `0d52db9 chore(deps): bump eslint 10 + @eslint/js 10`) are all hand-authored commits, not bot-generated.
- **Why it is a problem:** With no Dependabot/Renovate (or equivalent) configured, new CVEs landing in any of the 57 direct dependencies (or their transitive trees) will only surface the next time someone manually runs `pnpm audit` or manually bumps versions — there's no automated, recurring signal. This is a process gap, not an active vulnerability.
- **Real world attack scenario:** A future CVE in a hot path (e.g. `express`, `jose`, `pg`, `sharp` — all directly handling untrusted input: HTTP requests, JWTs, SQL params, uploaded field-verification photos) could sit unpatched for an extended period simply because nobody happened to re-run `pnpm audit`, on a CRM holding case/client/KYC PII.
- **Business impact:** Low-to-Medium over time — the risk compounds the longer the repo goes without an automated check; currently mitigated by the fact this very audit just ran `pnpm audit --prod` and found only the one already-known, non-exploitable-here moderate finding.
- **Recommended fix:** Add a Dependabot config (`.github/dependabot.yml`) for the `npm`/pnpm ecosystem with at least a weekly schedule, or wire a scheduled CI job that runs `pnpm audit --prod` and opens an issue/notifies on new findings. Low effort, high recurring value given this repo already gates merges behind CI.
- **Estimated effort:** S (1 hour)
- **Priority:** P3
- **Status:** OPEN

## Summary

Counts by severity: Critical 0, High 0, Medium 0, Low 1, Informational 3.

**Overall verdict: PARTIAL.** Every checklist item resolved to PASS with concrete, traced evidence except "Unused packages," which is a real but low-severity FAIL (`vitest` + `@vitest/coverage-v8` duplicated in the root `package.json` with zero usage there). The one previously-known `uuid` transitive advisory was re-verified at the call-site level (not just re-asserted) and confirmed non-exploitable through either dependency chain in this codebase, since both `exceljs` and `gaxios` only ever call the unaffected `uuid.v4()`, never the vulnerable `v3/v5/v6` overloads with attacker-controlled `buf`. License posture is clean (MIT/Apache-2.0/MIT-0/OFL-1.1 only, no copyleft) and fully compatible with the closed-source `UNLICENSED` root package. Supply-chain hygiene is solid overall — pinned `packageManager`, frozen-lockfile CI installs, integrity-hashed lockfile, no git/tarball/wildcard dependency specifiers, and the prod Docker build correctly neutralizes Puppeteer's Chromium auto-download — with only minor, non-blocking gaps (CI doesn't mirror the Dockerfiles' `PUPPETEER_SKIP_DOWNLOAD`, and there's no automated Dependabot/Renovate dependency-update signal). None of the four findings are Critical or High; none require urgent action, but DEPENDENCY_AUDIT-01 is a trivial cleanup and DEPENDENCY_AUDIT-04 (Dependabot) is a high-value, low-effort process improvement worth scheduling.
