# Kickoff — LIVE BUG: the Residence ERT report contradicts the field data (`applicant_staying_status` dropped)

**Date:** 2026-07-16 · **Repo:** crm2 · **Severity:** 🔴 **HIGH — the report asserts the OPPOSITE of what the agent recorded, on a live client-facing document.**
**Status at handoff:** `main` == `prod` == `29dbde8` (+ local docs commits), staging + prod green, working tree clean. Nothing about this bug is fixed yet.

---

## 1. The owner's report (verbatim, then decoded)

> "we are caught in CASE-000002 · TAFSEER AHMED TEHRIR AHMED KHAN, task CASE-000002-1. in that we assign
> residence task to field user jayant.panchal, he open task filed data in ERT form and send back, we recive
> data and photos properly even report genrated. now issue is in that ert form in **Applicant Staying Status**
> / **Applicant is Shifted From** — but this value not in templete report genated insted statement is
> `ENTRY RESTRICTION DETAILS: SECURITY confirmed TAFSEER AHMED TEHRIR AHMED KHAN's stay at the given address.`
> which is wrong. also we have, ask agent to audit this"

**Decoded.** A **Residence** task was completed with outcome **ERT (Entry Restricted)**. The agent recorded
`Applicant Staying Status = "Applicant is Shifted From"` — i.e. **the applicant does NOT live there any more.**
The generated report never prints that, and instead prints a sentence asserting the met person **confirmed the
applicant's stay**. The report therefore states the **opposite of the field truth** on a document the client reads.

Sync/photos/report-generation all worked. **This is purely a narrative-template + helper defect.**

## 2. Diagnosis — ALREADY DONE, verified in code (do not re-derive; do verify)

Two distinct defects. **The second is worse than the one reported.**

### 🔴 BUG A — the Residence ERT template drops `applicant_staying_status` entirely

`packages/sdk/src/fieldReportDefaults.ts` — the field **is** in the catalog:

```ts
line 129:  F('applicant_staying_status', 'Applicant Staying Status', 'applicantStayingStatus'),
```

The **Residence ERT** narrative (~line 276) never references it:

```
ENTRY RESTRICTION DETAILS:
{{met_person_name}} {{metPersonConfirmation met_person_confirmation}} {{customer_name}}'s stay at the given address. Society board {{nameplate society_nameplate_status name_on_society_board "displays"}}.
```

**The fix pattern already exists in the same file** — the **Business ERT** narrative (line 877) renders it correctly:

```
…{{sentenceClause (stayingStatus applicant_staying_status) " The met person also informed that " "."}}…
```

And the `stayingStatus` helper (`apps/api/src/modules/fieldReports/helpers.ts:127-135`) **already handles this
exact value**, and is already registered (helpers.ts:326):

```ts
if (v.startsWith('applicant is shifted') || v.startsWith('applicant has shifted'))
  return 'the applicant has shifted from the given address';
```

So: **helper exists · value handled · pattern proven one template over · Residence ERT just never wired it.**
Grep proof — `applicant_staying_status` appears in a template body **exactly once**, at line 877 (Business ERT):

```
$ grep -n "applicant_staying_status" packages/sdk/src/fieldReportDefaults.ts
129:  F('applicant_staying_status', ...)     ← catalog
703:    'applicant_staying_status',          ← (check what this list is)
877:  …{{sentenceClause (stayingStatus applicant_staying_status) …}}   ← Business ERT ONLY
```

### 🔴 BUG B (the real one) — the template **welds the confirmation to "stay"**, whatever the agent said

This is Bug A's deeper form, and it is what actually produced the owner's sentence.

`fieldReportDefaults.ts:276` hard-codes the **object** of the confirmation:

```
{{met_person_name}} {{metPersonConfirmation met_person_confirmation}} {{customer_name}}'s stay at the given address.
                                                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                          welded — regardless of applicant_staying_status
```

`metPersonConfirmation` only ever yields **"confirmed"** or **"did not confirm"** — it supplies the *verb*, never
the *object*. The template then asserts the object is **"'s stay at the given address"**. So when the guard
confirmed *the applicant had shifted*, the report renders **"SECURITY confirmed …'s stay at the given address"** —
the exact inversion the owner caught. The agent's `met_person_confirmation` was almost certainly a legitimate
"Confirmed"; the template attached it to the wrong fact.

> **OWNER CORRECTION (2026-07-15): a field can never be blank — the device form makes every field mandatory.**
> An earlier draft of this kickoff claimed `metPersonConfirmation`'s `else → 'confirmed'` default was itself
> causing this. **That was wrong** and is retracted: with all fields populated, the blank path never fires in
> production. See ⚠️ B2 below for the residual, *latent* risk — do not confuse it with the live bug.

### ⚠️ B2 — latent, NOT the live bug: the helper's catch-all still resolves to "confirmed"

