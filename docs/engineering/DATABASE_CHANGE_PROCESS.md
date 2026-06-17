# Part 5 — Database Change Process

CRM2 · PostgreSQL 17 (PG18 deferred) · raw `pg`, **no Prisma/ORM** · architecture FROZEN.

Cross-ref: [`docs/ENGINEERING_STANDARDS.md`](../ENGINEERING_STANDARDS.md) (data-access) · [`db/v2/BUILD_GATE_REGISTRY_LOCK.md`](../../db/v2/BUILD_GATE_REGISTRY_LOCK.md) · [`docs/CI_CD_STANDARDS.md`](../CI_CD_STANDARDS.md).

## Hard rule

- **NO direct schema edits on any DB (local, CI, prod).** All DDL flows through migrations only.
- Schema changes live ONLY in ordered, forward-only, idempotent SQL files: `db/v2/migrations/NNNN_<name>.sql`.
- **Never edit a merged migration.** A merged file is immutable history — write a new `NNNN+1` migration to change it.
- Reporting changes (views/matviews) are DDL too: define `v_`/`mv_` in migrations, read via view repositories.

## How migrations run

- Ephemeral test harness (`packages/test-utils/src/helpers/testDb.ts`) applies all migrations top-to-bottom on a fresh DB.
- CI re-applies the full set **twice** (idempotency gate, Part 22) on a `postgres:17` service.
- Forward-only: no down-migrations; rollback = a new compensating forward migration.

## Per-change checklist (all required)

- **DDL review** — naming (`snake_case`, plural tables, `idx_`/`uq_`/`fk_`/`v_`/`mv_`/`trg_`/`fn_`, `timestamptz` UTC), soft-delete (`deleted_at`/`deleted_by`), audit append-only/hash-chained intact.
- **Impact review** — readers/writers, FK/CHECK/trigger fan-out, range partitions (tasks, reports, attachments, audit, notifications, commission), matview dependencies.
- **Migration review** — forward-only, idempotent, reversible OR rollback path documented in the file header.
- **Performance review** — indexes present, `EXPLAIN` on hot paths, lock impact, partition pruning preserved.
- **Backfill plan** — any NOT NULL / new default on a large table needs a staged backfill (no blocking table rewrite).
- **Matview re-create** — if a base column an `mv_` depends on changes, drop+recreate the matview in the same migration.

## Authoring rules

- **Idempotent**: `CREATE ... IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, guarded `DO $$` blocks for constraints/enums.
- **Additive-first**: add columns/tables/indexes; never repurpose an existing column.
- **No destructive change** (DROP / type-narrow / NOT NULL on populated col / rename) without an explicit, approved, separate step.
- **Expand → migrate → contract** for column changes: add new col → backfill + dual-write → switch readers → drop old col in a later migration.
- **Online-safe indexes**: prefer `CREATE INDEX CONCURRENTLY` on populated tables (note: must run outside a transaction — keep such DDL in its own migration).
- Partitioned tables: create the parent + indexes; partition maintenance (monthly) is automated, not hand-rolled per migration.

## Test requirements (CI-enforced)

- Applies clean on an empty DB (full top-to-bottom).
- Idempotent on re-apply (CI runs the set twice — must succeed both times).
- Constraint tests: bad rows are **rejected** (CHECK / FK / unique / NOT NULL) and good rows accepted.

## Approval

- **CTO sign-off required before merge** (CTO_RULES gate). No migration merges without it.
- Reviewer confirms the per-change checklist above is complete and the BUILD_GATE_REGISTRY_LOCK is honored.
