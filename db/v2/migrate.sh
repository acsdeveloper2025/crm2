#!/bin/sh
# =============================================================================
# CRM2 tracked migration runner.
#
# Applies ONLY migrations that are NEW or EDITED, recording each in the
# `schema_migrations` table (filename + checksum). This replaces the old
# every-deploy full replay, which forced every migration to be hand-written
# idempotent and made a late migration able to break an earlier one on re-run
# (the 0037 / 0083 trap). Now an unchanged migration is applied exactly once,
# ever; an edited one re-applies (checksum changed); a new one applies.
#
# Transition: on the FIRST run against an already-migrated database (table empty but the
# schema already exists) the runner BACKFILLS — records every current migration as applied
# WITHOUT re-running it — then tracks normally. We do NOT replay the full set, because a real
# database can hold data a later migration introduced that an earlier migration's re-run now
# rejects (e.g. a CASE_REPORT report_layout vs 0064's narrower kind CHECK, widened by 0066) —
# the very 0037/0083 hazard this change kills. A genuinely fresh database (no app tables) runs
# everything normally. NOTE: the deploy that introduces this runner must add NO new migration
# (the backfill would record it unrun) — ship the runner alone, add migrations afterwards.
#
# Checksum: POSIX `cksum` (crc+size) — present on alpine (prod), ubuntu (CI) and
# macOS (dev). It is only ever compared against THIS environment's own prior run,
# so cross-platform CRC agreement is irrelevant; only per-environment determinism
# matters, which cksum gives.
#
# Env:
#   DATABASE_URL     (required) target database
#   MIGRATIONS_DIR   (default db/v2/migrations)
#   SEED_DIR         (default db/v2/seed) — idempotent data seeds, run if present
# =============================================================================
set -eu

: "${DATABASE_URL:?DATABASE_URL required}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-db/v2/migrations}"
SEED_DIR="${SEED_DIR:-db/v2/seed}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE IF NOT EXISTS schema_migrations (
     filename   text PRIMARY KEY,
     checksum   text NOT NULL,
     applied_at timestamptz NOT NULL DEFAULT now()
   );"

# One-time transition: empty tracking table on a DB that ALREADY has application tables ⇒ this is
# an existing/migrated database. Record the current set as applied WITHOUT replaying it (see header).
tracked=$(psql "$DATABASE_URL" -tAq -c "SELECT count(*) FROM schema_migrations;")
existing=$(psql "$DATABASE_URL" -tAq -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'schema_migrations';")
if [ "$tracked" = "0" ] && [ "$existing" -gt 0 ]; then
  echo "migrate: existing database — backfilling schema_migrations as applied (no replay)"
  for f in "$MIGRATIONS_DIR"/*.sql; do
    [ -e "$f" ] || continue
    name=$(basename "$f")
    sum=$(cksum < "$f")
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
      "INSERT INTO schema_migrations (filename, checksum) VALUES ('$name', '$sum')
         ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now();"
  done
fi

applied=0
skipped=0
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ -e "$f" ] || continue                       # empty dir → the glob stays literal
  name=$(basename "$f")
  sum=$(cksum < "$f")                            # "crc octets" — stable per environment
  cur=$(psql "$DATABASE_URL" -tAq -c \
    "SELECT checksum FROM schema_migrations WHERE filename = '$name';")
  if [ "$cur" = "$sum" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  if [ -n "$cur" ]; then
    echo "migrate: re-apply (edited) $name"
  else
    echo "migrate: apply $name"
  fi
  # Each .sql is its own BEGIN;…COMMIT;. Record AFTER a clean apply: a crash between
  # the two leaves the row unrecorded, so the next run re-applies (idempotent → safe).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
    "INSERT INTO schema_migrations (filename, checksum) VALUES ('$name', '$sum')
       ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now();"
  applied=$((applied + 1))
done
echo "migrate: $applied applied, $skipped skipped"

# Data seeds are idempotent (ON CONFLICT) and run every deploy as before — they are
# data, not schema, and are not part of the new/edited tracking.
if [ -f "$SEED_DIR/verification_units.seed.sql" ]; then
  echo "seed: verification_units"
  psql "$DATABASE_URL" -q -f "$SEED_DIR/verification_units.seed.sql" || echo "  (seed warn)"
fi
if [ -f "$SEED_DIR/locations.seed.sql" ]; then
  echo "seed: locations (157k pincodes)"
  psql "$DATABASE_URL" -q -f "$SEED_DIR/locations.seed.sql" || echo "  (seed warn)"
fi
echo "migrate: done"
