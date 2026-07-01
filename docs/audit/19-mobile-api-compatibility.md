# AUDIT 19: Mobile API Compatibility

## Scope

Read-only inspection of the crm2 side of the mobile (`crm-mobile-native`, separate/inaccessible repo) ↔
`/api/v2` contract. The mobile repo itself was never opened — all conclusions are derived from this repo's
own code, docs, ADRs, and CI config.

**Docs read:**
- `docs/architecture-inventory.md`
- `docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md` (frozen governance doc)
- `docs/engineering/MOBILE_V2_CONNECTION_AUDIT_2026-06-17.md` (live-verified connection/parity audit)
- `docs/adr/ADR-0011-api-versioning-strategy.md`, `ADR-0012-mobile-integration-strategy.md`,
  `ADR-0054-v2-native-mobile-contract.md`, `ADR-0043-login-policy-acceptance.md`
- `docs/COMPLIANCE_GAPS_REGISTRY.md` (grepped for `mobile`/`owner-release-gated`/`Branch only`)

**Code read:**
- `apps/api/src/modules/sync/{service,repository}.ts` + `__tests__/sync.api.test.ts`
- `apps/api/src/platform/realtime/index.ts` (socket auth/handshake, emit surface)
- `apps/api/src/modules/auth/service.ts`, `routes.ts`, `__tests__/auth.api.test.ts`,
  `__tests__/policyGate.api.test.ts`
- `apps/api/src/modules/notifications/service.ts`, `routes.ts`
- `apps/api/src/modules/location/service.ts`, `repository.ts`
- `apps/api/src/modules/verification-tasks/service.ts` (idempotent attachment upload, submit==complete)
- `apps/api/src/modules/cases/repository.ts` (`insertFieldAttachment`, `operation_id` UNIQUE)
- `apps/api/src/modules/forms/{service,routes}.ts`, `apps/api/src/modules/telemetry/{service,controller}.ts`
  (mobile-parity stub endpoints — checked for tests)
