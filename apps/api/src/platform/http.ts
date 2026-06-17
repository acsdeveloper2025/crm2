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
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;
