-- 0101_user_tokens_valid_after.sql — ADR-0076 Phase 2. Access-token kill switch.
-- Access tokens are stateless 15-min JWTs (ADR-0014) with no server-side revocation: a stolen or
-- just-deactivated user's token stayed valid for its full TTL. This adds a per-user "valid-after"
-- cutoff: authenticate() rejects any access token whose `iat` is strictly before it. Set to now() on
-- every user-wide revoke (logout-all, password change, admin deactivation, refresh-reuse family
-- revoke). NULL = never revoked (the common case). Whole-second granularity (date_trunc in code) so a
-- token minted in the same second as a re-login is not self-killed. Forward-only, idempotent.
--
-- ADD COLUMN (nullable, no default) is a metadata-only change (no table rewrite), but it needs ACCESS
-- EXCLUSIVE on `users` — which the still-serving old api reads constantly during a rolling deploy. Take
-- the lock WITH A RETRY (same pattern as 0098) so the deploy never wedges behind those reads.

BEGIN;

DO $$
DECLARE attempts int := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '3s';
      LOCK TABLE users IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      attempts := attempts + 1;
      IF attempts >= 40 THEN
        RAISE EXCEPTION 'users: ACCESS EXCLUSIVE not acquired after % tries (old api still reading?)', attempts;
      END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_valid_after timestamptz;

COMMIT;
