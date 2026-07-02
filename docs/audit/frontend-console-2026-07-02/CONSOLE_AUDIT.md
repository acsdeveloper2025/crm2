# Frontend console/network audit — 2026-07-02

**Mission:** every web page × role × action → capture browser console + network → FIX every real finding.
**Method:** reproduce on LIVE remote first (`crm.allcheckservices.com`), fix in codebase, verify locally + post-deploy. No guessing.
**Definition of done (per page):** zero console errors/warnings and no bad network calls on normal flows.

HEAD at start: `905f004` · next mig=0112 · next ADR=0086.

---

## 1 — Coverage matrix (page × role)

Routes are NOT route-guarded in `App.tsx` — any authenticated user can hit any URL; the API enforces RBAC.
So each page must also be audited in its **permission-denied** state (does it render a clean 403, or throw/console-error?).

Roles: **SA**=SUPER_ADMIN (grantsAll) · **MGR**=MANAGER · **TL**=TEAM_LEADER · **BE**=BACKEND_USER · **KYC**=KYC_VERIFIER · **FA**=FIELD_AGENT (mobile-only, no web page.* perms).
`✓` = nav-visible / intended user · `·` = not nav-visible (audit the denied state) · `—` = N/A.

| Route | Gating perm | SA | MGR | TL | BE | KYC | FA |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `/dashboard` (ops variant) | page.dashboard | ✓ | ✓ | ✓ | ✓ | — | · |
| `/dashboard` (KYC variant) | kyc_tasks.view && !page.operations | — | — | — | — | ✓ | — |
| `/pipeline` | page.operations | ✓ | ✓ | ✓ | ✓ | · | · |
| `/cases` | page.operations | ✓ | ✓ | ✓ | ✓ | · | · |
| `/cases/new` | case.create | ✓ | ✓ | ✓ | ✓ | · | · |
| `/cases/:id` (detail) | case.view | ✓ | ✓ | ✓ | ✓ | · (403, mig 0111) | ✓ scoped |
| `/kyc-queue` | kyc_tasks.view | ✓ | · | · | · | ✓ | · |
| `/dedupe` | dedupe.view | ✓ | ✓ | ✓ | ✓ | · | · |
| `/billing` | billing.view | ✓ | ✓ | · | ✓ | · | · |
| `/billing/commission-summary` | billing.commission_summary.view | ✓ | ✓ | · | ✓ | · | · |
| `/mis` | mis.view | ✓ | ✓ | ✓ | ✓ | · | · |
| `/field-monitoring` | page.field_monitoring | ✓ | ✓ | ✓ | · | · | · |
| `/profile` | (any authed) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/security` | (any authed) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/admin/verification-units` (+`/new`,`/:id`) | page.masterdata | ✓ | ✓ | ✓ | ✓ | · | · |
| `/admin/clients` | page.masterdata | ✓ | ✓ | ✓ | ✓ | · | · |
| `/admin/products` | page.masterdata | ✓ | ✓ | ✓ | ✓ | · | · |
| `/admin/cpv` | page.masterdata | ✓ | ✓ | ✓ | ✓ | · | · |
| `/admin/rates` (+`/new`,`/:id`) | page.masterdata | ✓ | ✓ | ✓ | ✓ | · | · |
| `/admin/rate-types` | page.masterdata | ✓ | ✓ | ✓ | ✓ | · | · |
| `/admin/rate-type-assignments` (+`/new`,`/:id`) | page.masterdata | ✓ | ✓ | ✓ | ✓ | · | · |
| `/admin/commission-rates` (+`/new`,`/:id`) | masterdata.manage | ✓ | · | · | · | · | · |
| `/admin/locations` | page.masterdata | ✓ | ✓ | ✓ | ✓ | · | · |
| `/admin/users` (+`/new`,`/:id`) | page.users | ✓ | · | · | · | · | · |
| `/admin/departments` | page.users | ✓ | · | · | · | · | · |
| `/admin/designations` | page.users | ✓ | · | · | · | · | · |
| `/admin/rbac` (+`/new`,`/:code`) | page.access | ✓ | · | · | · | · | · |
| `/admin/policies` (+`/new`,`/:id`) | page.policies | ✓ | · | · | · | · | · |
| `/admin/system` | page.system | ✓ | · | · | · | · | · |

**Priority order (by surface × traffic):** dashboard → cases/list → cases/detail → cases/new → pipeline → kyc-queue → mis → billing (×2) → dedupe → field-monitoring → the master-data admin lists (share the DataGrid + MasterDataCrud, so cluster them) → users/depts/designations → rbac/policies/system → profile/security.

## 2 — Per-page action checklist (run each, capture console+network after each)

- Initial load (route mount) + hard reload.
- Every dialog: open + close + submit-empty (validation) + submit-valid.
- DataGrid: global search, column header filter, multi-column filter, server sort, pagination, column visibility picker, **export CSV**, **export XLSX**, row-select, bulk action, saved views (where present).
- Tabs / sub-sections; row-click → detail; file uploads (attachments).
- Success toast + error toast paths (F-001 gates visibility on prod).
- States: empty, loading, error, permission-denied.
- Responsive: 375 / 768 / 1024 (+ dark mode).

