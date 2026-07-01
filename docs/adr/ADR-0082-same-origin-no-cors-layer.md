# ADR-0082: Same-origin deployment, no CORS layer on the API

- **Status:** Accepted
- **Date:** 2026-07-01

## Context

API_SECURITY-04 (`docs/audit/09-api-security.md`): the API has no `cors` package
dependency and sets no `Access-Control-Allow-Origin` header anywhere, but this was
never recorded as a deliberate decision — an auditor (or a future contributor) finding
no CORS handling at all could reasonably read that as an oversight rather than
intentional. It is intentional; this ADR makes that explicit.

CRM2's web SPA is served by the same nginx edge that reverse-proxies `/api/` to the API
container (`infra/prod/nginx.conf`) — the browser always calls the API same-origin
(`https://crm.allcheckservices.com/api/v2/...`), never cross-origin. The mobile app
(`crm-mobile-native`) is a native HTTP client, not a browser context — CORS is a
browser-enforced mechanism and doesn't apply to it at all.

## Decision

We will NOT add a CORS middleware/package to the API. The API is same-origin-only by
deployment topology (single nginx edge fronting both the SPA and the API), not by a
CORS allowlist. No browser origin other than the SPA's own can ever reach the API
through a real browser tab, because no other origin serves a page that would call it
same-origin — and cross-origin `fetch`/XHR calls from a third-party page are blocked by
the browser's own default (no `Access-Control-Allow-Origin` = deny), which is exactly
what "no CORS headers at all" achieves for free.

The one place a browser-relevant CORS-shaped decision DOES exist is the Socket.IO
handshake (`apps/api/src/platform/realtime/index.ts`), which sets an explicit origin
allowlist (`MERGED-SOCKETIO-CORS`, ADR-independent fix, docs/audit/FINDING_VERIFICATION.md)
rather than reflecting any origin — because unlike the plain REST API, `credentials:
true` on a socket handshake is a more deliberate opt-in surface worth allowlisting
explicitly even though the JWT-in-handshake auth was already the real gate.

## Consequences

### Positive
- Zero CORS-configuration surface to get wrong (no allowlist to maintain, no
  `Access-Control-Allow-Origin: *` footgun).
- One fewer dependency.

### Negative
- If a future legitimate need arises for a genuinely different origin to call the API
  directly from a browser (e.g. a separate admin tool on a different subdomain), this
  decision must be revisited — that would need an explicit, narrow CORS allowlist, not
  a broad `origin: true`.

## Alternatives Considered

- **Add a permissive `cors()` middleware** — rejected: strictly weakens the current
  posture (opens the API to cross-origin browser calls it doesn't need to accept) for
  no functional gain, since nothing cross-origin needs to call it today.
- **Add a `cors()` middleware scoped to the exact prod origin** — redundant: same-origin
  deployment already achieves this with zero configuration; an explicit allowlist would
  just be a second place the origin string could drift from `infra/prod/nginx.conf`.

## Related ADRs

- ADR-0011 (API versioning strategy) — the same `/api/v2` surface this ADR describes.
