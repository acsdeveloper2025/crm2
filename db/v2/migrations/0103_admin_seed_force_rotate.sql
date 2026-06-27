-- 0103_admin_seed_force_rotate.sql — ADR-0076 (SEC-12). Force the bootstrap SUPER_ADMIN to rotate its
-- seeded password on first login. The 0009 seed sets admin's password to the publicly-known 'admin123'
-- (scrypt) so fresh dev/test/bootstrap DBs can log in; this flips password_must_change so a fresh prod
-- can never keep serving on that known credential. GATED on the exact seed hash: an admin that has
-- already rotated to a real password (e.g. live prod) carries a DIFFERENT hash → matched by nothing →
-- untouched. Forward-only, idempotent, re-run-safe (a no-op the moment the admin rotates). UPDATE-only
-- (row lock, no ACCESS EXCLUSIVE) → no lock-retry preamble needed.

BEGIN;

UPDATE users
SET password_must_change = true
WHERE username = 'admin'
  AND password_hash = 'scrypt$16384$8$1$J3hE0MvXk7dDKqKGoSAk1w$kFNxLixr0LaM1AOmQYOai9Y9YHTzZAhKH8UwGKKyZAI';

COMMIT;
