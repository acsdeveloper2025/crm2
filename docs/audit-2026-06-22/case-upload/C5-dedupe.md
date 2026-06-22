# C5 — The DEDUPE gate contract (for the bulk Case-Creation importer, ADR-0059)

**Audit-only. Read-only. Nothing changed.** Domain: the search-first, cross-applicant dedupe gate
(ADR-0053). Scope = `cases/{service,controller,routes,repository}.ts`, `CaseCreatePage.tsx`,
`packages/sdk/src/cases.ts`, `client.ts`, ADR-0053.

---

## 0. THE KEY FACT (why the importer must run dedupe itself)

`caseService.create` does **NOT** run any dedupe search. It only `CreateCaseSchema.parse`s the body and
inserts — trusting whatever `dedupeDecision` / `dedupeRationale` / `dedupeMatches` the caller already put
in the payload.

- `apps/api/src/modules/cases/service.ts:174-177` — `create(input, userId)` → `CreateCaseSchema.parse(input)` → `repo.create(v, userId)`. No search, no gate.
- `apps/api/src/modules/cases/repository.ts:395-414` — `repo.create` just `INSERT INTO cases (... dedupe_decision, dedupe_rationale, dedupe_matched_case_numbers ...)` straight from the input.

The gate that forces "Search BEFORE Create" lives **only in the web UI**
(`CaseCreatePage.tsx`). The server's *only* dedupe enforcement is the schema cross-field rule:
`CREATE_NEW` requires a rationale ≥5 chars (`packages/sdk/src/cases.ts:380-383`). It does **not** verify
that a search was run, nor that `dedupeMatches` is truthful, nor that `NO_DUPLICATES_FOUND` is actually
true.

**⇒ A bulk importer that POSTs `/api/v2/cases` (or reuses `repo.create`) with a hard-coded
`dedupeDecision: 'NO_DUPLICATES_FOUND'` will silently manufacture duplicates.** The importer MUST run the
dedupe search per row, per applicant, and derive the verdict — exactly as `CaseCreatePage` does.

---

## 1. The search inputs (what dedupe matches on)

**Endpoint:** `POST /api/v2/cases/dedupe` → `caseController.dedupe` → `caseService.dedupe` →
`repo.searchDuplicates`.

**Four identifiers, validated by `DedupeQuerySchema`** (`packages/sdk/src/cases.ts:326-344`):

| key       | rule                                                  | match semantics                                  |
|-----------|-------------------------------------------------------|--------------------------------------------------|
| `name`    | `searchTerm` = trim, **2–50 chars**, optional         | **EXACT**, case-insensitive: `upper(a.name) = upper($)` |
| `mobile`  | `searchTerm` 2–50, optional                           | **EXACT**, literal: `a.mobile = $` (no normalization) |
| `pan`     | `searchTerm` 2–50, optional                           | **EXACT**, case-insensitive: `upper(a.pan) = upper($)` |
| `company` | `searchTerm` 2–50, optional                           | **EXACT**, case-insensitive: `lower(a.company_name) = lower($)` |

- **At least one** identifier is required (`atLeastOneIdentifier` refine → 400 VALIDATION otherwise).
- Search terms are **lenient** (2–50 chars) — NOT the strict create-time field rules (PAN regex,
  10–15-digit phone). A partial/loose value is a valid *search* term. `cases.ts:324-325`.
- **Matching is EXACT, never partial / ILIKE.** SQL: `apps/api/src/modules/cases/repository.ts:323-343`
  (`dedupeConditions`). Identifiers are **OR-combined**: `WHERE <pan=> OR <mobile=> OR <name=> OR <company=>`.
- **`matchType[]`** is computed per result row (PAN/MOBILE/NAME/COMPANY) by re-comparing each provided
  term to the row (`repository.ts:345-359`, `withMatchType`). The web shows these as chips.

**SCOPE = ALL CASES, cross-scope by design.** `searchDuplicates` has **NO** actor/hierarchy/scope
predicate — it scans every `case_applicants` row joined to `cases`+`clients`
(`DEDUPE_FROM`, `repository.ts:316-318`). A duplicate must be findable regardless of who is searching.
Result is hard-capped at `DEDUPE_CAP = 200` rows (`repository.ts:315, 367`).

**Returned shape:** `DuplicateMatch` (`cases.ts:297-309`): `{ caseId, caseNumber, applicantName, mobile,
pan, companyName, status, clientName, createdAt, matchType[] }`. Advisory only — **never blocks**
(`service.ts:130-139`, comment "dedupe is advisory (returns matches; never blocks)").