`apps/api/src/modules/fieldReports/helpers.ts:185-188`:

```ts
const metPersonConfirmation = (raw: unknown): string => {
  const v = lcOf(raw).trim();
  return v === 'not confirmed' || v === 'did not confirm' ? 'did not confirm' : 'confirmed';
};
```

The match is **exact** (after lowercase+trim). Two device options (`Confirmed` / `Not Confirmed`) map correctly.
But **any third or reworded option silently becomes "confirmed"** — a positive assertion from an unrecognised
value. Mandatory fields prevent the *empty* case, not the *unanticipated-value* case.

**This is unverifiable from this repo — the form's option list lives in `crm-mobile-native` (separate repo) and
IS the source of truth** (file-memory `project_mobile_form_source_of_truth.md`, INVARIANT). **Read the device
form's actual option list before deciding whether B2 is real.** If the options are exactly two, B2 is a
defensive hardening (fail-loud on an unknown value), not a bug — disposition it honestly either way.
Blast radius if real: **19 occurrences** of `metPersonConfirmation` across the templates.

## 3. First actions (in order)

1. **Read the live row (READ-ONLY — no writes without owner OK).** Prod RDS reachable only from inside the VPC
   via the EC2 box (`ssh -i ~/.ssh/crm2-aws.pem ubuntu@43.204.64.111`; conn details `secrets/CREDENTIALS.md`).
   Get the submitted form payload for **CASE-000002-1** and record the **exact device keys + values** for:
   `applicant_staying_status`, `met_person_confirmation`, `met_person_name`, `outcome`.
   **This is the source of truth — the report conforms to the device, never the reverse**
   (file-memory `project_mobile_form_source_of_truth.md`, an INVARIANT).
   **Expect `met_person_confirmation` to be populated** (owner: every device field is mandatory) — the question
   is *what the guard confirmed*, which is the whole of Bug B. Also read the **device form's option list** for
   `met_person_confirmation` in `crm-mobile-native` to settle ⚠️ B2.
2. **Confirm which template actually rendered.** Reports are effective-dated/snapshotted (ADR-0079/0080) — the
   live report may come from a **stored snapshot or a DB-side template**, not the SDK default you are reading.
   Find the render path before editing anything, or you will fix a file prod does not use.
   Start: `apps/api/src/modules/fieldReports/` (`helpers.ts`, service, the template resolver).
3. **Reproduce in a test** before touching the template — a failing test that renders the ERT narrative with
   `applicant_staying_status = "Applicant is Shifted From"` and asserts the output does **not** claim a
   confirmed stay. It must FAIL on today's code.
