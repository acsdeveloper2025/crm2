# CRM2 v2 — Open Items Register (snapshot 2026-06-17)

**Point-in-time inventory** of everything still open in CRM2 v2, split into **Pending · Deferred · Future-decision**. Generated via [`docs/prompts/list-open-decisions.md`](../prompts/list-open-decisions.md) (two read-only passes — repo registries + Claude memory — reconciled registry-over-memory).

- **HEAD at snapshot:** `531d0ff` — *chore(deps): upgrade React 18 → 19 + react-router-dom 6 → 7*
- **Living source of truth:** [`docs/COMPLIANCE_GAPS_REGISTRY.md`](../COMPLIANCE_GAPS_REGISTRY.md). **This file is a derived snapshot** — when an item moves, update the registry (and the relevant ADR), not this dated file.
- **Caveats:** `CRM2_MASTER_MEMORY.md §8` lags HEAD, so the registry + ADR statuses win. Items tagged **⚠️** are asserted-only — verify against live code before scheduling. V1 (`CRM-APP-MONOREPO-PROD`) items are excluded. **~54 distinct open items** (≈25 pending · ≈21 deferred · ≈8 decisions).

---

## 🔝 Needs a decision NOW (highest-leverage / blocking)
1. **Cases-list row-level scope** — IDOR-class security gap that explicitly **blocks** the lifecycle work (`ADR-0032:61`). Fix first.
2. **ADR-0032 lifecycle sign-off** — still *Proposed*; supersedes the foundational "task = unit of record / FE ≠ backend result" invariant and gates Workspace → Reports → Billing.
3. **Verification Workspace + FE `useFeatureFlag` infra** — declared keystone NEXT; **re-scope first** (much shipped piecemeal as Lifecycle/MIS/Report slices).
4. **Flip "Proposed-but-shipped" ADRs** (0041 slices 1–4, 0023) to Accepted, and **decide the KYC report input model** (ADR-0038: keyed-fields vs source-derived).
5. **Immutable-key correction policy** for CPV/rates composites — owner choice; "edit-in-place" needs a superseding ADR to ADR-0001.
6. **cases/case_tasks OCC retrofit** (C-10 residual) — mobile status-writers must bump `version` or risk silent overwrites.
7. **report-worker** (stub-only) — unblocks ≥10k export jobs, async reports, determinate loaders.
8. **audit_log production hardening** (hash-chain / partition / off-DB) — compliance prerequisite for GA.

---

## 1 — PENDING (committed work, not finished)