### Two endpoints, same SQL core
- `POST /cases/dedupe` (the in-create gate) — flat array, capped 200, **`case.view`**-gated.
- `GET /cases/dedupe-search` (standalone Dedupe Check page) — same `dedupeConditions`, paginated +
  counted, **`dedupe.view`**-gated, cross-scope. `searchDuplicatesPaged`, `repository.ts:376-393`.
- `GET /cases/dedupe-search/export` — same lookup, **`data.export`**-gated. `routes.ts:16`.

> Company **IS** a backend search key in the SQL, but the web gate **never sends it** (ADR-0053 decision:
> weak identity, OR-match floods with same-employer cases). Both web call sites send name/mobile/pan only.

---

## 2. Cross-ALL-applicants (ADR-0053)

**The DB scan already covers every applicant** — `searchDuplicates` joins `case_applicants a` (every
applicant row, primary + co), so a match on ANY stored applicant of ANY existing case is returned.

**The blind spot ADR-0053 fixed was the INPUT side:** the old Search built the dedupe body from
`primary.*` only, so a *co-applicant the operator was entering* was never used as a search term. ADR-0053
makes the web run **one `/cases/dedupe` call per applicant that has ≥1 identifier** (primary + each
co-applicant), then merges client-side.

- Web: `CaseCreatePage.tsx:83-106` — `dedupe` mutation filters `applicants` to those with name|mobile|pan,
  then `Promise.all` one POST each; keeps each applicant's matches in its own `DedupeGroup`.
- Rollup: `apps/web/src/features/cases/dedupeBatch.ts:19-30` — `summarizeDedupe` unions all groups'
  matched `caseNumber`s (deduped, sorted), and derives the **single case-level** decision.

**⇒ The importer MUST search every applicant on a row (the primary + every co-applicant), not just the
primary.** Each applicant search uses that applicant's own name/mobile/pan.

---

## 3. The verdict contract (what `CreateCaseInput` must carry)

**Enum** `DEDUPE_DECISIONS = ['NO_DUPLICATES_FOUND', 'CREATE_NEW']` (`cases.ts:124-125`).

**On `CreateCaseSchema`** (`cases.ts:364-384`):
| field                     | type / rule                                                                 |
|---------------------------|------------------------------------------------------------------------------|
| `dedupeDecision`          | `z.enum(DEDUPE_DECISIONS)` — **required**                                     |
| `dedupeRationale`         | trim, ≤2000, uppercased; **required (≥5 chars) iff `dedupeDecision==='CREATE_NEW'`** |
| `dedupeMatches`           | `string[]` (each ≤20 chars), ≤200 — the matched case numbers created despite  |

**Cross-field rule (the ONLY server enforcement):** `cases.ts:380-383` —
`dedupeDecision !== 'CREATE_NEW' OR dedupeRationale.length >= 5` (`MIN_RATIONALE = 5`). Else 400 with path
`dedupeRationale`.

> NOTE: `Case.dedupeDecision` (read type) is non-nullable, but `dedupeChecked` exists too. The create
> INSERT writes `dedupe_decision/rationale/matched_case_numbers` directly (`repository.ts:399-411`);
> `dedupe_checked` is a separate column on `cases` (set at create — see migration; not in the create
> input). The importer only supplies the three `dedupe*` input fields.

**Per-applicant dedupe fields (post-creation add — for completeness, ADR-0053 §2):**
`AddApplicantSchema` (`cases.ts:388-402`) mirrors the create contract for ONE applicant: `{ name, mobile?,
pan?, companyName?, dedupeDecision (required), dedupeRationale? (≥5 iff CREATE_NEW), dedupeMatches? }`.
Stored on the `case_applicants` row (NULL `dedupe_decision` ⇒ original set, covered by `cases.dedupe_*`).
Endpoint `POST /cases/:id/applicants`, guard **`CASE_CREATE`**, only while case is NEW/IN_PROGRESS else
409 `CASE_NOT_OPEN` (`service.ts:181-187`, `routes.ts:24`). **The batch importer likely won't use this** —
a row imports its full applicant set at create.

---

## 4. The gate logic in `CaseCreatePage.tsx` (rules to replicate)

State: `hasSearched` (`tsx:51`), `groups` (`tsx:53`), `rationale` (`tsx:54`).

