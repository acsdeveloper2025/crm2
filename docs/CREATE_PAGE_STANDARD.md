# CREATE_PAGE_STANDARD.md — create/entry pages, result screens & user feedback (v1, 2026-07-11)

**Owner-approved 2026-07-11** (commission multi-location entry build). This is the SoT for how a
CREATE/entry page, its result screen, and its success/error feedback look and behave. New entry
pages MUST follow it; existing pages retrofit opportunistically (no big-bang).
**Reference implementation:** `apps/web/src/features/commissionRates/CommissionRateCreatePage.tsx`
(+ `CommissionRatesPage.tsx` list toasts, `CommissionRateRecordPage.tsx` revise form).

All colors come from the frozen `@crm2/ui-theme` semantic tokens (COLOR_SYSTEM_FREEZE) — never raw
values. All layout responsive-first (RESPONSIVE_DESIGN_STANDARD).

## 1 — Page layout (the "step card" form)

- Page header: back link (`Button variant="link"` "← Back to …"), `h1` (`text-xl font-bold
  tracking-tight`) naming the record ("New Commission Rate" — no fancy verbs), one-sentence
  `text-sm text-muted-foreground` subtitle saying what one save does.
- The form is 1..N **numbered step cards** (`section.rounded-lg.border.border-border.bg-card.p-5.
  shadow-sm`), each with:
  - a **blue circle number** (`h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs
    font-semibold`), a `text-[15px] font-semibold` title, and an optional right-aligned **pill
    badge** (`bg-primary-muted text-primary text-[11px] font-semibold rounded-full`) carrying live
    context ("3 pincodes assigned");
  - a one-line hint under the title (`text-xs text-muted-foreground`, indented past the circle)
    that says what the step means ("These values are identical on every row created below.").
- Step 1 = **pick-once fields** in a responsive grid (`grid gap-4 sm:grid-cols-2 lg:grid-cols-3`),
  never a narrow single column. Field labels: `text-xs font-medium` + markers — required = red `*`,
  optional = muted `· optional`, special semantics = muted hint (`· blank = now`). Universal-able
  selects say so in the empty option ("Universal (all clients)"). Money inputs carry a ₹ prefix
  inside the input. Every select gets loading text and an inline error line when its query fails.
- Contextual guidance = an ℹ️ note strip inside the card (`rounded-md border bg-muted/40 text-xs`),
  stating the rule that changes behavior (e.g. office rate types skip the location step).
- Step 2 (when the page fans out over a set) = the **pick-many tick-list**, grouped
  (`rounded-md border bg-surface-muted` per group) with a group header (key value bold +
  tabular-nums, context muted, right-aligned `x/y` count + "Select all" checkbox with
  `indeterminate` for partial). Items are **chip labels** (`rounded-full border px-3 py-1.5
  text-xs` + checkbox, `has-[:checked]:border-primary has-[:checked]:bg-primary-muted`).

## 2 — Existing-data hints on pickers (duplicate prevention BEFORE save)

When a selection could collide with existing records, the picker must SHOW the existing state, not
let the user discover it at save time:
- Each chip carries a compact hint of what already exists there (`text-[10px] tabular-nums
  text-muted-foreground`, e.g. "LOCAL ₹175 · OGL ₹220").
- **Amber state** (`border-st-under-review bg-st-under-review-bg`, hint `text-st-under-review`):
  the save would be **skipped** (already exists) — still tickable; tooltip explains ("revise the
  existing rate to change its amount").
- **Red state** (`border-st-rejected bg-st-rejected-bg`, disabled checkbox, `cursor-not-allowed`):
  the save would be **rejected** (a business rule blocks it) — untickable; tooltip names the rule
  and the way out. "Select all" skips red chips; changing the field that defines the rule clears
  the selection (UX-9 Clear-fields pattern).

## 3 — Sticky summary bar (the commit surface)

A sticky bottom bar (`sticky bottom-0 z-10 rounded-lg border border-border-strong bg-card px-4
py-3 shadow-md`) that is visible at the moment of commit regardless of scroll:
- **Live count headline** ("**N** rates will be created") + muted breakdown ("2 pincodes · 6 areas
  selected");
- an **echo of the consequential values** picked in step 1 that are now off-screen (who, how much,
  for which client) — a money-path save must never happen with the amount invisible;
- actions right-aligned: `Clear` (ghost, resets the pick-many set) · `Cancel` (ghost) · primary CTA
  **carrying the count** ("Create 6 rates"; "Save" when exactly one). CTA disabled until the form
  is valid; caps surfaced client-side before the server would reject.

## 4 — Result screen (after a batch save)

Never a bare "done" panel. The result view shows **one row per submitted item, styled like the
module's list page** (same column names/order where they exist): the wrapped table
(`overflow-x-auto rounded-lg border bg-card`, uppercase `text-[11px]` headers on
`bg-surface-muted`) + a **Status column**: `Created` (`text-st-approved`) · `Skipped — already
exists` (`text-st-under-review`) · error label (`text-destructive`, plain English, never a raw
code). Above it: an honest headline ("Commission rates created" / **"No new rates created"** when
0) + a counts line ("N created · M skipped (already exist) · K errored"). Below: one muted line
explaining skip semantics. Actions: `Add more …` (ghost, stays with fields kept) + primary
`View <list>`. Single-record saves skip the panel and navigate back to the list.

## 5 — Success / error feedback (alerts)

- **Success:** ALWAYS a green toast (global sonner `<Toaster richColors position="top-right">` —
  the app has exactly one). Batch: "N rates created · M skipped (already exist)". Single: "<Record>
  created". A silent navigate is a defect.
- **Error:** BOTH a red toast (impossible to miss) AND a persistent inline message
  (`text-sm text-destructive` with `role="alert"`) that stays on the page while the user fixes it.
- **Copy:** every KNOWN error code maps to plain English via a per-page `friendlyError`-style map
  (one map per page; shared module = YAGNI); unknown codes fall through to the raw code — never
  swallowed. OCC conflicts keep the ConflictDialog (CONCURRENCY_AND_EDITING_STANDARD).
- List-page row actions (activate/deactivate/etc.) use the same friendly mapping in their toasts.

## 6 — Import templates (the file-side entry path)

- Template = bold header row **exactly matching the import parser's headers** (never decorate
  header text — it breaks round-trip) + **one sample row per accepted value shape** (`sampleRows`),
  not a single row that teaches only one form.
- Guidance lives in a second **"Notes" worksheet** (`templateNotes`; the parser reads only the
  first sheet): required columns, per-value formats, and any role/eligibility rules — generated
  from live config where it could drift (e.g. role→dimension wiring).
- Import confirm result = the platform result screen (Imported/Failed counts + Row·Column·Error
  table + errors-CSV download); per-row write failures carry the same descriptive messages as the
  API (IMPORT_EXPORT_STANDARD).

## Don't

- No modal create for record-shaped data (ADR-0051 — record-page routes).
- No raw error codes or silent successes; no result screens without per-item rows on batch saves.
- No pick-many UI without existing-data hints when collisions are possible.
- No `max-w-md` single-column form when the page has 4+ fields — use the step-card grid.
