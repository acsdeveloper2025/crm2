# UPPERCASE / capital-letter consistency audit — 2026-07-03

**Scope:** every user-facing text field across the whole frontend — every page × form/dialog/inline-grid/record-page input, every Excel/CSV import & export column, and the display CSS — in **both** directions:
- **Direction A** — text that SHOULD be UPPERCASE (ADR-0058 display text) but is stored/shown mixed-case.
- **Direction B** — text that must NOT be uppercased (emails, passwords, usernames, tokens/secrets, URLs, file/object keys, codes, UUIDs, phones, JSON/template blobs) but is.

**Governing decision:** [ADR-0058](../../adr/ADR-0058-input-uppercase-store-not-just-display.md) (auto-uppercase typed input, store not just display) — **FROZEN, enforce don't redesign.** Changing the exclusion set or "should long prose be uppercase" is a product/UX call → surfaced to the owner below (§6). Mobile field-report jsonb stays verbatim (ADR-0054).

**Method:** 6 parallel read-only reader agents (per `BUILD_METHOD`) — SDK schemas · import path · export/PDF · web bare-inputs+display-leaks · CSS/tokens · the `shouldUppercaseInput` predicate — each returning a field-matrix slice + candidate gaps; merged/deduped here; high-risk Direction-B items adversarially re-checked and **reproduced with real API round-trips incl. a real CSV import** (§7).

---

## 1 — VERDICT

**The ADR-0058 mechanism is very well implemented. Zero live Direction-B violations. No CRITICAL/HIGH findings.** This matches the [frontend-console audit](../frontend-console-2026-07-02/CONSOLE_AUDIT.md) finding that the app is "exceptionally clean."

