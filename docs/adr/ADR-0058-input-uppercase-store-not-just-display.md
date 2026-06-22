# ADR-0058: Auto-uppercase typed input (store, not just display)

- **Status:** **Accepted** — owner-directed 2026-06-22 (owner + CTO). **Supersedes [docs/UPPERCASE_DISPLAY_STANDARD.md](../UPPERCASE_DISPLAY_STANDARD.md)** (the "display-only, never transform stored values" rule) and **amends [ADR-0008](./ADR-0008-design-system.md)** ("uppercase display text is visual-only, not a change to underlying data"). Changes a FROZEN decision — see [LONG_TERM_PROTECTION.md](../governance/LONG_TERM_PROTECTION.md). (ADR-0057 was taken by the concurrent field-report canonicalization work; this is 0058.)
- **Date:** 2026-06-22
- **Migrations:** none (no schema change; uppercasing happens at write time. Existing mixed-case rows already render UPPERCASE via CSS, so no backfill is required — see §6).

## Context — the bug

The UI renders virtually all text UPPERCASE (CSS `text-transform: uppercase` on `body`,
[`packages/ui-theme/src/tokens.css`](../../packages/ui-theme/src/tokens.css)), but under the prior
**display-only** standard the *stored* value was whatever the user typed. Editable inputs were even
held verbatim (`input, textarea { text-transform: none }`) as a deliberate WYSIWYG choice. Result
(owner, 2026-06-22):

> We show everything in capital letters but let the user type in any format — that's wrong. Auto-convert
> all input to UPPERCASE, except username and password.

So a user typing `john doe` saw `JOHN DOE` on read-only surfaces but `john doe` while editing, and the
database held `john doe`. Search, exports, dedupe comparisons and any non-web reader (mobile / direct API)
saw the un-normalized value. The fix is to make the **stored** value match the displayed value.

## Decision

**User-entered display text is normalized to UPPERCASE — visually AND in storage — except a safe set of
case-sensitive fields.** Enforced in two layers (owner-chosen "client + server, both"):

### 1. Client (live UX) — shared `<Input>` / `<TextArea>` components
[`apps/web/src/components/ui/Input.tsx`](../../apps/web/src/components/ui/Input.tsx) and
[`TextArea.tsx`](../../apps/web/src/components/ui/TextArea.tsx) uppercase the value on type and tag
case-sensitive fields `.case-sensitive`. They are drop-in for a bare `<input className="input">`
(className preserved, no visual change beyond casing). The inclusion/exclusion decision is the pure
predicate `shouldUppercaseInput(type, name, explicit, id)` in
[`apps/web/src/lib/uppercase.ts`](../../apps/web/src/lib/uppercase.ts) (ported from CRM2 v1, unit-tested —
no jsdom needed, ADR-0042).

### 2. Server (safety net) — `@crm2/sdk` zod transform
[`packages/sdk/src/text.ts`](../../packages/sdk/src/text.ts) exports `toUpper`. Genuine
human display-text fields in the create/update request schemas append `.transform(toUpper)`, so data
written by ANY client (web, mobile, direct API) is stored UPPERCASE. This is the contract-level guarantee.

### 3. Display CSS follows suit
`tokens.css` now uppercases `input, textarea` too (was `none`); case-sensitive input *types*
(email/password/url/tel/number/date/…), `.case-sensitive`, technical/identifier strings
(`code/pre/kbd/samp/.font-mono`), `contenteditable`, and external links still render verbatim.

## Exclusions (the safe set — preserve & store original case)

Adopts CRM2 v1's proven set, NOT just username/password:

- **By input type:** email, password, url, tel, number, date, time, datetime-local, month, week, file,
  color, range.
- **By field name/id token:** username, email/mail, password/pwd/passwd, url/link/website/domain,
  token/jwt/secret/apikey, otp, pin, mfa, filename/filepath/path.
- **Server-side, additionally never transformed:** regex-validated UPPER_SNAKE **codes** (already uppercase
  by constraint), enums, IDs/UUIDs, phone numbers, and **content/template/JSON blobs** (markdown / handlebars
  bodies — `policy.content`, `reportTemplate.content`, report-layout `templateBody`).
- **Auth is untouched:** `username` is lowercase (regex `[a-z0-9._-]`), `password` is hashed as-typed.
- **Mobile contract (ADR-0054):** mobile-submitted verification result/remark payloads keep their verbatim
  jsonb round-trip; the server transform is applied to web/admin-entered fields (case/applicant/master data),
  not to the mobile field-report blobs.

## Consequences

- **Positive:** stored value == displayed value; consistent exports/search/dedupe; one predicate + one
  zod helper, both reusable; existing ad-hoc `.toUpperCase()` onChange calls (PAN, role/template codes) become
  redundant (harmless — idempotent — and removed during migration).
- **Negative / risk:** a few hundred call sites migrate from bare `<input>`/`<textarea>` to `<Input>`/
  `<TextArea>`; SDK schema output for transformed fields is now uppercase (tests updated to match). Any future
  free-text field must consciously choose the component (auto-detect handles most) and, server-side, decide
  whether it is display text or case-sensitive.

## Alternatives considered

- **Display-only (status quo):** rejected — the explicit ask is to fix the *stored* value.
- **Client-only:** rejected — mobile / direct API would still store mixed case.
- **Server-only:** rejected — the field would still *type* in mixed case and snap on save; poor UX, doesn't
  fix the "typing in any format" feel.
- **Uppercase every string in the SDK:** rejected — emails, usernames, codes, and JSON blobs share the same
  schemas; blanket transform would corrupt them. Per-field selection is required.

## Migration / rollout

Additive, no DB migration. CSS flip + components + SDK transforms land together (an unmigrated form is still
correct: it displays uppercase via CSS and stores uppercase via the server net; migrating it upgrades the
client state to match). Gate: full `pnpm verify` green.
