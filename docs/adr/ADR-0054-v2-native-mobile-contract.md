# ADR-0054: v2-native mobile contract — retire v1 compatibility

- **Status:** **Accepted** — owner-directed 2026-06-20 (owner + CTO). The independent CTO and CEO reviews
  both recommended *deferring* this milestone (invisible payoff, largest cross-repo blast radius, blocks the
  Verification Workspace, and the agent-visible sync fields are already shipped); the **owner overrode that
  recommendation** and chose to proceed with the full scope, exercising owner/CTO authority. The reviews'
  risk findings are adopted as **binding mitigations** (see below). **Supersedes** the byte-compatibility
  stance of [ADR-0012] and the `MOBILE_API_COMPATIBILITY_MATRIX.md` "never remove/rename a field the app
  reads" don't-regress rule, and the "**full v1 parity in v2 first**" choice recorded in the 2026-06-17
  mobile-connection work (`LONG_TERM_PROTECTION.md`).
- **Date:** 2026-06-20
- **Scope:** the entire `crm-mobile-native` ↔ `/api/v2` surface (6 endpoint groups). Cross-repo:
  `crm2` (backend + `@crm2/sdk`) **and** `crm-mobile-native` (the field app). No DB migration.
- **Precondition (confirmed):** **no field agent is on a v2-connected build today** — the app is in the
  repoint/rebuild phase. So we define the clean contract once and the rebuilt app ships it; **no v1↔v2
  coexistence shim is needed**, and the backend and app land together.

## Context

Web and mobile both consume the single `/api/v2/*` contract via `@crm2/sdk` (ADR-0011/0012). The earlier
mobile-connection plan kept the app **unmodified** and made v2 emit a **byte-for-byte v1 shape**:
- the app's `src/api/apiClient.ts` wraps every call in `normalizeV2Envelope` (2xx) / `normalizeV2Error`
  (4xx/5xx) to rewrite v2's bare/paginated/`{error:CODE}` bodies back into the v1 `{success,message,data}`
  shape the app was built against;
- `GET /sync/download` emits the full v1 `MobileCaseResponse` task shape, including **duplicate aliases**
  (`id`+`verificationTaskId`, `title`+`verificationTaskNumber`), **phantom empties**
  (`addressCity`/`addressState`/`attachments[]`/`isSaved`/`syncStatus`), and a synthetic `description`;
- a handful of endpoints emit the v1 `{success,message,data}` envelope (sync download, the device
  verification-task routes, device attachment results) instead of the v2-native body.

The audit (322 fields / 6 groups, `MOBILE_V2_VS_V1_DATAFLOW_2026-06-18.md`) found the **vast majority of
v1↔v2 differences are envelope drift the app's adapter already bridges** — i.e. the backend is *already
v2-native* for most endpoints; the v1 surface is the **app's adapter + the few v1-enveloped endpoints + the
sync field aliases**.

Because we are rebuilding the app anyway, carrying v1 compatibility forever is needless debt. We will make
the **final app v2-native** and clean the contract on both sides.

## Decision

The mobile contract is **v2-native**: the app consumes v2 endpoints directly — bare objects, paginated
list envelopes, and `{error:CODE,...}` error bodies — with **no v1 envelope adapter** and **no v1 field
aliases/phantoms**. Concretely:

### Backend (`crm2`)
- Drop the v1 `{success,message,data}` wrapper on the device endpoints that still emit it; serve the
  v2-native body (bare/`{items,...}` list/`{error}`), consistent with every other `/api/v2` route.
- `GET /sync/download`: emit a **clean v2-native task shape** — one canonical id (`id`), one canonical
  number (`taskNumber`), one address (`address` free-text + `pincode`), structured catalog refs
  (`client`/`product`/`verificationUnit`), execution timestamps, and the delta/watermark envelope. **No**
  `verificationTaskId`/`verificationTaskNumber`/`description`/`addressCity`/`addressState`/`isSaved`/
  `savedAt`/`syncStatus`/`attachments[]`.
- Keep the **scope seam** (ADR-0022) on every device read, **idempotency-key** dedupe on writes, **JWT
  pair** shape, **409-as-success** on start/complete/revoke, the **policy-acceptance** login gate
  (`mustAcceptPolicies`/`pendingPolicies` + accept, ADR-0043) — these are behavioural contracts, not v1
  cruft, and stay.
- `@crm2/sdk` `sync.ts` (+ any mobile DTO types) updated to the v2-native shapes; OpenAPI regen.

### App (`crm-mobile-native`)
- Remove `normalizeV2Envelope`/`normalizeV2Error`; call sites read v2 bodies directly.
- Update Zod schemas (`src/api/schemas/*`) + TS types (`src/types/api.ts`) to the v2-native shapes.
- Update the SQLite sync upsert (`src/sync/SyncDownloadService.ts`) to key on `id` (not
  `verificationTaskId`) and source the VT-number from `taskNumber` (not `verificationTaskNumber`); drop the
  dead columns' writers.
- Keep device-owned local state (`is_saved`/`saved_at`/`sync_status`) as **purely local** — never expected
  from the server.

### Rollout
No live v2 app → the rebuilt app and the v2-native backend ship **together**; no versioned `/sync` endpoint,
no coexistence shim. Until both are ready, the v2-native backend changes stay on a branch (not deployed),
because they would break the *current* (still-v1-shaped, disconnected) app contract tests.

## Phased plan (decomposition — each phase: backend clean + app update + both-consumer contract tests green)

This is a milestone; it ships in slices, each independently buildable and testable. **Field first.**

