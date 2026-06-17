# CRM2 — Uppercase Display Standard (PERMANENT)
**Status:** FROZEN 2026-06-04. Source of truth = `packages/ui-theme/src/tokens.css` (CSS policy) + `packages/ui-theme/src/index.ts` (exception model). This doc explains them.

> **One rule:** user-visible text renders **UPPERCASE via CSS only**. Stored values are **never** transformed — no DB, no API, no input mutation. The screen's casing is presentation; the data keeps its original case.

---

## 1. CRM2 V1 behavior analysis (validated against the live v1 codebase)
| Question | Finding (v1) | Evidence |
|---|---|---|
| Visual-only? | **Yes, primarily.** Global `body { text-transform: uppercase }` drives all display; reports do the same. | `CRM-FRONTEND/src/index.css:149`; `CRM-BACKEND/src/services/PDFExportService.ts:317,356` |
| Stored in DB? | **No DB/API transform.** DB has no `citext`, no write-side `UPPER()`, no uppercasing triggers; `UPPER()` appears only in `WHERE` for case-insensitive lookup. Free-text *landed* uppercase because the **v1 frontend `<Input>` mutated the typed value** (`lib/uppercase.ts` + `input.tsx`), not because the data layer transformed it. | `CRM-BACKEND` sweep: `UPPER(` only in WHERE (e.g. `citiesController.ts:38`, `users/crud.ts:139`); `CRM-FRONTEND/src/lib/uppercase.ts`, `components/ui/input.tsx:17` |
| Applied via CSS? | **Yes** — the primary channel (web body + PDF report CSS). | as above |
| Applied via formatting functions? | **Yes, two kinds:** (a) FE input-value `.toUpperCase()` → affected *stored* values; (b) BE `.toUpperCase()` (117×) = comparison/keying normalization only, **never persisted**. | `components/ui/input.tsx`, `textarea.tsx`; BE `constants/rbacRoles.ts`, `utils/*` |

**Conclusion:** v1's **data layer is already visual-only** (DB stores original case). The only place v1 mutated stored values was the *frontend input*. v2 keeps the visual approach and **removes the input mutation** to satisfy "preserve original values."

## 2. Recommended strategy (v2)
- **Adopt v1's visual uppercase** via a single CSS rule in `@crm2/ui-theme` (the one color/token source). Covers Dashboard, Pipeline, Cases, Tasks, Verification Units, tables, cards, reports — everything.
- **Diverge from v1 on inputs:** editable `input`/`textarea` are **excluded** from the uppercase rule and are **not** value-transformed → WYSIWYG; the screen equals the stored value.
- **No DB transform. No API transform.** (v1 already complied; v2 keeps it.)
- **Code fields** (UPPER_SNAKE domain codes like `RESIDENCE`, client/product codes) are enforced by **zod validation** (regex), not silent mutation; an explicit `uppercase` entry-assist on a *code* field is allowed (it's a constrained token, not free text).
- Render every **case-sensitive datum in `font-mono`** (also the design system's treatment for codes/IDs/amounts) → it is uppercase-excluded automatically and gets JetBrains Mono.

## 3. Global React/Tailwind implementation (shipped)
`packages/ui-theme/src/tokens.css` (`@layer base`):
```css
body { text-transform: uppercase; }                 /* all display surfaces */
button, select, optgroup, option { text-transform: uppercase; }   /* UA defaults these to none */
input, textarea, [contenteditable="true"],
code, pre, kbd, samp, .font-mono, .case-sensitive,
a[href^="http"], a[href^="mailto:"], a[href^="tel:"] { text-transform: none; }  /* preserve */
```
`packages/ui-theme/src/index.ts`: `CASE_SENSITIVE_CLASS` (`'case-sensitive'`), `CASE_SENSITIVE_NAME_TOKENS`, `CASE_SENSITIVE_INPUT_TYPES`, `isCaseSensitiveField(name, type)` — for components that programmatically tag a value as case-preserving.

**Component rules:** never write `.toUpperCase()` for display (CSS does it). To preserve a value's case, render it in `font-mono` or add `className="case-sensitive"`. Never force-uppercase a stored value on write.

## 4. Report generation rules (Phase 9 — when the report engine lands)
- Sealed PDFs/print views inherit the **same CSS visual uppercase** for headings, labels, field names, narratives (matches v1 `PDFExportService` + the bank/Zion sealed-report look).
- **Preserve case for** every identifier and machine string printed on the report: LOS/Application/Proposal ID, Bank/SOL reference, PAN/Aadhaar masked values, emails, URLs, file names, hashes, geo-coordinates — render these in `.case-sensitive`/`font-mono`. The report **reads stored values verbatim**; uppercase is print-CSS only.

## 5. Exception list (NEVER uppercase — render original case)
Editable `input` & `textarea` · password · login username · email · OTP · API keys · JWT/tokens · URLs · file names · hashes/checksums · external system identifiers · **Bank reference IDs · LOS IDs · Application/Proposal IDs · SOL IDs** · `code`/`pre`/`kbd`/`samp` · `.font-mono` · external `http`/`mailto`/`tel` links · anything tagged `.case-sensitive`.
Mechanism: the CSS selector list above + name-token detection in `isCaseSensitiveField()` + the `.case-sensitive` opt-out class.

## 6. Engineering standard update
Recorded in `ENGINEERING_STANDARDS.md` (Display Casing rule): *visual uppercase is CSS-only in `@crm2/ui-theme`; stored values are never transformed (DB/API/input); case-sensitive data renders in `font-mono`/`.case-sensitive`; no `.toUpperCase()` for display in components.*

---
*Permanent. To change display casing, edit `tokens.css` only. Cross-ref: `COLOR_SYSTEM_FREEZE.md`, `DESIGN_AND_STACK_FREEZE.md`.*
