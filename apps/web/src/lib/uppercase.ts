// CRM2 INPUT-UPPERCASE POLICY (ADR-0058) — supersedes the display-only
// UPPERCASE_DISPLAY_STANDARD. User-typed display text is auto-uppercased so the
// STORED value matches what the screen shows; case-sensitive data is preserved.
//
// Used by <Input> / <TextArea> to decide whether to auto-uppercase the typed
// value, and by any call site that needs the same predicate. The matching
// server-side safety net lives in @crm2/sdk (`upperText`) — see packages/sdk/src/text.ts.
//
// Case preservation wins over uppercase when EITHER:
//   - the input's `type` is one that can't semantically be uppercased without
//     changing meaning (email, password, url, tel, numeric…), OR
//   - the field's `name`/`id` matches a case-sensitive token (email, token,
//     url, path, otp, username, password…), OR
//   - the caller passes `uppercase={false}` as an explicit opt-out.
//
// Display-side uppercase is handled by the `body { text-transform }` rule in
// packages/ui-theme/src/tokens.css; this file governs the stored value.

const CASE_SENSITIVE_TYPES = new Set([
  'email',
  'password',
  'url',
  'tel',
  'number',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
  'file',
  'hidden',
  'color',
  'range',
]);

// Match against each camelCase / snake_case / kebab-case segment of the field
// name, OR against the whole name with punctuation stripped. Both `apiKey`
// (segments api, key) and `apikey` / `api_key` (full = apikey) resolve to the
// token `apikey`.
const CASE_SENSITIVE_NAME_TOKENS = [
  'email',
  'mail',
  'password',
  'pwd',
  'passwd',
  'username',
  'url',
  'link',
  'website',
  'domain',
  'token',
  'jwt',
  'secret',
  'apikey',
  'otp',
  'pin',
  'mfa',
  // Phone numbers are digits (uppercasing is a no-op), but excluding the name
  // tokens keeps a future text-typed phone field from being force-cased — closes
  // the predicate phone blind-spot (ADR-0058 OD-4, uppercase audit 2026-07-03).
  'phone',
  'mobile',
  'tel',
  'filename',
  'filepath',
  'path',
];

function isCaseSensitiveName(name: string): boolean {
  const fullAlnum = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const segments = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_\-\s]+/)
    .filter(Boolean);
  return CASE_SENSITIVE_NAME_TOKENS.some((token) => fullAlnum === token || segments.includes(token));
}

/**
 * Decide whether a text field's typed value should be auto-uppercased.
 * Returns false (preserve case) for case-sensitive types/names or an explicit
 * `uppercase={false}` opt-out; true otherwise.
 */
export function shouldUppercaseInput(type?: string, name?: string, explicit?: boolean, id?: string): boolean {
  if (explicit === false) {
    return false;
  }
  if (explicit === true) {
    return true;
  }
  if (type && CASE_SENSITIVE_TYPES.has(type.toLowerCase())) {
    return false;
  }
  // Check `id` as a fallback: a password Input that toggles show/hide flips its
  // `type` between 'password' and 'text'. If the field has no `name`, the
  // type-based exclusion vanishes the moment the password is revealed; an `id`
  // like "confirm-password" still catches it.
  if (name && isCaseSensitiveName(name)) {
    return false;
  }
  if (id && isCaseSensitiveName(id)) {
    return false;
  }
  return true;
}

/** Null-safe uppercase for a typed value (used where a string is not guaranteed). */
export function toUpperCaseSafe(value: unknown): string {
  if (value == null) {
    return '';
  }
  return String(value).toUpperCase();
}