1. **Field sync down-sync** — `GET /sync/download` clean task shape + the app sync layer (schema, upsert,
   types, screens). The largest field-level cleanup; the owner's focus.
2. **Device verification lifecycle** — `start`/`verification/:formType`/`complete`/`revoke`/`priority` +
   attachments: v2-native envelopes, drop the v1 wrapper; app call sites + schemas.
3. **Auth & identity** — login/refresh/version-check/profile/photo: v2-native; keep the JWT-pair +
   policy-acceptance gate; drop the v1 envelope adapter for these.
4. **Notifications, location, telemetry, reference/consents** — v2-native list/paginate + write shapes.
5. **Adapter removal & sweep** — delete `normalizeV2Envelope`/`normalizeV2Error`, the v1 type aliases, and
   any remaining compat code; rewrite the mobile contract tests to the v2-native shapes; update the
   compatibility matrix + ADR-0012 cross-refs to point here.

## Risk mitigations (binding — from the CTO/CEO review)

These are **hard requirements**, not advice — they address the concrete failure modes the review surfaced:

1. **Branch discipline / never auto-deploy a half-migration.** All backend changes for a phase live on a
   feature branch and **MUST NOT merge to `main`** (which auto-deploys to prod) until that phase's rebuilt
   app is built AND device-smoked. The backend v2-native shape breaks the *current* app, so a premature
   merge bricks the field app. Each phase merges backend + app **together**, after a green device smoke.
2. **Make the mobile contract test a real gate.** Today `ci.yml`'s `contract:mobile` step is a
   `|| echo 'not yet wired'` no-op and there are **zero app-side tests**. Before changing `toMobileTask`:
   (a) rewrite the backend `sync.api.test.ts` (currently pinned to the v1 shape — asserts `addressCity===''`,
   `verificationTaskNumber`, the `{success,message,data}` envelope) to the v2-native shape; (b) add an
   **app-side schema test** that parses a real v2 payload against the new Zod schema; (c) make the gate fail
   when the contract test is absent.
3. **Treat the `verificationTaskId → id` rename as one tracked unit.** It is the canonical backend id across
   **~23 app files**, including the local-id ↔ `verification_task_id` reconciliation in
   `src/data/.../TaskRepository.ts` and the `sync_queue` `backend_task_id` join. The rename is the largest,
   riskiest item — do it as a single reviewed change with the reconciliation logic explicitly re-verified,
   not a find-replace.
4. **Identifiable builds.** Bump the app `versionName`/`versionCode` off the stale `1.0.68` for the rebuilt
   artifact, so the shipped v2-native build is distinguishable from any prior one.
5. **Hold the "no live v2 app" freeze.** This premise is the safety net; do not cut any other v2-connected
   app build while the milestone is in flight. If a v2 build must ship mid-milestone, this ADR's
   ship-together plan is void and a versioned `/sync` endpoint is required instead.
6. **Preserve behavioural contracts** unchanged through every phase: scope seam (ADR-0022), idempotency-key
   dedupe, JWT-pair, 409-as-success, the policy-acceptance login gate (ADR-0043).

## Consequences

### Positive
- One clean contract, no adapter, no duplicate/phantom fields; smaller payloads, simpler mapper + app.
- The app is the "final version" — no v1 debt carried into the rebuild.
- Behavioural contracts (scope, idempotency, JWT pair, 409-as-success, policy gate) are preserved.

### Negative / risks
- **Cross-repo, ship-together:** the v2-native backend would break the *current* app contract tests until
  the app is migrated — so backend changes stay on a branch and deploy only with the app rebuild. The
  per-phase contract tests must be **rewritten** to the v2-native shapes (the old v1-shape tests retire).
- **`crm-mobile-native` is a separate repo** with its own build/release (RN, app store / internal
  distribution). Each phase's app changes need a build + device smoke before the paired backend deploys.
- The `MOBILE_API_COMPATIBILITY_MATRIX.md` don't-regress rules are **superseded** for the mobile surface;
  that doc must be updated to the v2-native contract so it doesn't mislead future work.

## Alternatives Considered
- **Keep v1 byte-compat (status quo, ADR-0012)** — rejected by the owner: needless debt when the app is
  being rebuilt anyway.
- **v2-only just for `/sync/download`, keep the adapter for the rest** — rejected: leaves the v1 adapter
  and a mixed contract; the owner wants the whole app v2-native.
- **Version the sync endpoint (`/sync/v2/download`) for coexistence** — unnecessary: no live v2 app, so
  there is nothing to coexist with.

## Related ADRs
- [ADR-0012] — mobile integration strategy / byte-compat contract. **Superseded** by this ADR for the
  mobile surface.
- [ADR-0011] — `/api/v2` versioning (additive-only within v2). This is a v2-internal contract redefinition
  done under owner/CTO sign-off, not a new API version.
- [ADR-0035] — sync delta arrays + execution fields (the `toMobileTask` field set Phase 1 rewrites).
- [ADR-0022] — central scope seam (preserved on every device read).
- [ADR-0043] — policy-acceptance login gate (preserved).

[ADR-0011]: ./ADR-0011-api-versioning-strategy.md
[ADR-0012]: ./ADR-0012-mobile-integration-strategy.md
[ADR-0035]: ./ADR-0035-sync-delta-arrays-and-execution-fields.md
[ADR-0022]: ./ADR-0022-access-control-2.0-configurable-roles-and-scope.md
[ADR-0043]: ./ADR-0043-login-policy-acceptance.md