**Re-arm rule:** ANY mutation of the applicant set resets `hasSearched=false` via `armSearch()`
(`tsx:74`) — field edits (`setApplicant`, `tsx:75-78`), add co-applicant (`tsx:288`), remove (`tsx:274`).
A new/edited applicant can never reach Create un-deduped (ADR-0053 DON'T-REGRESS).

**Derived verdict** (`tsx:108-110`):
- `summary = summarizeDedupe(groups)` → `{ decision, matchedCaseNumbers }`.
- `hasMatches = hasSearched && summary.matchedCaseNumbers.length > 0`.
- `decision = summary.decision` (`CREATE_NEW` if any match, else `NO_DUPLICATES_FOUND`).

**Create button enabled (`canCreate`, `tsx:131-137`) iff ALL of:**
1. `clientId && productId && primary.name.trim()` — identity present.
2. `contactOk` — backend contact matches `PHONE_REGEX` (10–15 digits).
3. `applicantsValid` — every applicant's mobile passes `phoneOk` and pan passes `panOk`.
4. **`hasSearched === true`** — a Search must have run since the last applicant-set change. ← the gate.
5. `rationaleOk` — `!hasMatches || rationale.trim().length >= 5`. ← rationale required when matches exist.
6. `!created` — not already created.

**Payload built (`tsx:112-123`):** `dedupeDecision: decision`; and **only when `hasMatches`**, also
`dedupeRationale: rationale.trim()` + `dedupeMatches: summary.matchedCaseNumbers`. When no matches, those
two are omitted (decision is `NO_DUPLICATES_FOUND`).

**`disabledReason`** (`tsx:139-153`) is the human message for each failed gate — incl. "Search for
duplicates first." (`!hasSearched`) and "Add a rationale (min 5 characters)…" (`!rationaleOk`).

---

## 5. THE IMPORTER'S REQUIRED DEDUPE STEP (per row)

The importer must reproduce the web gate **server-side**, because the create endpoint won't.

**Per import row (one case):**
1. **Parse the applicant set** for the row: the primary + every co-applicant (name/mobile/pan/company).
2. **For each applicant with ≥1 of {name, mobile, pan}**: call the dedupe search.
   - Server-side, call `caseRepository.searchDuplicates({ name?, mobile?, pan? })` directly (the same repo
     fn the endpoint uses) — no HTTP round-trip needed. Send name/mobile/pan only (omit company, matching
     the web gate decision).
   - Terms must satisfy `DedupeQuerySchema` (each ≥2 chars). A blank/1-char value should be dropped, not
     sent (the web does `a.name.trim() ? {name} : {}`). If an applicant has NO usable identifier, it
     contributes no search (and no matches) — consistent with `searchable` filter `tsx:86-88`.
3. **Union the results across all applicants** for the row → the set of matched `caseNumber`s
   (de-duplicated). This is `summarizeDedupe`.
4. **Derive the verdict:**
   - matched set **empty** ⇒ `dedupeDecision = 'NO_DUPLICATES_FOUND'`; omit rationale + matches.
   - matched set **non-empty** ⇒ `dedupeDecision = 'CREATE_NEW'`; **a rationale ≥5 chars is REQUIRED** and
     `dedupeMatches = [...matchedCaseNumbers]`.
5. **POST the case** with the derived `dedupeDecision` (+ rationale + matches when CREATE_NEW). The schema
   re-validates the ≥5-char rationale rule.

### How the "Allow Duplicate" override column maps to the verdict
The importer cannot auto-supply a rationale (a human judgement). So:
- **No matches found** ⇒ `NO_DUPLICATES_FOUND`, row imports cleanly. The override column is irrelevant.
- **Matches found, and the row's "Allow Duplicate"/override column is FALSE (or blank)** ⇒ this is a
  *blocked* row. Surface it as a **per-row error** in the import preview (column `*` or a dedicated
  `allowDuplicate` column), e.g. "Duplicate of CASE-000123; set Allow Duplicate + Rationale to import."
  Do NOT silently create.
- **Matches found, override TRUE, and a rationale supplied (≥5 chars)** ⇒ `CREATE_NEW` with
  `dedupeRationale = <the row's rationale cell>` and `dedupeMatches = <the union of matched case numbers>`.
- **Matches found, override TRUE, but rationale missing/<5 chars** ⇒ per-row error (mirrors the server's
  own 400). The rationale is mandatory for `CREATE_NEW` — there is no way around it.

Recommended template columns: `allowDuplicate` (Y/N) + `dedupeRationale` (free text). The matched case
numbers are computed by the importer, not supplied by the user (the user can't know them ahead of time),
and echoed into the preview so the operator sees what they're overriding.

### Reusable server function + RBAC
- **Reusable repo fn:** `caseRepository.searchDuplicates(q: DedupeQuery): Promise<DuplicateMatch[]>`
  (`apps/api/src/modules/cases/repository.ts:363-371`) — exact-match OR scan, cross-scope, capped 200.
  The importer should call this directly (it is the single source of truth the gate endpoint also uses).
  `caseService.dedupe` (`service.ts:136-139`) is a thin wrapper if a validated entry point is wanted.
- **RBAC of the existing endpoints:**
  - `POST /cases/dedupe` → **`case.view`** (`routes.ts:13`) — note: the in-create gate is only `case.view`,
    not a dedicated dedupe perm.
  - `POST /cases` (create) → **`case.create`** (`routes.ts:20`). Roles with `case.create`: **SUPER_ADMIN,
    MANAGER** only (`packages/access/src/permissions.ts:93-143`).
  - `GET /cases/dedupe-search` (standalone page) → **`dedupe.view`** (`routes.ts:17`). Roles with
    `dedupe.view`: SUPER_ADMIN, MANAGER, TEAM_LEADER, BACKEND_USER.
- **For the importer:** it sits behind whatever the bulk-import route is gated by, but to be consistent it
  must require **`case.create`** (it creates cases) — the same actor who can create one case. Running the
  dedupe scan internally needs no extra perm (the importer is server-side; `searchDuplicates` is
  scope-free by design). DEDUPE_VIEW gates the *standalone Dedupe Check page*, not the create-gate search.

---

## 6. Open questions for ADR-0059

1. **Where does the rationale come from in a bulk import?** A single sheet-level rationale, a per-row
   `dedupeRationale` cell, or block all duplicate rows by default (require a re-upload with overrides)?
   The web requires a human-typed, case-specific rationale; a bulk default rationale weakens the audit
   trail. Recommend a per-row rationale cell, required only when `allowDuplicate=Y` and matches exist.
2. **Should the importer surface the matched case numbers in the preview** so the operator can confirm the
   override is intentional? (The web shows the full match table + matchType chips; a CSV importer can only
   show case numbers.) Recommend echoing `dedupeMatches` per row in `ImportPreviewResult`.
3. **Should the search run at preview time or only at confirm?** The import standard re-runs validation on
   confirm (stateless re-send, `packages/sdk/src/import.ts`). Dedupe is time-sensitive (a case created
   between preview and confirm changes the result). Recommend running the search at **confirm** (the
   authoritative pass), and optionally at preview for the operator's benefit (clearly marked "as of now").
4. **Idempotency / intra-file duplicates:** two rows in the SAME file that are duplicates of each other
   won't be caught by `searchDuplicates` (neither is in the DB yet). The importer should also dedupe rows
   *within the batch*. Out of this gate's scope but must be specified in ADR-0059.
5. **Company key:** the web gate deliberately omits company. Keep the importer consistent (name/mobile/pan
   only) unless ADR-0059 explicitly revisits it.
6. **Cap at 200:** `searchDuplicates` caps at 200 rows. For a generic name this could truncate. The web
   never paginates the gate result; the importer only needs the matched case-number *set*, so 200 is
   almost always enough, but note it.

---

## 7. File:line anchors (quick index)

| concern | location |
|---|---|
| create does NOT dedupe | `apps/api/src/modules/cases/service.ts:174-177` |
| create INSERT trusts payload dedupe | `apps/api/src/modules/cases/repository.ts:395-414` |
| dedupe search SQL (exact, OR, cross-scope, cap 200) | `apps/api/src/modules/cases/repository.ts:315-371` |
| matchType tagging | `apps/api/src/modules/cases/repository.ts:345-359` |
| `caseService.dedupe` (validated wrapper) | `apps/api/src/modules/cases/service.ts:136-139` |
| `DedupeQuerySchema` / search terms (2–50) | `packages/sdk/src/cases.ts:324-344` |
| `DEDUPE_DECISIONS` enum | `packages/sdk/src/cases.ts:124-125` |
| `CreateCaseSchema` dedupe fields + ≥5 rationale rule | `packages/sdk/src/cases.ts:364-384` |
| `AddApplicantSchema` (per-applicant verdict) | `packages/sdk/src/cases.ts:388-402` |
| `DuplicateMatch` shape | `packages/sdk/src/cases.ts:297-309` |
| web gate: re-arm + canCreate + payload | `apps/web/src/features/cases/CaseCreatePage.tsx:74, 83-137` |
| web per-applicant batch search | `apps/web/src/features/cases/CaseCreatePage.tsx:83-106` |
| verdict rollup `summarizeDedupe` | `apps/web/src/features/cases/dedupeBatch.ts:19-30` |
| routes + RBAC (dedupe=case.view, create=case.create, dedupe-search=dedupe.view) | `apps/api/src/modules/cases/routes.ts:13-24` |
| role→permission map | `packages/access/src/permissions.ts:93-143` |
| SDK client methods (`cases.dedupe`, `cases.create`, `cases.addApplicant`) | `packages/sdk/src/client.ts:622-653` |