| Item (area) | Source | Status / next | Conf |
|---|---|---|---|
| **FE dep-upgrade cluster** — vite 5→6, vitest 2→4, **Tailwind 3→4** (CSS-first; browser-validate @4 viewports) [FE/deps] | `CRM2_DEP_UPGRADE_PROMPT.md` | React 19 + router 7 landed (HEAD `531d0ff`); vite/vitest/Tailwind remain (Tailwind last) | verified |
| **Verification Workspace** + FE feature-flag infra [FE/API] | `MASTER_MEMORY:200,217`; ADR-0015 | Keystone; re-scope what's left | ⚠️ |
| **Billing & commission = EXPORT-ONLY (mostly DONE)** — read-model + Excel/CSV export shipped (`/billing` `/cases`·`/cases/:id/tasks`·`/breakdown`·`/export` + MIS export). **invoice + GST + commission-payout = WONTFIX** (owner 2026-06-25: CRM2 never invoices/GST/pays — invoicing is external/Tally, commission is exported & paid outside the CRM). Optional-only leftovers: billed-marker + double-bill guard + a case-detail financial-summary card | `ADR-0036:4` (descope) | 5a config + read-model + export shipped; invoice/GST/payout removed from backlog | verified |
| **MIS Layout 2–6** — Designer FE, office data-entry (`case_data_entries`), MIS gen (`v_mis_rows`), real bank format + immutable-once-used [FE/API/DB] | `ADR-0037:55-58` | Schema slice 1 done | verified |
| **CASE_REPORT slice 5** — Xlsx renderer (exceljs + formula-injection guard) [API] | `ADR-0041:126` | Slices 1–4 done | verified |
| **KYC desk B2–B4** — finalize endpoint + field-review leg + `/sync/download` OFFICE-exclusion + outcome wiring [API/Mobile] | `ADR-0025:3,48-51` | B1 done | verified |
| **KYC report auto-gen epic** (engine is field-only today) [API] | `ADR-0039`; `template_report_engine:36` | Later epic, no schema change | verified |
| **Mobile rebase** `/api/mobile`→`/api/v2` (separate repo + Android release) — unblocks live GPS, roster repaint, auth rebase, clock-offset client [Mobile] | `DEFERRED_ITEMS:337`; `operations_phase:615` | Gates field-monitoring + dashboard tiles | verified |
| **report-worker / worker** (stubs) + health endpoint + SIGTERM drain [Infra/Ops] | `MASTER_MEMORY:184` | Unblocks export jobs/reports/loaders | verified |
| **cases/case_tasks edit-path OCC** + mobile writers bump `version` (TOCTOU) [DB/API] | `COMPLIANCE:98,502`; `operations_phase:72` | `case_tasks.version` partly added (mig 0036) | verified |
| **Universal export tail** — ops cases export · PDF · ≥10k streaming job; roll async provider to the other ~13 lists [FE/API] | `COMPLIANCE B-13`; `operations_phase:667` | 7 admin lists + Pipeline done | verified |
| **Field-photo reverse-geocode A & B** — resolver + on-view write-through; async-on-upload queue+worker [API/Ops] | `ADR-0040:70` | Schema in place | verified |
| **FCM push phase 2** — wire push + **prod activation** (drop service-account JSON, set `FIREBASE_SERVICE_ACCOUNT_PATH`) [Mobile/Infra] | `ADR-0027:76`; `DEFERRED_ITEMS:338` | Phase 1 (in-app+socket) done | verified |
| **Field-monitoring mobile side** — request-location ping, live map, ws producer [Mobile/FE] | `ADR-0026:59` | Server seam ready | verified |
| **Dashboard tiles** — recent-activity, revisit/recheck counts, field idle/active (no truthful producer yet) [FE/API] | `ADR-0029:63` | Wire when producer exists | verified |
| **Responsive C-9 residual** — activate Playwright viewport CI gates 49–50 vs booted stack [UX/Ops] | `COMPLIANCE:399`; `RESPONSIVE:68` | 49/49 local green | verified |
| **OpenAPI phase 2** — responses→zod single-source + generated SDK + drift gate [API/Ops] | `COMPLIANCE B-11/12`; `ADR-0031:71` | Phase 1 shipped | verified |
| **Org rename** `acsdeveloper2025` (still has "acs") — manual GitHub org rename [Ops] | `crm2_v2_deploy:12` | User-only; image ns auto-follows | verified |
| **Notification producers** — wire REASSIGNED/TASK_REVOKED/SFR/CASE_ASSIGNED/SYSTEM (2 of ~6 wired) [API] | `DEFERRED_ITEMS:342` | Per-flow | verified |
| **Case hard-delete/purge** honoring the assignment-history immutability trigger [Cases/DB] | `operations_phase:73` | No purge endpoint exists | verified |
| **Saved-views polish** — delete confirm/undo; 23505 discrimination [FE] | `COMPLIANCE B-5` | Core shipped | verified |
| **DataGrid bulk IDOR guard** — scope in per-row apply before bulk hits cases/tasks; retry UX; bulk Playwright [API/FE/Sec] | `COMPLIANCE:197` | From Slice 10 | verified |
| **Mobile nav-drawer focus-trap** + axe dialog scan [UX/FE] | `COMPLIANCE:210` | `useFocusTrap` exists | verified |
| **Coverage ratchet E-1..E-4** toward 90/85 [Ops] | `COMPLIANCE:310` | Floors enforced | verified |
| **Tech-debt register** — file still-open items as GH issues [Governance] | `TECH_DEBT_POLICY:49` | Several already moved | ⚠️ |

---

## 2 — DEFERRED (postponed; un-defer trigger)