- `apps/api/src/modules/consents/service.ts`, `packages/sdk/src/consents.ts` (policy-acceptance contract,
  cross-checked against ADR-0043's reconciliation note)
- `packages/sdk/src/sync.ts` (`MobileSyncTask` v2-native shape)
- `apps/api/src/modules/users/service.ts` (profile-photo dual-key response)
- `.github/workflows/ci.yml` (contract-test gate wiring), `apps/api/package.json`, root `package.json`

**Commands actually run:**
```
git log --oneline main | grep -E "a0177de|d81829f|fd519a9"     # confirms ADR-0054 phases are on main
git branch --contains a0177de                                   # confirms main, not a stray branch
grep -n "test:contract-mobile" apps/api/package.json
grep -n "contract:web\|contract:mobile" .github/workflows/ci.yml package.json apps/*/package.json
bash -c "true && false || echo fallback"; echo $?              # proved the `||` masks failure (exit 0)
find apps/api/src/modules/forms apps/api/src/modules/telemetry -type f
find apps/api/src/modules -maxdepth 2 -iname "__tests__"        # enumerated which modules have any tests
grep -rn "Idempotency-Key\|idempotencyKey\|idempotency_key" apps/api/src --include="*.ts"
grep -n "operationId\|ON CONFLICT\|operation_id" apps/api/src/modules/location/repository.ts
grep -rn "bodyHash\|body_hash\|hashBody" apps/api/src/modules/ --include="*.ts"
grep -n "ADR-0054\|v2-native" docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md   # 0 hits
wc -l apps/api/src/modules/{verification-tasks,sync,auth}/__tests__/*.test.ts
```

`pnpm openapi` was attempted to verify drift status but errored (exit 127) outside the full workspace
build context; not rerun further to respect the read-only/no-build constraint. OpenAPI drift is instead
assessed from the CI step definition (`.github/workflows/ci.yml:106-113`), which is a real, blocking gate.

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| Current API compatibility | PASS | `apps/api/src/modules/sync/service.ts:14-55` `toMobileTask`; `packages/sdk/src/sync.ts:20-60` `MobileSyncTask` — v2-native shape matches ADR-0054 exactly (canonical `id`/`taskNumber`, no v1 aliases). `git log --oneline main \| grep a0177de\|d81829f\|fd519a9` confirms all 3 ADR-0054 backend phases are merged to `main`. | The "current" contract is the v2-native one; the still-disconnected production mobile app (v1-shaped, per `MOBILE_V2_CONNECTION_AUDIT_2026-06-17.md` — TLS-pin + base-URL mismatch) was never live against it, so the breaking shape change had zero live blast radius (ship-together precondition honored). |
| Breaking changes | PASS | `docs/adr/ADR-0054-v2-native-mobile-contract.md:1-13` documents the breaking change as a deliberate, owner-overridden, sign-off-gated supersession of ADR-0012's byte-compat stance, with binding mitigations (branch discipline, no premature merge while a live v1 app exists). `MOBILE_V2_CONNECTION_AUDIT_2026-06-17.md` confirms "100% disconnected from prod" pre-change. | No machine-enforced "no breaking REST changes" linter exists (see MOBILE_API_COMPATIBILITY_MATRIX-02 below) — additive-only discipline for `/api/v2` is process-enforced (OpenAPI diff + human review), not tool-enforced. Acceptable given the documented sign-off trail for the one breaking change found. |
| Contract consistency | PARTIAL | `apps/api/src/modules/notifications/routes.ts:18-28` PUT aliases present and match the matrix's documented method-drift fix; `apps/api/src/modules/users/service.ts:409-424` dual `{url, profilePhotoUrl}` response matches the documented fix. BUT `docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md` documents `POST /api/v2/auth/accept-policies {policyIds[],source}` + `source='MOBILE'` as a "locked mobile contract," while the actually-implemented endpoint is `POST /api/v2/consents/accept {policyVersion}` (`apps/api/src/modules/consents/service.ts:1-15`, `packages/sdk/src/consents.ts:9-12`) — no `source` field exists at all. `docs/adr/ADR-0043-login-policy-acceptance.md:7-18` documents this as a deliberate reconciliation, but the compatibility matrix was never updated to match. | See finding MOBILE_API_COMPATIBILITY-01. |
| Socket events | PASS | `apps/api/src/platform/realtime/index.ts:22-34` defines `emitToUser`/`emitToFieldMonitoring`/`emitToOffice`/`disconnectUser`; `apps/api/src/modules/auth/service.ts:33-52` emits `auth:session_revoked` to the device room on logout/session-revoke (closing the gap the 2026-06-17 audit flagged); `apps/api/src/modules/notifications/service.ts:79` emits `notification`; `:229` emits `location:request`. `apps/api/src/modules/auth/__tests__/auth.api.test.ts:264,328-364` cover the forced-logout emit (both logout-all and single-session revoke). | Matches `MOBILE_V2_CONNECTION_AUDIT_2026-06-17.md`'s "(D) Missing socket event ... Fix: emit on logout/refresh-revoke (Phase 1G)" — verified actually shipped, not just claimed. |
| Authentication | PASS | `apps/api/src/platform/realtime/index.ts:91-105` `resolveSocketIdentity` verifies the JWT + checks `isAccessRevoked` (kill-switch) before granting any room; `apps/api/src/modules/auth/service.ts:295-296` blocks `refresh` while `mustAcceptPolicies` is pending; JWT-pair shape (`accessToken/refreshToken/expiresIn`) confirmed unchanged per `packages/sdk/src/auth.ts:8`. | Consistent with the broader security-hardening ADR-0076 (kill-switch, iat-check) already audited separately; not re-litigated here. |
| Offline sync | PASS (with a design note) | `apps/api/src/modules/sync/repository.ts:87-114` scope-composed, contract-filtered (`ct.assigned_to = $1`), delta-watermarked, deterministically paginated down-sync; `:129-145` `revokedAssignmentIdsForUser` purge-signal sourced from append-only `task_assignment_history`. Idempotent writes use a DB-level `operation_id` UNIQUE constraint + replay-by-lookup (`apps/api/src/modules/verification-tasks/service.ts:210-216,264,271-276`; `apps/api/src/modules/location/repository.ts:36-57` `ON CONFLICT (operation_id) ... DO NOTHING` + re-select), which structurally satisfies "never cache a 4xx" — a failed attempt never inserts a row, so there is nothing to replay-as-cached-failure (no generic response-caching middleware exists to even have that bug). `grep -rn "bodyHash\|body_hash\|hashBody"` → 0 hits: no request-body-hash comparison exists anywhere. | The `MOBILE_API_COMPATIBILITY_MATRIX.md` "Don't-regress" bullet phrases idempotency as "method+body+key" dedupe — that is actually the **v1** (CRM-BACKEND) middleware design (per local Claude memory `project_idempotency_4xx_no_cache.md`, itself a v1-repo artifact). crm2's actual mechanism is a different, valid pattern (per-domain `operation_id` UNIQUE), but it does NOT compare the replay body against the original — a same-key, different-body retry silently returns the first result rather than 409-conflicting. See finding MOBILE_API_COMPATIBILITY-04. |
| Mobile-relied module test coverage vs `test:contract-mobile` scope | FAIL | `apps/api/package.json:13` `test:contract-mobile` covers `verification-tasks location users notifications sync auth consents reference`. The compatibility matrix (`docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md`) and connection audit additionally list `forms` (`GET /forms/:formType/template`) and `telemetry` (`POST /telemetry/mobile/ingest`) as mobile-parity endpoints. `find apps/api/src/modules/forms apps/api/src/modules/telemetry -type f` → no `__tests__/` directory in either module at all (confirmed against the full module list via `find apps/api/src/modules -maxdepth 2 -iname __tests__`, which lists 35 modules with tests — `forms` and `telemetry` are absent). | See finding MOBILE_API_COMPATIBILITY-02. Severity is tempered because both endpoints are intentionally trivial stubs (`forms` always returns `null`; `telemetry` validates+counts, never persists) — low logic surface, but zero test means a future edit (e.g. wiring telemetry to a real sink) has no regression net and no contract pin. |
| CI mobile contract gate actually blocks merge | FAIL | `.github/workflows/ci.yml:117`: `pnpm run --if-present contract:web && pnpm run --if-present contract:mobile \|\| echo 'contract tests not yet wired (activate with SDK phase)'`. `contract:web` does not exist in any `package.json` (`grep -rn "\"contract:web\""` → 0 hits) so `--if-present` no-ops it; `contract:mobile` exists (`package.json:28`) and runs real tests, but the `\|\|` means ANY failure (including a real mobile-contract regression) is swallowed and replaced with an `echo` that exits 0. Verified the shell semantics directly: `bash -c "true && false \|\| echo fallback"; echo $?` → prints `fallback` then `exit=0`. | See finding MOBILE_API_COMPATIBILITY-03. Mitigated-but-not-fixed: the same test files vitest covers under `test:contract-mobile`'s module list are also executed (unfiltered) by the `test` job's `pnpm test` → `vitest run` (`apps/api/package.json:12`), which IS a blocking gate (`needs: static`, no `\|\|`/`--if-present` swallow). So the underlying assertions are NOT silently skipped overall — only the dedicated "named mobile contract gate" in the `build` job is decorative/broken, contradicting ADR-0054's explicit claim ("Make the mobile contract test a real gate ... make the gate fail when the contract test is absent") and the project-memory claim that this was wired as "a real gate." |
| Stale/contradicted governance doc | FAIL | `docs/adr/ADR-0054-v2-native-mobile-contract.md` "Negative / risks": *"The `MOBILE_API_COMPATIBILITY_MATRIX.md` don't-regress rules are superseded for the mobile surface; that doc must be updated to the v2-native contract so it doesn't mislead future work."* `grep -n "ADR-0054\|v2-native" docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md` → 0 matches. The matrix still states "never remove/rename a field mobile reads" and lists the pre-ADR-0054 v1-shaped endpoint table (e.g., `auth/accept-policies` instead of `consents/accept`) as current. | See finding MOBILE_API_COMPATIBILITY-01 (same doc-drift root cause as the contract-consistency item above, reported once). |

## Findings

### MOBILE_API_COMPATIBILITY-01
- **Category:** Documentation drift / contract-consistency risk
- **Severity:** Low
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** N/A
- **Location**
  - **File:** `docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md`
  - **Line Number:** whole document (specifically the "Policy acceptance gate" row and the "Don't-regress" footer)
- **Evidence:**
  ```
  docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md (Policy acceptance gate row):
  "POST /api/v2/auth/accept-policies {policyIds[],source}` (authenticated, no permission, idempotent)
  ... posts `accept-policies` with `source='MOBILE'` (the value reserved for the device)"

  apps/api/src/modules/consents/service.ts:1-15 (the ACTUAL implemented endpoint):
  import { AcceptConsentSchema, type ConsentAcceptResult } from '@crm2/sdk';
  export const consentService = {
    async accept(userId, rawBody, ip, userAgent) {
      const b = AcceptConsentSchema.parse(rawBody);
      return { success: true, data: await repo.accept(userId, b.policyVersion, ip, userAgent) };
    },
  };

  packages/sdk/src/consents.ts:9-11:
  export const AcceptConsentSchema = z.object({
    policyVersion: z.coerce.number().int().positive(),
  });

  docs/adr/ADR-0043-login-policy-acceptance.md:7-18 (the reconciliation note, dated 2026-06-17):
  "acceptances are not stored in a dedicated policy_acceptances table... Web records acceptance via the
  shared POST /api/v2/consents/accept endpoint ({ policyVersion }, idempotent UPSERT) — the original
  POST /api/v2/auth/accept-policies endpoint ... were removed."

  grep -n "ADR-0054|v2-native" docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md → (no output, 0 matches)
  ```
- **Why it is a problem:** A developer (or the mobile team, working from a separate repo with no
  visibility into crm2's internal ADRs) implementing against `MOBILE_API_COMPATIBILITY_MATRIX.md` would
  build a client that posts `{policyIds, source}` to a `/auth/accept-policies` path that does not exist,
  and would never learn the real contract is `{policyVersion}` at `/consents/accept` with no `source`
  field at all. ADR-0054 itself flagged this exact doc as needing an update before further mobile work and
  that update was never done.
- **Real world attack scenario:** Not an attack vector — this is a contract-fidelity/documentation defect.
  Worst functional outcome: a mobile build targets the wrong endpoint/shape for the DPDP consent-acceptance
  gate (ADR-0043), fails to clear `mustAcceptPolicies`, and field agents get stuck unable to log in (a
  self-inflicted denial-of-service against the field workforce, not an external attacker).
- **Business impact:** Wasted mobile-dev time implementing a contract that was deprecated weeks earlier;
  risk of a broken DPDP-consent flow shipping to field agents if the mobile team trusts this doc over the
  ADRs.
- **Recommended fix:** Update `MOBILE_API_COMPATIBILITY_MATRIX.md`'s "Policy acceptance gate" row (and any
  other rows superseded by ADR-0054) to the current `consents/accept {policyVersion}` contract, and add the
  cross-reference to ADR-0054 that ADR-0054 itself calls for.
- **Estimated effort:** S (documentation-only change)
- **Priority:** P2
- **Status:** OPEN

### MOBILE_API_COMPATIBILITY-02
- **Category:** Test coverage gap
- **Severity:** Low
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-1120 (Excessive Code Complexity is not it — closest applicable: none; this is a
  process/coverage gap, not a code weakness)
- **Location**
  - **File:** `apps/api/src/modules/forms/service.ts`, `apps/api/src/modules/telemetry/service.ts`
  - **Line Number:** whole files (no `__tests__/` directory exists for either module)
- **Evidence:**
  ```
  $ find apps/api/src/modules/forms apps/api/src/modules/telemetry -type f
  apps/api/src/modules/forms/routes.ts
  apps/api/src/modules/forms/controller.ts
  apps/api/src/modules/forms/service.ts
  apps/api/src/modules/telemetry/routes.ts
  apps/api/src/modules/telemetry/controller.ts
  apps/api/src/modules/telemetry/service.ts
  (no __tests__/ in either listing)

  apps/api/package.json:13
  "test:contract-mobile": "vitest run --coverage.enabled=false src/modules/verification-tasks
    src/modules/location src/modules/users src/modules/notifications src/modules/sync src/modules/auth
    src/modules/consents src/modules/reference"
  (forms and telemetry are not in this list either)
  ```
- **Why it is a problem:** Both modules are explicitly documented as mobile-parity endpoints (`forms`:
  "`GET /forms/{formType}/template` (9 field types)" in `MOBILE_API_COMPATIBILITY_MATRIX.md`; `telemetry`:
  `apps/api/src/modules/telemetry/routes.ts:5` comment "optional mobile telemetry ingest (mobile parity)")
  but have zero automated test coverage and are absent from the named mobile-contract test scope. Today
  both are intentionally trivial (forms always returns `null`; telemetry validates+counts, never persists),
  so the immediate risk is low — but there is no regression net if either gains real logic later (e.g. when
  telemetry is wired to a real sink, per its own comment: "wiring the batch to a telemetry sink is a
  deliberate later step").
- **Real world attack scenario:** Not an attack vector. Functional risk: a future change to
  `TelemetryIngestSchema` or the forms-template null-fallback contract could silently change the response
  shape the device expects, with no test catching it before a deploy reaches the (eventually reconnected)
  field app.
- **Business impact:** Low today (stub endpoints); becomes Medium the day telemetry or forms gain real
  logic without tests being added at the same time.
- **Recommended fix:** Add a minimal `__tests__/forms.api.test.ts` and `__tests__/telemetry.api.test.ts`
  (even a single "returns the documented shape" assertion each) and add both modules to
  `test:contract-mobile`'s module list.
- **Estimated effort:** S (a few hours)
- **Priority:** P3
- **Status:** OPEN

### MOBILE_API_COMPATIBILITY-03
- **Category:** CI/CD gate integrity
- **Severity:** Medium
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-1126 (Declaration of Variable with Unnecessarily Wide Scope is not it — closest:
  none; this is a CI-process defect, not an application CWE)
- **Location**
  - **File:** `.github/workflows/ci.yml`
  - **Line Number:** 117
- **Evidence:**
  ```
  .github/workflows/ci.yml:115-117
        - name: Contract tests (web + mobile)
          run: pnpm run --if-present contract:web && pnpm run --if-present contract:mobile || echo 'contract tests not yet wired (activate with SDK phase)'

  $ grep -rn "\"contract:web\"" package.json apps/*/package.json   → (no output: script does not exist)
  $ grep -n "\"contract:mobile\"" package.json                     → 28:    "contract:mobile": "pnpm --filter @crm2/api test:contract-mobile"

  $ bash -c "true && false || echo fallback"; echo $?
  fallback
  0
  ```
- **Why it is a problem:** The step name and the inline comment (`"Contract tests — BOTH consumers must
  still pass (ADR-0011/0012). A change cannot merge unless current Web AND current Mobile contracts hold."`,
  `.github/workflows/ci.yml:113-114`) assert this is a blocking gate. It is not: `contract:web` doesn't
  exist (so it always no-ops via `--if-present`), and any failure of `contract:mobile` is swallowed by the
  `|| echo ...` fallback, which always exits 0. `ADR-0054`'s binding risk-mitigation #2 explicitly required
  *"make the gate fail when the contract test is absent"* — the opposite of what's wired. Project memory
  (`project_security_hardening_2026_06_27.md` and others) also assert "main CI fully GREEN" without
  flagging this gate as decorative.
  - **Mitigating factor (verified):** the same module test files are also run, unfiltered and with a real
    blocking exit code, by the `test` job's `pnpm test` → `apps/api` `vitest run` (`apps/api/package.json:12`,
    no `--if-present`/`||`), which IS gated (`needs: static`, feeds into `build`'s `needs: test`). So a
    regression in e.g. `sync.api.test.ts` or `auth.api.test.ts` DOES fail CI today — just via the generic
    `test` job, not via the dedicated "mobile contract" framing. The defect is the misleading/dead gate
    name and the broken `||` swallow, not a full loss of test enforcement.
- **Real world attack scenario:** Not an attack vector. Process risk: a developer who adds a NEW
  mobile-only contract test file that is intentionally excluded from the general `vitest run` glob (e.g.
  gated behind an env var, or living outside `src/modules/**`) would have no actual enforcement at all,
  because the one CI step whose entire job is to enforce mobile-contract-specific tests is non-blocking by
  construction.
- **Business impact:** A future regression that is only caught by a mobile-specific contract assertion (not
  duplicated in the general suite) could merge to `main` and auto-deploy to prod undetected, breaking the
  field app the moment it's reconnected.
- **Recommended fix:** Remove the `|| echo ...` swallow (let `contract:mobile` failures fail the step), and
  either add a real `contract:web` script or drop the dead `--if-present contract:web &&` clause so the
  step does exactly what its name and comment claim.
- **Estimated effort:** S (a few lines)
- **Priority:** P1
- **Status:** OPEN

### MOBILE_API_COMPATIBILITY-04
- **Category:** API contract / idempotency design gap
- **Severity:** Low
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-694 (Use of Multiple Resources with Duplicate Identifier — not quite; closest
  applicable: none precisely; treat as a logic/design gap)
- **Location**
  - **File:** `apps/api/src/modules/verification-tasks/service.ts`, `apps/api/src/modules/location/repository.ts`
  - **Line Number:** `verification-tasks/service.ts:210-216`; `location/repository.ts:36-57`
- **Evidence:**
  ```
  apps/api/src/modules/verification-tasks/service.ts:210-216
  // Idempotency replay: the device retries with the same operation id → return the cached rows.
  ...
  const cached = await repo.fieldAttachmentsByOperation(operationBase);
  if (cached.length > 0) return uploadResult(cached, [], caseId, taskId, verificationType, submissionId);

  apps/api/src/modules/location/repository.ts:36-38,53-57
  ON CONFLICT (operation_id) WHERE operation_id IS NOT NULL DO NOTHING
  ...
  // Conflict (duplicate operation_id) → the first row already exists; return it (idempotent).
  if (rows.length === 0 && p.operationId) { ... SELECT ... WHERE operation_id = $1 ... }

  $ grep -rn "bodyHash|body_hash|hashBody" apps/api/src/modules/ --include="*.ts"
  (no output — no body-hash comparison exists anywhere in the API)
  ```
  Compare to `docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md` "Don't-regress (mobile)": *"keep
  `Idempotency-Key` dedupe (method+body+key)"* — a body-hash check is documented as a contract the code
  must preserve.
- **Why it is a problem:** crm2's idempotency is correctly implemented as a DB-level `operation_id`
  UNIQUE-constraint dedupe (a sound, simpler pattern than v1's request-body-hash middleware), but it never
  compares the replay's body against the original request. A client retry that reuses the same
  `Idempotency-Key`/`operationId` with a DIFFERENT body (e.g. a buggy client that recycles a UUID, or a
  retry that accidentally mutates the payload) silently returns the FIRST result rather than rejecting with
  a conflict — the second (different) body is dropped with no error surfaced to the caller.
- **Real world attack scenario:** Not an attack vector under normal device behavior (the documented device
  flow always sends one fixed photo per generated `operationId`, so bodies never legitimately differ for
  the same key). Operationally: if a future client bug ever reuses an `operationId` across two different
  field photos or two different GPS fixes, the second is silently discarded with a 200 success — a field
  agent could believe a second/corrected evidence photo was uploaded when it was actually dropped, with no
  error in the app.
- **Business impact:** Low under current, well-behaved client code; becomes a real evidence-integrity risk
  (KYC/verification photo silently lost) only if a client-side `operationId`-generation bug is introduced.
- **Recommended fix:** Either (a) update the compatibility matrix's "method+body+key" claim to accurately
  describe the implemented `operation_id`-only dedupe (cheapest, since the current behavior is acceptable
  given the device's actual usage pattern), or (b) add a request-hash comparison on replay that 409s when
  the same key arrives with a materially different body, for defense-in-depth.
- **Estimated effort:** S (doc fix) or M (body-hash defense-in-depth)
- **Priority:** P3
- **Status:** OPEN

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 3 |
| Informational | 0 |

**Overall verdict: PARTIAL.**

The substantive mobile contract — v2-native sync shape (ADR-0054), idempotent writes, the `auth:session_revoked`
socket event, policy-acceptance login gate, JWT-pair auth, and scope-correct down-sync — is well-built,
well-tested (2,000+ lines of contract-relevant test code across `verification-tasks`, `sync`, and `auth`),
and matches its governing ADRs. No Critical or High issues were found, and the one genuinely breaking
change in the audit period (ADR-0054) was deliberately made, fully sign-off-gated, and carried zero live
blast radius because the production mobile app was never actually connected to `/api/v2` during the
transition. The PARTIAL verdict instead reflects governance hygiene: the CI step explicitly named and
commented as the mobile-contract merge gate is non-blocking by construction (Medium — mitigated by the fact
the same tests are exercised, just not under that name, by the generally-blocking `test` job), the
compatibility matrix doc was never updated after ADR-0054 explicitly called out the need to do so (Low),
two mobile-parity stub endpoints have zero test coverage (Low), and one documented idempotency guarantee
("method+body+key" dedupe) doesn't match the actually-implemented mechanism (Low). None of these block
current production mobile traffic (which is still disconnected), but all four should be closed before the
mobile app is repointed and released.
