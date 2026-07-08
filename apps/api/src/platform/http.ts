/** Canonical HTTP status codes — the single source; never inline numeric statuses. */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  LOCKED: 423,
  TOO_MANY_REQUESTS: 429,
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,
  SERVICE_UNAVAILABLE: 503,
} as const;

/**
 * `decodeURIComponent` throws a bare `URIError` (not an `AppError`) on a malformed %-sequence, which
 * skips the error middleware's ZodError/AppError special-casing and falls through to a generic 500
 * (INPUT_VALIDATION-01, docs/audit/04-input-validation.md). Falls back to the raw, undecoded input —
 * safe for the two current callers (a display filename, a cookie value), neither of which needs the
 * request to fail just because a client sent a malformed escape sequence.
 */
export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
