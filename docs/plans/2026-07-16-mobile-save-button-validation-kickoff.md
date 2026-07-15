# Kickoff — MOBILE: the Save button lets an incomplete form into the Saved tab

- **Date:** 2026-07-16 · **Repo:** ⚠️ **`crm-mobile-native` — a SEPARATE repo** at
  `/Users/mayurkulkarni/Downloads/crm-mobile-native` (NOT crm2; this kickoff merely lives in crm2's
  `docs/plans/` because that is where the owner's kickoffs live).
- **Mobile HEAD at handoff:** `18dcf6e` (v1.0.81, live). crm2 `main` == `prod` == `8419b47`, both green.
- **Severity:** 🟠 a task can be marked *Saved* — and locked read-only — with mandatory fields blank and
  photos missing. The user then cannot fix it from the Saved tab (see §4), so the only exit is Submit.

---

## 1. The owner's ask (verbatim)

> Please review the Save button functionality in the **In Progress** tab.
> **Important: Auto Save and the Save button are two different features and must be treated separately.
> Do not mix their logic.**
>
> 1. The Save button must remain **disabled** until the user has completed the entire verification form.
> 2. A task is complete only when: all mandatory form fields are filled **and** all required images are
>    captured/uploaded.
> 3. Users must not be able to click Save if any required field is empty or any required image is missing.
> 4. Once saved, it moves to the **Saved** tab.
> 5. The Saved tab is **read-only** — Submit only; no opening, editing or modifying.
>
> **Current issue:** users can save with incomplete fields and no photos. **Fix it.**
> **Verify only the manual Save button logic. Do NOT modify or test Auto Save as part of this task.**

## 2. Diagnosis — ALREADY DONE, verified in code. Do not re-derive; DO verify.

**The validator already exists and Submit already uses it. Save simply never calls it.** This is a
wiring gap, not a missing capability — the fix is reuse, not new validation logic.

| | validates fields? | validates photos? |
|---|---|---|
| **`handleSubmit`** (`VerificationFormScreen.tsx:538`) | ✅ `validateTemplateRequiredFields(...)` at **:545** — on failure it highlights every missing field red, scrolls to the first, and alerts | ✅ blocks with *"You must capture at least 5 location photos"* (~**:630**) |
| **`handleSave`** (`:500`) | ❌ **nothing** — only `if (!task \|\| !selectedOutcome) return;` + an in-flight re-check | ❌ **nothing** |
| **Save button `disabled`** (`:1081`) | ❌ `isSaving \|\| isSubmitting \|\| templateLoading` — **busy-state only, zero validation** | ❌ |

- The engine: `src/services/forms/FormValidationEngine.ts` — exports `validateTemplateRequiredFields`
  (:62), `evaluateFieldCondition` (:13, conditional fields), `isEmptyFieldValue` (:6). Imported into the
  screen at **:31**.
- Photos: `photoCount` state (`:84`); the UI already treats **5** as the bar (`photoCount >= 5` at :832,
  `({photoCount} captured)` at :837). **The 5 is currently a magic number at each site — check whether it
  is a per-template rule** (`requiredAttachments` exists on verification units in crm2) rather than a
  global constant, and reuse the real source.
- `handleSave` then calls `TaskRepository.toggleSavedState(task.id, true, task.status)` → the task lands
  in the Saved tab (`is_saved = 1 AND status != 'COMPLETED'`; status stays IN_PROGRESS).

**Why this is worse than it looks:** §4 is *already implemented* — `TaskListScreen.handleTaskPress`
(~:394) deliberately blocks form re-entry for a saved task and routes to a Submit confirmation instead
("preventing accidental edits to a draft the user already committed"). So an incomplete Save is a **trap**:
the form is locked, and the only way out is Submit, which then fails its own validation.

## 3. The Save/Auto-Save separation the owner insists on — know exactly where it is

`handleSave` currently does **three** things; only the first two are "Save":

1. `updateTaskFormData(task.id, formValues)` — persist the draft
2. `TaskRepository.toggleSavedState(...)` — **move to the Saved tab** ← the user-facing "Save"
3. `persistAutoSave(task.id, {...})` — **the AUTO-SAVE store** ← *not* the Save button's job

**Do not touch Auto Save's own trigger/timer/`autoSaveError` banner (`:748-757`).** The only question for
this task is whether `handleSave` should still call `persistAutoSave` — decide deliberately and say so;
do not silently entangle them further. Gating (1)+(2) behind validation must NOT stop auto-save from
protecting an in-progress draft: **an incomplete draft must still survive app-close.** That is the whole
reason the two are separate.

## 4. What is ALREADY done — do not "fix" it again

- **Saved tab is already read-only** (owner point 5). `handleTaskPress` blocks re-entry and shows a Submit
  confirmation; v1.0.81 (`18dcf6e`) also removed the footer for SAVED/SUBMITTED. **Verify on a device, but
  expect it to pass.**
- **The task moves to Saved on save** (point 4) — `toggleSavedState` already does it.

So the *real* work is points **1–3**: gate the button and the handler.

## 5. First actions (in order)

1. **Read `VerificationFormScreen.tsx` :500 (`handleSave`), :538 (`handleSubmit`), :1081 (the button)**
   side by side, plus `FormValidationEngine.ts`. Confirm the table in §2 before changing anything.
2. **Decide the shared gate.** `handleSubmit` and `handleSave` must agree on "is this form complete?" —
   extract ONE predicate (e.g. `isFormComplete(template, formValues, photoCount)`) and use it for the
   button's `disabled`, for `handleSave`, and for `handleSubmit`. **Two copies will drift** — that exact
   failure just cost crm2 two live bugs the same week (four hand-typed copies of an "overdue" rule; a
   report template that welded a verb to a hard-coded object). One definition, imported.
3. **Test-first.** `FormValidationEngine` is pure and already unit-testable — put the predicate there and
   test it: all-fields-filled + photos ⇒ enabled; one mandatory field blank ⇒ disabled; photos short ⇒
   disabled; a **conditional** field that is hidden ⇒ must NOT block (use `evaluateFieldCondition`).
   Every test must FAIL on revert — verify, don't assume.
4. **Then wire the button.** Disabled must reflect the same predicate, so the user cannot reach an alert.

## 6. Design questions to settle (owner input likely needed)

1. **Disabled vs. tap-then-explain.** A disabled button is silent: the user sees a dead button and does
   not know *why*. Submit's existing pattern is better — it highlights every missing field red and scrolls
   to the first. **Recommendation: keep the button ENABLED-looking but gate the action, reusing Submit's
   highlight-and-scroll**, OR disable it *and* show a live "N fields, M photos remaining" hint. The owner
   asked literally for "disabled"; confirm which, because a silent dead button is a support call.
2. **Is "5 photos" universal?** It is hard-coded at the sites above. crm2 verification units carry
   `requiredAttachments` — if the real rule is per-template, Save must read the template, not the number 5.
   **This decides whether the fix is 5 lines or a template read.**
3. **What about an in-progress draft the user wants to park?** Today Save is the only "keep it for later"
   button, and its own alert says *"You can continue filling it later."* — which is exactly what gating it
   removes. If Save requires completeness, **the user has no explicit way to park a partial form** and must
   trust auto-save. **This is the sharpest question in this kickoff — ask the owner before building.**
   Options: (a) rely on auto-save (it already persists drafts); (b) split into "Save draft" (always
   enabled) + "Save & mark complete" (gated); (c) accept the loss.
4. **Existing saved-but-incomplete tasks on devices** — after the fix they are still saved, still locked
   read-only, and still fail Submit. Do they need an unlock path? (Related: crm2's `revoke` is the only
   current escape.)

## 7. Where to look

- `src/screens/forms/VerificationFormScreen.tsx` — `handleSave` :500 · `handleSubmit` :538 ·
  validator call :545 · photo gate ~:630 · **Save button :1081** · Submit button :1122 · auto-save banner
  :748-757 · `photoCount` :84, :832, :837
- `src/services/forms/FormValidationEngine.ts` — `validateTemplateRequiredFields` :62 ·
  `evaluateFieldCondition` :13 · `isEmptyFieldValue` :6
- `src/screens/tasks/TaskListScreen.tsx` — `handleTaskPress` ~:394 (the read-only Saved behaviour)
- `src/screens/forms/LegacyFormTemplateBuilders.ts` — **the form definitions = SOURCE OF TRUTH** for which
  fields are mandatory and which are `conditional` (crm2 file-memory: *mobile form + DB outcome catalog =
  SoT; the report conforms to the device, never the reverse*).
- `src/context/TaskContext.tsx` — `persistAutoSave` / `autoSaveError` (**read-only for this task**).

## 8. Standing rules for the session

- **Cave mode** (minimal tokens); act as CTO — decide + execute — but **ask before push / release / tag**.
- ⚠️ **Mobile is a first-class `/api/v2` consumer — NEVER break the contract** (crm2 CLAUDE.md). This task
  should be **device-only**; if you find yourself editing crm2, stop and re-read the brief.
- **Test-first; every regression test must FAIL on revert — verify it, don't assume.**
- **Default = reuse.** The validator, the highlight-and-scroll, and the conditional-field evaluator all
  already exist. Do not write a second validator.
- **OWNER RULE (do not relax): per-photo GPS is REQUIRED** — a geo-guard relaxation was reverted once
  already (file-memory `project_mobile_field_test_4bugs_2026_07_13`).
- **Don't stop at tests** — run the app, open an In-Progress task, and try to Save it empty. The bug is a
  *button state*; only the device proves it.
- Commits: author `Mayur Kulkarni <mayurkulkarni786@gmail.com>`, conventional, **no AI trailer**, never
  `--no-verify`. A release needs a version bump (last: **v1.0.81**) + owner OK.

## 9. Definition of done

An In-Progress task **cannot** be saved with a mandatory field blank or photos missing; the button's state
and the handler agree because they share ONE predicate; a hidden conditional field never blocks; Auto Save
is **untouched** and still protects a partial draft; the Saved tab remains read-only + Submit-only; and the
behaviour is confirmed **on a device**, not just in tests.

---

### Context from the session that produced this (2026-07-15)

crm2 shipped to prod that day: the CPV-group multi-select (`29dbde8`), the Residence-ERT report fix
(`4cb7eb1`, + a prod snapshot regenerated), and the TAT/overdue work (`8419b47`, mig 0119). **The recurring
lesson across all three: a rule hand-copied into N places drifts, and the copy nobody tests is the one that
lies.** The overdue rule had four copies; two disagreed. Here, Save and Submit are two copies of "is this
form complete?" — one of which does not exist yet. Make it one.

**Mobile-relevant open items:** none blocking. crm2-side deferred: re-assignment silently clears a TAT
breach; no "did a COMPLETED task meet its TAT?" answer; case CANCELLED/REVOKED are dead statuses.
