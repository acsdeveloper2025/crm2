# CRM2 — Full-Platform Audit (2026-07-02)

**Type:** Audit only. No code changed, no migrations run, no registry dispositions made. Recommendations are proposals; each needs owner disposition (FIXED / DEFERRED / RATCHET / WONTFIX) in `docs/COMPLIANCE_GAPS_REGISTRY.md` before any fix work.
**Scope:** Backend (`apps/api` + `packages`), Frontend (`apps/web`), Database (`db/v2`), Cache, Docker/Deploy, API load-readiness & future-proofing, Data-leakage/PII, Monitoring/System-health, Mobile (`CRM-APP-MONOREPO-PROD/crm-mobile-native`).
**Method:** 10 parallel read-only specialist passes over HEAD `2037988`. Static analysis + read-only dev-DB SELECTs + one allowed GET `/api/v2/health`. **Live load testing was NOT run** — it needs owner approval and a target environment (won't hammer prod).
**Baseline honored:** the 2026-07-01 enterprise audit (`docs/audit/`, dispositions in the registry). Claimed fixes were sampled and confirmed genuinely present in code; this pass reports NEW findings / regressions, not already-dispositioned items.

---

## Verdict

No CRITICAL findings. The security core is genuinely hardened (auth, crypto, SQL-injection-free, scope/IDOR, upload AV, log redaction — all verified real). The platform's real exposure is **operational and load-path**, not code-security: it can lose data (no backups), can't see itself failing (no alerting, shallow health probe), drops in-flight work on every deploy (no SIGTERM drain), and has a handful of scope/PII edge-leaks and two missing indexes on its largest table.

| Domain | Grade | Headline |
|---|---|---|
| BE security | A− | 0 new High/Med; July-01 fixes verified real. 1 Low (MIS money-scope width). |
| BE correctness / dead code | A− | typecheck 8/8; no console.*; only Low dead-code + a sync-cursor edge. |
| Database | B | 2 High unindexed FKs on `case_tasks`; 4 tables grow unbounded; migration re-run guards missing. |
| Frontend | B | **1 live prod bug: all toasts invisible (CSP blocks Sonner CSS)**; no error boundary; no code-splitting. |
| Cache | A− | Clean by design; 1 Med (no `Cache-Control: no-store` on PII responses). |
| Docker / deploy | B− | Deploy gate runs no tests; API image ~2.5 GB (0.5 GB is a free win); rollback unverified. |
| API load / future-proof | B− | No SIGTERM drain; pool=10; expensive authed endpoints unthrottled; in-memory exports. |
| Data-leakage / PII | B | 1 High cross-scope dedupe PII leak; 1 High signed-URL TTL; query-string PII logging. |
| Monitoring / health | C+ | **No backups, no alerting, process-up-only health** — recreates the 2026-06-26 outage class. |
| Mobile | A− | 1 High (release build falls back to debug signing key); sync/crypto/pinning excellent. |

---

## Fix-first shortlist (highest value, ranked)

1. **[LIVE PROD BUG] Toasts invisible on production.** Sonner injects its stylesheet via a runtime `<style>` tag; `style-src 'self'` (shipped 2026-07-01) blocks it — proven by byte-for-byte hash match to the console errors. Every success/error toast across 16 pages renders as unstyled text below the fold. Fix: `pnpm patch sonner@2.0.7` to no-op `__insertCSS` + `import 'sonner/dist/styles.css'` in `App.tsx` (keeps CSP strict). *(FE-1)*
2. **[SECURITY] `POST /cases/dedupe` leaks cross-scope applicant PII.** `searchDuplicates` has no scope predicate and returns name/mobile/PAN/company/client for any matching case; route gated only on broad `case.view`. A field/client-scoped user learns applicants outside their scope. Fix: gate on `dedupe.view` or scope-filter (the sibling `/dedupe-search` already got this guard; this one was missed). *(PII-2)*
3. **[DATA-LOSS] No DB or MinIO backups exist anywhere.** DR doc claims daily base backup + WAL archiving; zero `pg_dump`/`wal-g`/`archive_command` in the repo. Volume corruption = total unrecoverable loss of KYC data + evidence photos. Fix: nightly `pg_dump | gzip` off-box + `mc mirror`, restore steps in `docs/operations/`. *(MON-1)*
4. **[RELIABILITY] No SIGTERM drain — every deploy drops in-flight requests/transactions.** Blue-green stops the old container; Node exits immediately, killing open HTTP + mid-`withTransaction` writes. Fix: `process.on('SIGTERM', () => server.close(() => pool.end()))` with a drain timeout. *(LOAD-1)*
5. **[OBSERVABILITY] Health probe is process-up only + zero alerting.** The `/api/v2/health` used by the docker healthcheck AND the deploy green/red gate never pings the DB — a crash-looping Postgres reads "healthy" (exactly the 2026-06-26 shape), and nothing alerts. Fix: unauth `?deep=1` → `SELECT 1` for the infra probe + one external uptime check + a `df` disk-watchdog cron. *(MON-2, MON-3)*
6. **[PERF] Two missing indexes on `case_tasks` (largest table).** FKs `rate_type_id` and `pincode_id` are unindexed → seq scans on rate-type/location edits, billing joins, and the assignee-eligibility query. Fix: `CREATE INDEX` on both. *(DB-1, DB-2)*
7. **[SECURITY] Deploy gate runs no tests.** `deploy.yml` gate = typecheck+lint+build; the test suite (`ci.yml`) runs in parallel and doesn't block the deploy. Green types + red tests auto-ships to prod. Fix: add `pnpm test` (+contract) to the gate or gate on the `ci` workflow. *(DOCKER-1)*
8. **[DoS] Expensive authenticated endpoints are unthrottled.** Only `/login`,`/refresh`,password/MFA are rate-limited; `?mode=all` exports, `field-photos.zip`, and `POST /:id/report` (Puppeteer) have only nginx's blanket 10 r/s. One scripted/compromised user saturates pool+CPU. Fix: per-user limiter on those routes (factory already exists). *(LOAD-2)*
9. **[SECURITY] Mobile release build silently falls back to the debug signing key** if `keystore.properties` is absent → world-known-key "release" APK. Fix: `throw GradleException` on release-without-keystore. *(MOBILE-1)*
10. **[FREE WIN] API image ~0.5 GB larger than needed.** `RUN chown -R node:node /app` duplicates the whole `/app` tree into a new layer. Fix: `COPY --chown=node:node` on the COPY lines — zero behavior change, ~0.5 GB off every deploy pull. *(DOCKER-15)*

---

## Findings by domain

### Backend security — 0 new High/Med
- **[LOW] BE-SEC-1** — MIS money columns gate on `billing.view` but money rows are scoped only by task/case visibility, not billing territory; a `billing.view` holder sees ₹ across their whole (possibly broad) case scope. `mis/controller.ts:16-18`. Likely intentional — confirm case-scope == billing-scope for those roles, note in registry.
- **[INFO]** MIS PAN/mobile/GPS default-visible to any `mis.export` holder — matches owner-ACCEPTED §MIS-6 (continuity only).
- **[INFO]** MIS `ORDER BY/GROUP BY/col.sql` interpolation is **safe** — all constants from the code-owned column registry, request keys mapped through allow-lists, unknown rejected. No injection path.
- **[INFO]** `verifySameOrigin` passes requests with no Origin/Referer — as-designed (CSRF-01), SameSite=Lax is the primary control; mobile uses body token.
- **[INFO]** PDF Chromium runs `--no-sandbox` — input is server-rendered auto-escaped HTML only; acceptable, note if user HTML is ever piped in.
- **Verified clean:** SQL injection (zero concatenated input; all `${}` are whitelisted columns or `$N`), route AuthZ coverage (every route gated or self-service-asserted), MIS IDOR/scope (out-of-scope → 0 rows, no money oracle), AuthN (kill-switch, refresh rotation + family-revoke, lockout, session cap), crypto (scrypt N=16384, timingSafeEqual, AES-256-GCM MFA, RFC-6238 TOTP, hashed+burned recovery codes), upload (magic-byte sniff, size caps, AV at all 3 sites, UUID keys → no traversal), input validation (zod at every boundary), rate-limit on the auth surface, headers/error-shape, entropy floor, log redaction.

### Backend correctness / dead code — no High/Med
- **[LOW] BE-COR-1** — Sync cursor advances by `limit` even on an underfilled page (`sync/service.ts:87-97`); page+total from separate queries → device can skip rows if assign/revoke races between them (self-heals next full sync). Fix: advance by `offset + tasks.length`.
- **[LOW] BE-COR-2** — Dead async export-job/queue plumbing kept alive only by tests (`platform/export/job.ts:56`, `platform/jobs/index.ts:33`); MIS/billing exports are sync now. *(Note: the API-load pass recommends the opposite — resurrecting these builders to move exports off the main thread. Decide the direction before deleting.)*
- **[LOW] BE-COR-3** — knip: 20 unused exports + 12 unused exported types (e.g. `COMPLETED_BAND`, `ERROR_CODES`, `setTheme`, `MisDataType`); several are used internally (only the `export` keyword is dead).
- **[INFO]** `apps/worker` + `apps/report-worker` are empty stub packages (echo build/test, no `src/`, no prod worker container) — delete or note in `knip.json`.
- **[INFO]** knip.json config drift (15 hints). Money crosses JSON as `::float8` (exact for realistic INR). No pg `setTypeParser` — relies on the per-query `::int`/`::float8` cast convention (consider a lint gate).
- **Verified clean:** typecheck 8/8, transactions (BEGIN/COMMIT/ROLLBACK/release), Express-5 async error forwarding, uniform `AppError`, zero `console.*`, MIS allow-list, ADR-0083 removal complete, billing/commission SQL, centralized IST bucketing.

### Database — 2 High
- **[HIGH] DB-1** — Unindexed FK `case_tasks.rate_type_id` (`mig 0094`). `case_tasks` is the largest table → seq scan on every rate-type edit/delete + billing joins. `CREATE INDEX idx_case_tasks_rate_type`.
- **[HIGH] DB-2** — Unindexed FK `case_tasks.pincode_id` (`area_id` is indexed, `pincode_id` isn't). Hits location edits + the `eligibleAssignees` pool query. `CREATE INDEX idx_case_tasks_pincode`.
- **[MED] DB-3** — 24 more unindexed FKs; the ones that will grow: `commission_rates.*`, `rates.*`, `rate_type_assignments.*`, `cases.area_id`, `task_assignment_history.assigned_to`. Index those; tiny lookup tables → RATCHET.
- **[MED] DB-4..7** — `audit_log`, `device_locations`, `notifications`, `auth_refresh_tokens` all grow unbounded with no prune/retention (`auth_refresh_tokens` is only soft-revoked, never deleted). Add retention/partitioning; overlaps LOAD-9.
- **[MED] DB-8** — Confirm `case_number_seq` is created `IF NOT EXISTS` (`cases/repository.ts:427` hard-depends on it).
- **[MED] DB-9** — Migration re-run hazard: the checksum-tracked runner re-applies an edited migration, but most `CREATE INDEX`/`ADD CONSTRAINT` lack `IF NOT EXISTS` → editing any historical migration turns the next deploy RED. Standardize the guards (runner header already warns).
- **[LOW]** `geocode_cache`/`import_log`/`task_assignment_history` unbounded (benign); `device_locations.case_id/task_id/requested_by` are `text` not FK/uuid (likely intentional mobile decoupling); case vs applicant `dedupe_decision` NOT-NULL asymmetry.
- **Verified clean:** every timestamp is `timestamptz` (0 naive across 54 tables); all money `numeric` + `CHECK ≥ 0`; enum↔CHECK parity (no drift); cascade vs restrict correct; no fan-out in hot reads (unique-backed 1:1 joins, `LIMIT 1` laterals → exact COUNT/SUM); pagination `LIMIT/OFFSET` everywhere + MIS 413 pre-check; IDOR scope predicates; all code-assumed uniqueness DB-enforced; concurrency collisions → retryable 409 not corruption; migrate.sh crash-safe; rate/commission composite indexes present.

### Frontend — 1 live prod bug
- **[HIGH] FE-1** — **Sonner CSS blocked by CSP → all toasts invisible on prod.** See shortlist #1. Proven: extracted CSS hashes to `sha256-CIxDM...` (match) and `sha256-47DEQ...` (= sha256 of empty string, the pre-fill `<style>`). Fix options ranked: (a) `pnpm patch` + bundle the CSS import [cleanest, CSP stays strict]; (b) add both hashes to `style-src` [re-breaks on any sonner bump]; (c) `'unsafe-inline'` for styles [weakest].
- **[MED] FE-2** — No React error boundary anywhere; any render error white-screens the whole SPA. Add a top-level/per-route boundary with a reload fallback.
- **[MED] FE-3** — Zero code-splitting: 43 routes in one 866 KB (215 KB gzip) bundle; `React.lazy` the heavy route groups. Low urgency.
- **[LOW]** Access token in `localStorage` (XSS-readable, by ADR-0076 design — only refresh moved to httpOnly cookie); `connect-src 'self'` may force socket.io long-polling on old browsers.
- **[INFO]** No blob: workers (script-src breaks nothing else); raw `<table>` uses are legit summary/detail not management lists; boundary compliance clean (single `sdk.ts` transport, no axios, no hardcoded hosts, zero `console.*`, zero `dangerouslySetInnerHTML`); no dead code from removed modules; skeleton/loading standard implemented centrally in DataGrid.

### Cache — clean by design
- **[MED] CACHE-1** — PII JSON responses (and `/auth/login`,`/refresh`) have no `Cache-Control: no-store`, and Express's weak ETag is on → PII/tokens linger in browser disk cache on shared machines after logout. One global `no-store` middleware on `/api` (keep the static-map override) fixes this + folds in the missing `Vary: Authorization`.
- **[LOW]** Static-map PNG cached 24 h survives logout; TanStack default `staleTime:0` + refetch-on-focus can burst toward the nginx 429 ceiling; web perm-gating stale until reload after a role change (server still 403s correctly).
- **Verified clean:** DB-backed idempotency with the 4xx-no-cache contract intact (no in-memory idempotency cache); nginx SPA cache split correct (`assets` immutable, `index.html` no-store) → no stale-deploy risk; no service worker; no nginx proxy caching; role/revocation caches bounded, 5 s TTL, correct kill-switch interplay; geocode frozen by design (ADR-0026); mutation→list invalidation consistent.

### Docker / deploy
- **[HIGH] DOCKER-1** — Deploy gate runs no tests (see shortlist #7).
- **[MED] DOCKER-2** — Rollback is unverified: `... || true` then reports "rolled back" with no second health gate → a failed rollback pull reports success while prod is down. Re-run the health loop after rollback.
- **[MED] DOCKER-3** — Not true blue-green: recreate-in-place with up to 180 s user-visible red window on a bad image. Rename or run real side-by-side colors.
- **[MED] DOCKER-4** — Old code serves against new schema during deploy; rollback never reverts migrations → a non-additive migration breaks the still-running old api and the rolled-back image. Keep additive-only; consider a CI lint rejecting DROP/RENAME on deployed tables.
- **[MED] DOCKER-5** — `minio/minio:latest` + `mc:latest` in prod, `dc pull` every deploy → data-service silently upgraded outside the rollback path. Pin a RELEASE/digest.
- **[MED] DOCKER-15/16** — API image ~2.5 GB. `COPY --chown` reclaims ~0.5 GB free (shortlist #10); prod-deps-only bundle would reach ~1.1-1.3 GB but needs an ADR (tsx-runtime is a frozen decision); chromium (741 MB, needed for PDF) is the floor.
- **[LOW]** `git reset --hard origin/main` even on a pinned-tag rollback; `StrictHostKeyChecking=accept-new`; base images float on tags (no digest pin); edge nginx runs root with no read-only rootfs; **dev compose binds trust-auth Postgres + MinIO to `0.0.0.0`** (LAN gets passwordless superuser — valkey was already fixed to 127.0.0.1); PG version skew (CI tests PG17, prod PG18).
- **Verified clean:** concurrency guard serializes deploys; prune `-af --filter until=72h` present (the 2026-06-26 fix); GHCR pins the SHA; secrets handling minimal + `--password-stdin`; log rotation `20m×10` on all services; healthchecks + resource limits + `no-new-privileges` everywhere; non-root `USER node` verified; web image 76 MB.

### API load-readiness & future-proofing *(no live load test run)*
- **[HIGH] LOAD-1** — No SIGTERM drain (shortlist #4).
- **[HIGH] LOAD-2** — Expensive authenticated endpoints unthrottled (shortlist #8).
- **[HIGH] LOAD-3** — pg pool max=10 shared by requests AND the in-process job tier (prod runs jobs in-process); ~10 concurrent slow queries exhaust it → 5 s wait then 500. Raise `DB_POOL_MAX` and/or move jobs out-of-process.
- **[HIGH] LOAD-4** — Sync exports (billing/commission/cases/dedupe/MIS) buffer the entire result set (up to ~10k rows) and build the whole XLSX/CSV in memory on the main thread → GC/OOM + event-loop block under concurrency. Ship the async export builders (scaffolding exists).
- **[MED] LOAD-5..7** — No `keepAliveTimeout` (nginx keepalive race → sporadic 502s; set 65 s); `field-photos.zip` fetches + sharp-composites every photo in parallel then zips (memory spike; batch/stream); sharp overlay has no concurrency gate (PDF has one — mirror it).
- **[MED] LOAD-8** — `scrypt` (~libuv) + sharp + fs share the default 4-thread libuv pool → a shift-start login stampede contends with photo processing. Set `UV_THREADPOOL_SIZE` (8-16).
- **[MED] LOAD-9** — High-volume tables (`device_locations`, `notifications`, `audit_log`, `task_export_events`, `jobs`) have no retention story (overlaps DB-4..7).
- **[LOW]** `withTransaction` ROLLBACK can throw and mask the original error; in-process jobs not drained on shutdown; lookup/option endpoints return unbounded (but small) arrays; global `express.json()` uses the implicit 100 kb default.
- **[INFO — scale-out blockers, accepted single-instance ADR today]** in-memory rate-limit store, role cache, token-revocation cache, socket.io emitters/rooms, in-process job queue — each already has a coded Valkey/redis swap path gated on an env var. Inventory only; enable before scaling horizontally.
- **Verified clean:** pagination envelope consistent + `MAX_PAGE_SIZE=500`; per-route body caps sane; mobile `/api/v2` additive discipline holds; PDF concurrency gated; statement/idle/connect timeouts set.

### Data-leakage / PII
- **[HIGH] PII-1** — Signed-URL TTL likely too long for PII docs: `signedUrl` uses one global `S3_SIGNED_URL_TTL_S` for KYC PAN/Aadhaar + field photos same as import artifacts; a leaked/logged URL stays fetchable unauthenticated for the full TTL. Verify it's minutes, keep it short for PII paths.
- **[HIGH] PII-2** — `POST /cases/dedupe` cross-scope PII leak (shortlist #2).
- **[MED] PII-3** — Field-photo/attachment download + zip responses lack `Cache-Control: no-store` (folds into CACHE-1) → cached applicant photos recoverable on shared machines.
- **[MED] PII-4** — Commission summary money column `commissionTotal` IS sortable (unlike the MIS non-sortable-money rule) → potential ranking oracle IF scope is applied post-aggregation. Confirm scope is in the WHERE (pre-GROUP BY); consider dropping it from the sort map.
- **[MED] PII-5** — Full request path incl. query string is logged every request; dedupe/search take `?name=`/`?mobile=`/`?pan=` → applicant PII written verbatim to app + nginx access logs. Strip query strings before logging or move lookups to POST bodies.
- **[MED] PII-6** — Logger redaction is credentials-only; PII field names (name/mobile/pan/aadhaar/address/lat/lng) aren't masked (deliberate SEC-11 scope). Extend `SENSITIVE_KEY` or redact at call sites if PII-in-logs matters.
- **[LOW]** `MALWARE_DETECTED` echoes the AV signature name to the uploader; push/socket payload puts task/unit on the lock screen (own-data); `emitToOffice` fan-out sends caseNumber+status to all `page.dashboard` holders regardless of scope (metadata existence/workflow leak, no applicant PII); confirm the field-monitoring export gate isn't bare `data.export`.
- **Verified clean:** MIS money-oracle handling is exemplary (use as the template for PII-4); signed-URL indirection IDOR-safe (scope + case-visibility checked before minting, random keys); socket handshake authz sound (no client-asserted rooms).

### Monitoring / system-health
- **[HIGH] MON-1** — No DB or MinIO backups exist (shortlist #3). Live `/api/health` → 404 (real path is `/api/v2/health`).
- **[HIGH] MON-2** — Health probe is process-up only; the same shallow endpoint gates docker health AND the deploy switch → healthy-but-DB-down is invisible. A deep RBAC-gated probe exists but no infra probe can reach it. Add unauth `?deep=1` → `SELECT 1`.
- **[HIGH] MON-3** — Zero alerting of any kind (no uptime monitor, no disk watchdog, no deploy-failure notify). One external check + a `df` cron.
- **[MED] MON-4** — No `unhandledRejection`/`uncaughtException` handlers, no `pool.on('error')` → a DB blip crashes the process (crash-loop, invisible without alerting). Add handlers → `logger.fatal` → `exit(1)`.
- **[MED] MON-5..8** — 500 handler logs `err.message` only (drops the stack); no metrics (prom-client would give 5xx/p95/pool/disk); no slow-query logging (`log_min_duration_statement`); deploy failure is quiet (no `if: failure()` notify).
- **[MED] MON-9** — Ops docs describe a fictional stack (claim a deep-mode health, PG17, and a `runbooks/` dir that doesn't exist; an "restore PITR" step that's unimplementable). Mark actual state or build the deep probe.
- **[LOW]** Cert-renewal cron is box-only, unverified (script+crontab are in the repo header — rebuild-safe on paper, but nothing checks it renews); `/api/health` (unversioned) 404s any monitor pointed there.
- **Verified clean:** blue-green + auto-rollback + post-deploy smoke; log rotation; `@crm2/logger` (structured JSON, levels, per-request requestId, recursive redaction); request observability middleware; the admin System Health page (`/admin/system`, `page.system`-gated, real DB latency + FCM + counts — just unreachable by infra probes); DB client hardening; edge TLS/CSP/HSTS + real dependency healthchecks; cert-renewal script idempotent.

### Mobile (`crm-mobile-native`) *(static-analysis level; no Android build / runtime pinning run)*
- **[HIGH] MOBILE-1** — Release build falls back to the debug signing keystore if `keystore.properties` is absent (shortlist #9).
- **[MED] MOBILE-2** — Sync watchdog comment says "30s/10min" but code uses 15s/20min (stale comment → mis-tuning risk).
- **[LOW]** `validateVisitStart` returns `allowed:true` when the task has no stored lat/lng and treats a literal `0` coordinate as missing (bypasses the 100 m proximity gate) — use `== null`; SSL pin durability rests on the ISRG root backup (confirm it stays in the served chain each renewal); a couple of diagnostic INFO logs print form field-key names.
- **Verified clean:** SQLCipher key mgmt (256-bit CSPRNG, Keychain `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, false-return guard, corrupt-recovery reset); token storage; SSL pinning both platforms + build-time guard + relaxation-only runtime kill-switch; no hardcoded secrets; cleartext blocked except loopback; only `MainActivity` exported, `allowBackup=false`; 401 single-flight refresh + kill-switch; per-uploader 409 handling (with the documented data-loss fix); idempotency keys on every mutating uploader; the 2026-06-22 stalled-cycle fix still sound; retry/backoff with jitter; orphan-reconcile data-loss recovery; photo atomicity (≥5 + selfie + geo before enqueue, one transaction); two-stage completion (ADR-0047); v2-native contract (ADR-0054); form layer internally consistent (no dup keys, required enforcement); bounded local-DB cleanup; `tsc --noEmit` clean.

---

## Cross-cutting themes

1. **Operations, not code, is the weak flank.** Backups (none), alerting (none), health-depth (none), deploy drain (none) together recreate the entire 2026-06-26 disk-full outage class — cause undetected, outage undetected, and if a volume died, unrecoverable. This is the highest-leverage cluster.
2. **`Cache-Control: no-store` is missing on every PII path** — API JSON, auth responses, and photo/zip downloads. One middleware closes CACHE-1 + PII-3 together.
3. **The worker tier is coded but disabled** (`REDIS_QUEUE_URL` unset). Enabling it resolves the export-memory (LOAD-4), PDF-in-process (LOAD-partial), pool-contention (LOAD-3), and retention-job-home (DB-4..7 / LOAD-9) findings at once. Note the direction conflict with BE-COR-2 (which flags the same builders as dead) — decide enable-vs-delete first.
4. **Unbounded table growth** is flagged by both DB and load passes (`device_locations`, `notifications`, `audit_log`, `auth_refresh_tokens`) — the data-side rerun of the disk outage.
5. **Docs describe a system that doesn't exist** (DR backups, deep health, PG version, `runbooks/`) — dangerous during an incident. Reconcile docs with reality.

## Caveats
- **No live load/perf test** — all load findings are static; real numbers need owner approval + a target env.
- Coverage was breadth-first: BE-correctness SQL-vs-migration and async sweeps were targeted spot-checks on the newest modules, not exhaustive over ~40 modules; mobile was static-only; a few PII call sites (field-monitoring route gate, caseReports render scope) were flagged-not-fully-read.
- Local dev DB is at migration 0107; 0108/0109 are on disk but not applied locally — dropped-table findings reflect pre-0108 and 0108 removes them cleanly.
- **Next step per governance:** disposition each finding (FIXED / DEFERRED / RATCHET / WONTFIX) in `docs/COMPLIANCE_GAPS_REGISTRY.md`. No dispositions were made in this pass.