| | count | severity spread |
|---|---|---|
| Direction-A gaps (should-upper, isn't) | 5 | 1 LOW real-fix · 4 INFO/latent/no-backfill |
| Direction-B violations (must-not-upper, is) | **0 live** | 3 LOW **latent/footgun** (no live corruption) |
| Owner-decisions (product/UX — prose casing / exclusion-set) | 4 | — |

The single substantive item is an **owner-decision** (OD-1: casing of free-text remark/reason prose), not a bug. Everything else is a small hardening/consistency pass.

---

## 2 — The mechanism (3 layers), verified against current code

| layer | file | what it does | verbatim carve-outs |
|---|---|---|---|
| **Display (CSS)** | `packages/ui-theme/src/tokens.css:221-258`, `apps/web/src/index.css` | `text-transform:uppercase` on `body` + `button,select,option,input,textarea` | 13 case-sensitive input types (email/password/url/tel/number/date/time/datetime-local/month/week/file/color/range), `.case-sensitive`, `code/pre/kbd/samp/.font-mono`, `[contenteditable='true']`, external links `a[href^=http\|mailto:\|tel:]` |
| **Client (write-time)** | `apps/web/src/components/ui/Input.tsx:22`, `TextArea.tsx:16` → `apps/web/src/lib/uppercase.ts` | `<Input>`/`<TextArea>` uppercase the typed value on-change via `shouldUppercaseInput(type,name,explicit,id)` and tag excluded fields `.case-sensitive`. A **bare** `<input>`/`<textarea>` does NOT uppercase. | `CASE_SENSITIVE_TYPES` + `CASE_SENSITIVE_NAME_TOKENS` (email,mail,password,pwd,passwd,username,url,link,website,domain,token,jwt,secret,apikey,otp,pin,mfa,filename,filepath,path) + explicit `uppercase={false}` |
| **Server (safety net)** | `packages/sdk/src/text.ts:15` `toUpper` | create/update/import zod **display-text** fields append `.transform(toUpper)` → any client (web/mobile/direct-API) stores UPPERCASE | never on UPPER_SNAKE codes, enums, IDs/UUIDs, phones, emails, usernames, passwords, urls/paths, content/template/JSON blobs |

**Key structural fact (from the predicate slice):** no web `<Input>`/`<TextArea>` passes a static/dynamic `name=` prop (no react-hook-form, no `{...register}`), so the predicate's `CASE_SENSITIVE_NAME_TOKENS` branch is **effectively dormant on the web** — web protection rests on `type` + explicit `uppercase={false}` (+ a few `id=` values). The token list is the **server/mobile** safety net. This is why Direction-B is safe today *and* why the predicate's phone blind-spot (UB-1) is latent rather than live.

---

## 3 — Field-level matrix (coverage by layer/module)

### 3a — SDK create/update/import schemas (server net) — every write module audited

`toUpper` present + correct on all genuine display-text fields; **no exclusion-set field wrongly carries it** (no Direction-B).

| module | display-text fields → `.transform(toUpper)`? | exclusions (correctly NOT transformed) | verdict |
|---|---|---|---|
| clients | name ✓ | code (UPPER_SNAKE) | OK |
| products | name ✓ | code | OK |
| departments | name ✓, description ✓ | — | OK |
| designations | name ✓, description ✓ | departmentName (FK→id) | OK |
| locations | area ✓, city ✓, state ✓, country ✓ | pincode | OK |
| users | name ✓ | username, **email**, phone, role, password | OK |
| roles | name ✓, description ✓ | code, reportsToRole, permissions[], dimension, mode | OK |
| policies | name ✓, description ✓ | **content** (markdown blob), code | OK |
| verificationUnit | name ✓, description ✓, category ✓ | code, requiredFormCode, enums, **resultSet[]** (see UA→OD-2) | OK* |
| rateTypes | name ✓, description ✓, code ✓(harmless — code is upper by spec) | — | OK |
| commissionRates | fieldRateType ✓(catalog code) | userId, currency | OK |
| cases | applicant.name ✓, companyName ✓, address ✓, trigger ✓, dedupeRationale ✓, documentHolderName ✓, documentNumber ✓, documentDetails k/v ✓ | mobile/pan/backendContact (phone/PAN), enums, ids, **remark/reason** (see OD-1) | OK* |
| notifications | — | pushToken, deviceId, platform(enum), preferences(blob) | OK |
| **tatPolicies** | **label ✗ MISSING** | tatHours(number) | **UA-1** |
| rates | clientRateType ✗ (but resolved to FK via `UPPER()` — see UA-2) | currency, codes | OK (UA-2 info) |
| savedViews | name ✗ (private label — see OD-3) | resourceKey, state(blob) | OD-3 |
| system, access, kycTasks, reportLayouts, caseReports, billing, mis, forms, bulk, import, consents, dashboard, jobs, geocode, fieldMonitoring, reference | read-only / type-only / no display-text write schema | — | OK |

### 3b — Web client (all 42 bare `<input>`/`<textarea>` classified)

Every **reachable** user-typed display-text field already routes through `<Input>`/`<TextArea>`. All 42 bare occurrences are **LEGIT opt-outs**: DataGrid search + column filters, `type=checkbox/date/number/file`, search boxes, `<datalist>` numeric pincode, the `<Input>`/`<TextArea>` wrapper source, a disabled display-only field. All JS `.toUpperCase()` calls are on codes/PAN/HTTP-method/avatar-initials/format-literals (no email/url/token). Clipboard secrets (TOTP, recovery codes, one-time password) render in `.font-mono` → verbatim/copyable. **Only exception:** `UserAccessSection.tsx:304` (see UA-3, dead branch).

### 3c — Import (11 importers) & export/PDF — CLEAN

- **Import:** all 11 importers (clients, products, departments, designations, locations, verificationUnits, users, commissionRates, cpv, rateTypeAssignments, rates) validate display-text columns **through the SDK Create-schema** (directly as `spec.schema`, or via a `service.create()` re-parse), so `.transform(toUpper)` fires. Code/FK columns resolve to ids case-insensitively (`WHERE code = UPPER($n)` / `.toUpperCase()` lookups). **No raw INSERT bypasses the transform.** No case/task bulk-import writer exists (ADR-0059 = doc only, zero code). **0 Direction-A gaps, 0 Direction-B.**
- **Export/PDF/docx:** the platform applies **zero case transforms**; cells + filenames pass through verbatim. Every cell is a stored DB value (normalized-on-write) or a computed rollup. Filenames, presigned URLs, PAN, phones, codes never uppercased. The only force-uppercase in the PDF path is CSS `text-transform` on structural chrome (section headers / fixed key-labels), touching no data value. **0 violations** (see UA-4/UA-5 for two INFO items).

### 3d — CSS carve-out coverage

All 13 case-sensitive *rendering* input types are carved out (`tokens.css:236-248`); `code/.font-mono/.case-sensitive` + external links verbatim; the two highest-value Direction-B surfaces (clipboard secrets, copyable IDs) are safe. Two latent footguns → UB-2, UB-3.

---

## 4 — Direction A findings (should be UPPERCASE, isn't)

| id | sev | field | file:line | root cause | disposition |
|---|---|---|---|---|---|
| **UA-1** | LOW | `tatPolicies.label` (create+revise) | `packages/sdk/src/tatPolicies.ts:35,42` | missing `.transform(toUpper)` (+ no `.trim()`); whole module has zero `toUpper`. No web CRUD today (read-only consumers), but the create/revise **API contract exists** → a direct-API/seed write stores mixed-case. Labels ("4 Hours") are short display labels, not prose. | **FIX** (Cluster 1) |
| **UA-2** | INFO | `rates.clientRateType` | sdk `rates.ts:61`; api `rates/repository.ts:130,182` | SDK field has no transform, but both interactive create & revise resolve the code → `rate_types.id` via `WHERE code = UPPER($5)` (ADR-0068); the **string is never stored as display text**. Not a storage bug. | **FIX (optional/tidy)** — add `.transform(toUpper)` for contract honesty, or WONTFIX. |
| **UA-3** | LOW (latent) | `UserAccessSection.tsx:304` ValuePicker bare `<input>` | web | bare input for a **VALUE-kind** scope grant → no write-time uppercase. Branch is **dead**: CITY/STATE VALUE dims were removed from the scope catalog (ADR-0072); value is server-validated vs the locations catalog. | **DEFER** — swap to `<Input>` only if a VALUE-kind dimension is ever re-added. |
| **UA-4** | LOW | legacy pre-ADR-0058 rows in exports/PDF | export/pdf surfaces | exports have no CSS layer, so a display-text cell written **before** the store-uppercase transform shows mixed-case. | **WONTFIX** (ADR-0058 §6 = no backfill). One-time `UPDATE` remedy documented if ever mandated. |
| **UA-5** | INFO | MIS export filename slug `mis-task_operational` | `mis/controller.ts:57` | `type.toLowerCase()` on a **code-owned report-type enum** for the filename — cosmetic, not a user value or external identifier. | **WONTFIX**. |

---

## 5 — Direction B findings (must NOT be uppercased, is) — **0 live; 3 latent/footgun**

| id | sev | area | file:line | finding | disposition |
|---|---|---|---|---|---|
| **UB-1** | LOW (latent) | predicate phone blind-spot | `apps/web/src/lib/uppercase.ts:40-61` | `CASE_SENSITIVE_NAME_TOKENS` has **no phone/mobile/tel** token → a TEXT-typed phone field named `phone`/`mobile` would be uppercased. **Harmless today**: every real phone `<Input>` sets `uppercase={false}` and values are digit-filtered. A future phone input added without the opt-out would silently uppercase. | **TESTS now** (pin behavior) + **OD-4** (owner: add phone tokens?) |
| **UB-2** | LOW (footgun) | CSS `.font-mono` vs Tailwind `.uppercase` | `tokens.css:254` (`@layer base`) vs `.uppercase` (`@layer utilities`) | cascade-layer order `base < utilities` means the `.uppercase` utility **always defeats** the `.font-mono` verbatim carve-out. Today it only co-occurs on **already-uppercase rate-type enum codes** (CommissionRateRecordPage:480, RateRecordPage:445, RateTypeAssignmentRecordPage:285, AddTasksForm:705/708, CaseDetailPage:1063/1066) → **no live corruption**. Risk: a future dev adds `.uppercase` to a mono span that later shows a hash/token. | **FIX** (Cluster 2) — drop the redundant `uppercase` from those mono spans. |
| **UB-3** | LOW (latent) | CSS contenteditable carve-out | `tokens.css:249` | `[contenteditable='true']` matches only the literal `="true"`; bare `contenteditable` / `=""` / `plaintext-only` are equally editable but NOT exempted. **No contenteditable exists in the app today** (0 hits) → latent. | **FIX** (Cluster 2) — broaden to `[contenteditable]:not([contenteditable='false'])`. |

**Explicitly confirmed safe (Direction B):** emails (verbatim — proven §7), passwords/usernames (opt-out + regex), TOTP secret / recovery codes / one-time password (`.font-mono`, no `.uppercase`, `select-all` copyable), URLs / presigned object-keys / filenames (export + web), phones (opt-out + digit-filter), PAN/IFSC/GSTIN/refNo (keep-UPPER by spec — correct), policy/report content blobs (`uppercase={false}` / no transform), mobile field-report jsonb (ADR-0054, untouched).

---

## 6 — Owner-decisions (product/UX — surfaced, NOT auto-fixed)

These change either the exclusion set or the "should prose be uppercase" rule → per the session brief they need owner sign-off.

- **OD-1 — remark / reason free-text casing (the one substantive item). ⏳ PENDING owner (corrected framing below).**
  `case_tasks.remark` (mig 0041), `cases.result_remark` (mig 0052), and revoke/rework/reassign reason (overwrites `case_tasks.remark`) are plain `text` columns with **no SDK transform**. Web-entered values are uppercased on type by `<TextArea>`/`<Input>`.
  **CORRECTION (2026-07-03, after the owner asked "but mobile already sent uppercase?"):** the mobile app (`crm-mobile-native`) **also uppercases free-text on type** — `src/utils/installUppercaseDefaults.ts` globally wraps every RN `TextInput` to uppercase-on-type via the same `shouldUppercaseField` predicate (`src/utils/uppercase.ts`), and the form renderer uses `UppercaseTextInput`; `remark`/`remarks` is not excluded (only email/numeric/phone-pad/url/secure keyboards + case-sensitive name tokens opt out). So **mobile sends remarks UPPERCASE too.** `FormSubmissionService.ts:70` builds `remarks` from those already-uppercased values. ADR-0054's "server keeps the mobile blob verbatim" is about the *server* not re-transforming — but the mobile *client* already produced uppercase.
  **So there is NO live web/mobile inconsistency** — both clients uppercase remarks on type; a mixed-case remark can only arrive via a raw direct-API call bypassing both apps (not a real user path). The missing SDK `.transform(toUpper)` is a defense-in-depth gap, not a live defect.
  **OD-1 therefore reduces to a pure preference:** keep remark/reason prose UPPERCASE (current, consistent across web + mobile, matches the app-wide uppercase convention) **or** switch to preserve-case for readability (would require opting the fields out in **both** the web and mobile apps — the mobile change is a separate repo + gate + release, ADR-0054).
  **Options:** (a) **keep UPPERCASE** (no change; optionally add the SDK `.transform(toUpper)` net so a direct-API writer matches both clients — zero user-visible change); (b) **preserve case everywhere** (opt the fields out in web *and* mobile — bigger, cross-repo). **CTO recommendation given the mobile finding: (a) keep uppercase** — it's already consistent; add the SDK net as pure defense-in-depth. → decision needed.

- **OD-2 — `verificationUnit.resultSet[]` outcome labels.** Default is Title-Case (`['Positive','Negative','Refer','Fraud']`). Uppercasing risks the device's outcome matching (the canonical wire vocabulary is the separate `outcomeCode`). **Recommend WONTFIX** (keep Title-Case). → confirm.

- **OD-3 — `savedViews.name`.** Private, own-user view label; web input uppercases on type, SDK verbatim. Never cross-user/exported. **Recommend WONTFIX** (low stakes; leave as-is). → confirm.

- **OD-4 — predicate exclusion-set widening (ties to UB-1).** Add `phone`/`mobile`/`tel` to `CASE_SENSITIVE_NAME_TOKENS` to close the phone blind-spot cheaply (defense-in-depth for future phone inputs). The YAGNI storage-key/webhook/hash tokens stay out until such a field exists. Because the token list is part of ADR-0058's frozen exclusion set, this needs owner sign-off. **Recommend: add the 3 phone tokens.** → decision needed.

---

## 7 — Evidence log (real repro, this session — local stack, native pg `:54329/crm2_dev`)

| test | input | stored | proves |
|---|---|---|---|
| A1 · direct create client (display text) | name `acme test bank ltd` | `ACME TEST BANK LTD` | server net uppercases display text (Direction A works) |
| A2 · direct create user (Direction B) | email `MixedCase@Example.COM`, name `test upper user` | email **`MixedCase@Example.COM`** (verbatim), name `TEST UPPER USER` | email preserved AND name uppercased in the same request |
| A3 · **real CSV import** `POST /clients/import?mode=confirm` | file cell `zeta imported bank` | `ZETA IMPORTED BANK` (confirm: 1 ok / 0 failed) | import path uppercases via the SDK schema (import CLEAN) |

On-type UI behavior (type lowercase → UPPER live; username/email stay verbatim) was browser-verified in the ADR-0058 ship (departments create + username). Test rows deleted from `crm2_dev` after.

---

## 8 — Clustered fix plan (fix at the shared source, never per call-site)

Ordered; each slice: `pnpm verify` green + browser-verified + (import-affecting) import re-tested + memory/§8 update. **Ask before push.**

| cluster | scope | items | owner-gated? |
|---|---|---|---|
| **1 — SDK schema transform** | `packages/sdk/src/tatPolicies.ts` (+ optional `rates.ts`) | UA-1: add `.trim().transform(toUpper)` to `label` ×2. UA-2 (optional): add `.transform(toUpper)` to `clientRateType` for contract honesty. | No |
| **2 — CSS carve-out hardening** | `packages/ui-theme/src/tokens.css` + ~6 mono spans | UB-2: drop redundant `uppercase` from the `.font-mono` code-spans. UB-3: broaden the contenteditable carve-out selector. | No |
| **3 — predicate regression tests** | `apps/web/src/lib/uppercase.test.ts` | add cases: phone blind-spot (documents current), keep-upper codes (pan/ifsc/vehicleNo/refNo/gstin → true), email-segment names → false. **Behavior-preserving** (no predicate change). | No |
| **3b — predicate tokens** | `apps/web/src/lib/uppercase.ts` | OD-4: add `phone`/`mobile`/`tel` tokens (+ mirror tests). | **Yes (OD-4)** |
| **4 — remark/reason casing** | web remark/reason components (± SDK) | OD-1: implement the owner's choice (a)/(b)/(c). If (b): `uppercase={false}` on the web remark/reason `<TextArea>`/`<Input>`. | **Yes (OD-1)** |
| **5 — latent (defer)** | — | UA-3 (only if VALUE dim re-added), UA-4 (backfill only if mandated). | No (deferred) |

Clusters 1–3 are safe to ship without owner input; 3b + 4 wait on OD-1/OD-4.

---

## 9 — Dispositions summary

| id | disposition |
|---|---|
| UA-1 tatPolicies.label | **FIX** (Cluster 1) |
| UA-2 rates.clientRateType | **FIX-optional / WONTFIX** (non-issue; resolved via `UPPER()`) |
| UA-3 ValuePicker bare input | **DEFER** (dead branch) |
| UA-4 legacy rows in exports | **WONTFIX** (ADR-0058 §6 no-backfill) |
| UA-5 MIS filename slug | **WONTFIX** (cosmetic, code enum) |
| UB-1 predicate phone blind-spot | **TESTS now** + **OD-4** |
| UB-2 `.font-mono` vs `.uppercase` | **FIX** (Cluster 2) |
| UB-3 contenteditable carve-out | **FIX** (Cluster 2) |
| OD-1 remark/reason prose casing | **OWNER-DECISION** (rec: preserve case) |
| OD-2 resultSet labels | **OWNER-DECISION** (rec: WONTFIX) |
| OD-3 savedViews.name | **OWNER-DECISION** (rec: WONTFIX) |
| OD-4 predicate phone tokens | **OWNER-DECISION** (rec: add phone/mobile/tel) |

Registered in [`docs/COMPLIANCE_GAPS_REGISTRY.md`](../../COMPLIANCE_GAPS_REGISTRY.md) §UPPERCASE-2026-07-03.

---

## 10 — Implementation status (2026-07-03, owner-directed)

Owner decisions: OD-4 **approved (add phone tokens)**; safe fixes **implement now**; **OD-1 → keep uppercase + add server net** (owner, after confirming mobile parity); OD-2/OD-3 **discuss separately (deferred)**; ship = **commit + push to main**.

**Implemented + verified (this session, not yet pushed):**

| item | change | verify |
|---|---|---|
| UA-1 | `tatPolicies.label` (create + revise) → `.trim().transform(toUpper)` — `packages/sdk/src/tatPolicies.ts` | tatPolicies API test 8/8 (assertions updated to expect UPPERCASE) |
| OD-4 | added `phone`/`mobile`/`tel` to `CASE_SENSITIVE_NAME_TOKENS` — `apps/web/src/lib/uppercase.ts` | web unit tests (uppercase.test.ts) |
| UB-2 | dropped the redundant `.uppercase` from the 7 `.font-mono` rate-type-code spans (3 record pages + AddTasksForm ×2 + CaseDetailPage ×2) | `.font-mono` verbatim confirmed via live DOM probe; all `mono` rows are UPPER_SNAKE codes |
| UB-3 | broadened the carve-out to `[contenteditable]:not([contenteditable='false'])` — `packages/ui-theme/src/tokens.css` | live DOM probe: bare `contenteditable` now `text-transform:none`; `="false"` correctly stays uppercase |
| tests | predicate regression tests (phone tokens verbatim · keep-upper codes upper · email/url segments verbatim) — `apps/web/src/lib/uppercase.test.ts` | green |
| OD-1 | `.transform(toUpper)` on the 6 web/office remark/reason fields (`CompleteTaskSchema`/`RecordTaskResultSchema`/`CaseFinalizeSchema`/`RevokeTaskSchema`/`ReworkTaskSchema`/`ReassignTaskSchema`) — `packages/sdk/src/cases.ts`. Mobile evidence path (verification-tasks `FormSubmissionSchema` jsonb) untouched (ADR-0054). | cases API tests 107/107 (5 remark/reason assertions → UPPERCASE) |

`pnpm verify`: typecheck · lint · format · no-suppressions · boundaries · build + web/sdk tests green; API suite green (tatPolicies 8/8). Browser: global uppercase + carve-outs confirmed via DOM probe, zero console errors. **Not pushed — awaiting OD-1 + owner push approval.**

**Deferred:** OD-2 (resultSet — WONTFIX rec), OD-3 (savedViews.name — WONTFIX rec), UA-3 (dead ValuePicker branch), UA-4 (legacy-row backfill). Predicate token change is web-only; the mobile `crm-mobile-native` predicate (`src/utils/uppercase.ts`) also lacks phone tokens but its `EXCLUDED_KEYBOARD_TYPES` (phone-pad/numeric) already guards phone inputs — a mobile mirror is an optional follow-up in that repo's own gate.
