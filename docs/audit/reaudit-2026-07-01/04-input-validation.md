# RE-AUDIT 04: Input Validation

Re-audit of area 04 against current HEAD (`8ded432`), baseline `b19039e`. Read-only static inspection.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| INPUT_VALIDATION-01 (safeDecodeURIComponent) | CONFIRMED_FIXED | `apps/api/src/platform/http.ts:25-31` (try/catch → raw fallback). Both documented call sites present: `apps/api/src/http/refreshCookie.ts:37`, `apps/api/src/modules/cases/controller.ts:424`. Grep confirms zero remaining raw `decodeURIComponent` in any `src` tree except the wrapped one. Diff `b19039e..8ded432` shows the function is net-new. |
| INPUT_VALIDATION-02 (page ceiling) | CONFIRMED_FIXED | `apps/api/src/platform/pagination.ts:162` `MAX_PAGE = 1_000_000`; `:166` throws `AppError.badRequest('PAGE_TOO_LARGE')` before `offset` is computed. Test-covered: `pagination.test.ts:78-88` (rejects `999999999`, accepts boundary `1000000`). Diff confirms `page` was previously unbounded. |
| INPUT_VALIDATION-03 (login/refresh `.max()`) | CONFIRMED_FIXED | `packages/sdk/src/auth.ts:14-15` username `.max(50)`, password `.max(200)`; `:30` `RefreshSchema` refreshToken `.max(2000)`. Diff shows these were bare `.min(1)` at baseline. |
| INPUT_VALIDATION-04 (applicants `.max(10)`) | CONFIRMED_FIXED | `packages/sdk/src/cases.ts:373` `applicants: z.array(applicantInput).min(1).max(10)`. Diff shows baseline was `.min(1)` only. |

All four map to HTTP 400: `AppError.badRequest` sets status 400 (`errors.ts:52`) and the middleware returns `res.status(err.status)` for `AppError` and 400 for `ZodError` (`http/app.ts:160-169`) — so none of these regress into a 500.

## New Findings

None.

Independent hunt performed:
- Whole-tree grep for `decodeURIComponent` — only the wrapped site remains; no other unguarded decode boundary.
- refreshToken `.max(2000)`: the token is a compact JWT with a `{userId, jti}` payload (`auth/service.ts:135`, `signRefreshToken`), ~150-300 chars — 2000 is generous headroom, no risk of rejecting a legitimate mobile/web refresh. Mobile body-contract preserved.
- applicants `.max(10)` (1 borrower + up to 9 co-applicants) is a realistic ceiling; the web create flow has no client cap but a server rejection surfaces as a clean 400 ZodError, not a crash — acceptable.
- Pagination `limit`/`page`/`sortBy`/filter paths re-read: sort column and filter columns are whitelisted before interpolation; all user values bound as parameters; `PAGE_TOO_LARGE`/`INVALID_LIMIT`/`LIMIT_TOO_LARGE` all resolve to 400. No new injection or DoS surface introduced by the remediation.

## Verdict

PASS.

All four claimed fixes are real, complete, and present at the cited file:line, with the pagination guard additionally covered by unit tests and every new guard correctly routed to an HTTP 400 rather than a generic 500. The remediation is surgical — a wrapped decode helper, a page ceiling, and four `.max()` bounds — and introduces no regression: the refresh-token and applicant caps are comfortably above real-world sizes, and no unguarded decode or unbounded-offset path remains. Zero new findings of any severity.