## 3 — Triage rules

**FIX:** uncaught JS errors, unhandled promise rejections, React warnings (key, hooks-order, setState-on-unmounted, controlled↔uncontrolled, invalid DOM nesting, deprecations), **CSP violations**, 4xx/5xx on normal flows, missing assets, a11y warnings.
**TRIAGE OUT:** browser-extension noise, expected 401→refresh cycle, Vite HMR logs, intentional 403/404 that render a clean permission state.
Every finding → FIXED / DEFERRED / WONTFIX with a reason (also logged in `docs/COMPLIANCE_GAPS_REGISTRY.md`).

---

## 4 — Coverage completed (local pass, 2026-07-02)

**Stack:** api `:4000` (bg) + web `:5273` (vite) vs `crm2_dev`. Auth = seed `admin/admin123` (SUPER_ADMIN); KYC via admin-minted temp password for `bv_kyc_1782468680`.

- **Load pass — SUPER_ADMIN, all 29 routes:** console **100% clean** (zero warnings/errors). Only failed network call anywhere = F-002 (photo-url 404, global header).
- **Interaction pass — SUPER_ADMIN:** header (theme toggle→dark, jobs/notif/account menus), DataGrid (columns picker, server sort, Export menu XLSX/CSV, Excel multi-select header filter), inline-grid add/edit (clients), record-page forms (VU new — 8 fields), inline case forms (+Add Tasks, applicants), task filter chips, case-detail — **all clean**.
- **Role pass — KYC_VERIFIER:** distinct KYC dashboard ✓, `/kyc-queue` ✓, nav locked to Dashboard+KYC ✓; denied `/cases` + `/mis` render clean "no access" ✓. All console-clean. Surfaced F-003 + F-004.
- **Not covered locally:** F-001 (prod-only, no local CSP); deep form *submissions*; MGR/TL/BE roles (perms ⊂ SA, already-clean pages; no new finding types); responsive 375/768; FIELD_AGENT (mobile-only — would also hit F-003, covered by the fix). → the **remote pass** (extension) covers F-001 + prod-config + post-deploy confirmation.

## 5 — Findings ledger

| ID | Page(s) | Sev | Symptom | Root cause | Fix | Status |
|---|---|---|---|---|---|---|
| F-001 | ALL (toasts) | High | Toasts invisible/unstyled on prod (`Refused to apply inline style … "style-src 'self'"`) | `infra/prod/nginx.conf:81,143,155` CSP `style-src 'self'` has no `'unsafe-inline'`; Sonner injects a runtime `<style data-sonner-toaster>` (confirmed in DOM). **Live prod CSP curl-confirmed** = `style-src 'self'` (no unsafe-inline). Blast radius = **Sonner only** — it's the sole CSS-in-JS dep; app CSS ships as `<link>` (allowed), React `style={{}}`=CSSOM (not blocked) | `style-src 'self' 'unsafe-inline'` — script-src stays strict `'self'` (style-src can't execute JS). nonce/hash impractical for static-nginx+Sonner | **FIXED — applied to all 3 headers. Confirmed on live prod via curl (no login needed). Loosens the ADR-0082 CSP (style-src only) → needs owner deploy OK. Not pushed** |
| F-002 | ALL (header avatar) | Low | `GET /users/me/photo-url → 404` once per page | `service.ts:453` returns 404 for the no-photo state (existence-check pattern) | — | **WONTFIX** — by-design: `UserMenu:44` + `UserPhoto:50` both catch 404→null (no console error, initials fallback); mobile uploads/reads via this endpoint → changing it risks mobile for zero benefit |
| F-003 | ALL pages, KYC_VERIFIER & FIELD_AGENT | Med | `/clients/options` + `/products/options → 403` retry-storm (6–10×) on **every** page | `ActiveSelectionSelector` (global header) fired both `useQuery`s unconditionally; endpoints require `page.masterdata`, which KYC/FIELD lack | gated both + `clientProducts` on `enabled: has('page.masterdata')` (`ActiveSelectionSelector.tsx`) | **FIXED + verified local** (KYC: 0 calls; SA: still 2, selector works). typecheck+lint+format green. **Not pushed** |
| F-004 | `/admin/*` (29 routes) | Low | Unauthorised role (e.g. KYC→`/admin/users`) rendered full page **chrome** + fired `users`/`roles/options` 403s, instead of the clean "no access" state ops pages show | admin routes had no page-level permission guard (relied on API 403 for data) | new `RequirePerm` wrapper in `App.tsx` on all 29 `/admin/*` routes (perm mirrors `Layout.tsx`); blocks mount ⇒ no page + no forbidden queries | **FIXED + verified local** (KYC `/admin/users`+`/admin/rates`: "no access", 0 forbidden calls; SA pages still render). typecheck+lint+format green. **Not pushed** |