4. **Then fix**, smallest diff first (Bug A is a one-line template edit reusing line 877's proven clause).

## 3a. Two facts that narrow the fix (verified 2026-07-15)

- **The data is NOT lost — only the narrative drops it.** `apps/api/src/modules/fieldReports/sectionMap.ts:52`
  already lists `{ ref: 'applicantStayingStatus', label: 'Applicant Staying Status' }` in the **"Met Person &
  Occupancy"** section (and again at :330 for the office/business shape). So the structured section of the report
  shows the value; **only the generated narrative paragraph omits it.** Check what the owner is actually looking
  at — the narrative, the section table, or both — before deciding scope.
- **`SHIFTED` is its own outcome** (`verification_unit_outcomes`: `ENTRY_RESTRICTED`, `SHIFTED`, `POSITIVE`,
  `NEGATIVE`, `NSP`, `UNTRACEABLE` — per verification type). The agent chose **ENTRY_RESTRICTED** *and* recorded
  "Applicant is Shifted From", which is coherent (entry was refused; the guard volunteered that the applicant
  moved out) — **do not "fix" this by pushing the agent to pick SHIFTED.** The ERT narrative must be able to
  carry a shifted applicant. Worth confirming with the owner that this combination is intended.

## 4. Design questions to settle (owner input likely needed)

1. **The ERT sentence's correct shape** when the staying status contradicts a "confirmed". The template welds
   `metPersonConfirmation` to *"'s stay at the given address"*. Options: (a) make the object conditional on
   `applicant_staying_status` (guard confirmed *the shift*, not *the stay*); (b) keep the verb clause but drop the
   welded object and append the staying-status clause exactly as Business ERT (line 877) does; (c) rewrite the ERT
   paragraph. **Recommendation: (b)** — it reuses a proven, shipped clause and is the smallest honest diff.
   **This is client-facing copy → owner call on the exact wording.**
2. **⚠️ B2's disposition** — only after reading the device form's option list (see §3 step 1). If exactly two
   options exist, B2 is defensive hardening (fail-loud on an unknown value), not a bug. **Don't fix a phantom.**
3. **Retro-fix scope.** Existing generated reports carry the wrong sentence. Are historical reports regenerated,
   or is the fix forward-only? (Snapshot semantics per ADR-0079/0080 make this a real decision, not a detail.)
4. **The audit the owner asked for** (see §5) — how wide? Recommendation: every outcome × every helper with a
   defaulting branch.

## 5. The audit the owner explicitly asked for

> *"also we have, ask agent to audit this"*

**Scope it as: every field the device captures vs. every field the narrative renders, per outcome.** Bug A is
one instance of a *class*: a catalogued field that no template prints. The audit must answer, for each outcome
(RESI positive / Shifted / Untraceable / **ERT** / Office variants / Business variants / KYC…):

- Which device fields are **captured but never rendered in the narrative**? (Bug A's class. Note: `sectionMap.ts`
  may still table the value — so this is "the narrative contradicts/omits", not necessarily "data lost".)
- Where does a template **weld a helper's verb to a hard-coded object** that the form's own fields can contradict?
  (Bug B's class — this is the one that produced the live inversion. `{{metPersonConfirmation …}} X's stay at the
  given address` is the proven instance; look for the same shape elsewhere.)
- Which helpers have a **catch-all branch that asserts a positive fact** on an unrecognised value? (⚠️ B2's class —
  `metPersonConfirmation` is one; check `callConfirmation`, `nameplate`, `dominatedArea`, `workingStatus`,
  `stayingStatus`, `existsClause`, `setup`, … in `helpers.ts`.) **Judge each against the device form's real option
  list in `crm-mobile-native`, not against imagination.**
- Where does a template **assert** something the form never asked?

Use parallel readers (one per outcome family) — this is exactly the shape the CPV-group session used, and the
2026-07-12 lesson applies: **a retrofit/inline-only review misses silent-data-loss bugs — run the full lens.**

## 6. Where to look

- **Templates:** `packages/sdk/src/fieldReportDefaults.ts` (Residence ERT ~276 · Office ERT ~468 · Business ERT
  ~877 · field catalog ~112-135). *Ignore `packages/sdk/coverage/**` — that's generated coverage HTML, not source.*
- **Helpers:** `apps/api/src/modules/fieldReports/helpers.ts` (`stayingStatus` 127 · `metPersonConfirmation` 185
  · registry ~320-335).
- **Render/snapshot path:** `apps/api/src/modules/fieldReports/*` + ADR-0079/0080.
- **Device SoT:** file-memory `project_mobile_form_source_of_truth.md` (INVARIANT) · `project_mobile_field_test_4bugs_2026_07_13.md`
  (CASE-000002 is *that* field test's case — read it; it explains the case's history).
- **ADRs:** 0079, 0080 (field-report snapshot/fallback).

## 7. Standing rules for the session

- **Cave mode** (minimal tokens) · act as **CTO: decide + execute** — but **ask before push / deploy / tag /
  live-DB WRITES**. Live-DB **reads** for diagnosis are fine.
- **Test-first; every regression test must FAIL on revert — verify it, don't assume.**
- **Surgical, no guessing.** Bug A's fix is one clause copied from line 877. Do not redesign the template engine.
- **Default = reuse:** the helper, the `sentenceClause` pattern, and the working Business-ERT line all exist.
- A phase is done only when **`pnpm verify` is green** — and **`pnpm verify` EXCLUDES Playwright**: run the e2e
  specs of any page you touch (hard-won 2026-07-15 lesson; it broke CI on the CPV-group push).
- Lint bans `todo|fixme|hack|temp|xxx` anywhere in a comment (case-insensitive).
- Commits: author `Mayur Kulkarni <mayurkulkarni786@gmail.com>`, conventional, **no AI trailer**, never `--no-verify`.
- **UI/report work: don't stop at tests** — render the actual report for CASE-000002-1 and read the sentence.
- Every audit finding ends **FIXED / DEFERRED / RATCHET / WONTFIX** in `docs/COMPLIANCE_GAPS_REGISTRY.md`.
- Update `CRM2_MASTER_MEMORY.md` §8 + file-memory at ship. Next ADR = **0095**, next mig = **0119**.

## 8. Definition of done

CASE-000002-1's report states what the agent actually recorded — the applicant has **shifted from** the address —
and **never** claims a confirmed stay that no one stated. No template asserts a positive fact from a blank field.
The audit's findings are dispositioned in the registry. `pnpm verify` green + the report read in the browser.

---

### Context from the session that produced this (2026-07-15)

Shipped to prod that day: **CPV-group multi-select** (`29dbde8`, rate + rate-type-assignment create pages —
FE-only, client-side pair fan over the existing `/bulk` endpoints). Both envs green; disk cleaned (prod 15%,
staging 33%); rollback images retained on both boxes.

**Known-open, unrelated:** the users list has no hierarchy filter (`page.users` → whole org directory + PII
export); `/rates/export` cross-client pricing leak for roles holding `page.masterdata` (registry 2026-07-14);
ADR-0094 PROPOSED, not built.