| Item (area) | Source | Un-defer trigger | Conf |
|---|---|---|---|
| **Import engine per-domain wiring + polish** (error-file artifact, PII cleanup-on-failure, idempotency) [API] | `operations_phase:663` vs `COMPLIANCE B-14` | Registry/memory disagree on engine state — **verify** | ⚠️ |
| **audit_log hardening** — hash-chain + monthly partition + off-DB [DB/Sec] | `COMPLIANCE:505` | Production hardening | verified |
| **Infra hardening** — Valkey split+HA+AUTH (socket/BullMQ), DB backup/PITR/DR, scope-cache, object-store HA+CDN, partition automation [Infra] | `MASTER_MEMORY:221`; `DEFERRED_ITEMS:339` | Before production | verified |
| **Object-storage credentials** provisioning [Infra] | `ADR-0021:64` | Storage account provisioned | verified |
| **DPDP retention/TTL purge** of report artifacts (`case-reports/{userId}/`) [Compliance] | `operations_phase:739`; `ADR-0041:146` | Erasure/retention policy built | verified |
| **Notification prefs/mute/quiet-hours** (endpoints reserved) [Notif] | `DEFERRED_ITEMS:340` | Product wants per-type muting | verified |
| **Notifications retention purge job** (append-only, unbounded) [Notif] | `DEFERRED_ITEMS:341` | Worker exists | verified |
| **iOS APNs push** (firebase-admin = Android only) [Mobile] | `DEFERRED_ITEMS:343` | iOS distribution real | verified |
| **Worker observability metrics** (render duration / pool wait / mem) [Reliability] | `operations_phase:739`; `ADR-0041:84` | Observability tier built | verified |
| **ADR-0023 dispatch-fields impl** + `mv_` sync projection [API/DB] | `ADR-0023:3,67` | Scheduled / sync perf pressure | verified |
| **`/api/external/v1`** partner API [API] | `ADR-0011:24` | A real external consumer exists | verified |
| **PostgreSQL 18** upgrade [DB] | `ADR-0003:20` | PG18 managed GA | verified |
| **Package extraction** (DataGrid/import/export → packages) [Governance] | `PLATFORM_CAPABILITIES:5` | Only via ACR+ADR | verified |
| **Determinate-% Hexagon loader** path [FE] | `COMPLIANCE B-9` | Staged worker jobs land | verified |
| **Background-job tray UX** (≥8s bands) — reconcile w/ shipped JobsTray [FE] | `COMPLIANCE B-7` | Exports/worker phase | verified |
| **Perf RATCHETs** — export-sort `(col,id)` indexes, trigram GIN on new large tables, small-table indexes @GA, RateMgmt/users typeahead+pagination at scale [DB/Perf] | `COMPLIANCE:217,251,274,289` | Table size / `all`-export rollout | verified |
| **Refresh-token revoke on password change** [Security] | `COMPLIANCE B-15` | Short TTL mitigates now | verified |
| **Future-dated 3-state status rendering** [FE] | `ADR-0017:10` | First real future-dated consumer | verified |
| **Key-value settings store** (System) [API] | `MASTER_MEMORY:191` | A settings requirement is specified | verified |
| **KYC RECHECK distinct-origin / KYC rate table** [DB] | `ADR-0033:99` | A KYC rate table exists | verified |
| **CASE_REPORT minor carries** — Word "Starting…" feedback, defensive `format` default, negative-perm 403 test [UX/tests] | `operations_phase:737` | Cheap follow-ups | verified |

---

## 3 — FUTURE IMPLEMENTATION DECISIONS (need a decision + ADR / sign-off)

| Item (area) | Source | Decision needed | Conf |
|---|---|---|---|
| **Cases-list row-level scope** [Security] | `ADR-0032:61` | Close the IDOR gap — **blocks lifecycle slice 1** | verified |
| **ADR-0032 lifecycle** (two-track completion / single-layer result / case verdict) [API/DB/Mobile] | `ADR-0032:3` | *Proposed* — supersedes a core invariant; needs sign-off + mobile coordination | verified |
| **ADR-0038 report engine** build approval + **KYC input model** (keyed vs source-derived) + KYC template set [API] | `ADR-0038:28`; `template_report_engine:36` | *Proposed*; KYC input model unresolved | verified |
| **Reconcile Proposed-but-shipped ADRs** — flip 0041 (1–4 shipped) & 0023 (owner-approved) to Accepted [Governance] | `ADR-0041:3`; `ADR-0023:3` | Doc-vs-code drift | verified |
| **Immutable-key correction policy** (CPV/rates composites) [DB/Gov] | `COMPLIANCE:173` | Competing w/ LOCKED ADR-0001 → owner picks; "edit" needs superseding ADR | verified |
| **EXPAND-no-assignment `/options` semantic** — unassigned BACKEND_USER sees full catalog [RBAC/Sec] | `operations_phase:~292` | Deliberate; flagged for security review | verified |
| **Effective-From platform-wide rollout** (ADR-0017) — owner chose "everywhere"; only rates slice built [Master-data] | `acs_crm_v2_build:232` | How far to roll | ⚠️ |
| **Doc-layout freeze reconciliation** — root docs moved to `docs/` ad-hoc [Governance] | `crm2_v2_deploy:14` | The new *File & document placement* standard (`docs/governance/AGENT_RULES.md`) now codifies this — confirm it supersedes any stale freeze | verified |

---

## ✅ Likely already done — verify & drop
Editable RBAC / **Access-Control 2.0** (shipped `f5f1409`) · dashboard + profile commit pushes (already pushed) · assignment-pool mig 0039 (likely applied) · KYC B1/B2 sequencing questions (moot — B1/B2 shipped) · **TS6 + Express5 + React19/router7** dep clusters (done/pushed).

---

## Coverage & method
- **Read in full:** `COMPLIANCE_GAPS_REGISTRY` (both pages), `MASTER_MEMORY §8–9`, `FROZEN_DECISIONS_REGISTRY` (34 rows; only #29 superseded, migration complete), all 41 ADR statuses, `TECH_DEBT_POLICY`, `ARCHITECTURE_CHANGE_REQUEST` (template only — **0 ACRs filed**), the 5 standard docs, plus `DEFERRED_ITEMS.md §22` + the v2 `project_acs_v2_*` memory tails.
- `grep CRM2-#### / TODO / FIXME` → **0 hits** (banned-marker policy; absence ≠ no debt).
- **No v2 Security / Architecture / Performance audit has been run yet** (`COMPLIANCE:508`) — undiscovered debt in those dimensions is structurally possible and not represented here.
