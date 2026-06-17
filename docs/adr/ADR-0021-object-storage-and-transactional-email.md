# ADR-0021: Object storage (S3) and transactional email (SMTP)

- **Status:** Accepted
- **Date:** 2026-06-10

## Context

The User-Management parity epic introduces two capabilities that the platform had no
infrastructure for:

1. **Profile photos** (epic decision A) must be stored in an object store (AWS S3), not in
   Postgres — binary blobs do not belong in the relational store, and a banking CRM needs an
   auditable, lifecycle-managed bucket.
2. **Transactional email** (epic decision B) — emailing admin-minted one-time passwords and
   password resets — needs an SMTP path. v2 has had no mail capability.

Both are **owner-classified "plan for later"**: the code ships now, but the bucket, credentials,
and SMTP host are provisioned as a separate deploy step. Until that infrastructure exists, the
features must be **inert and safe**, never half-working.

Building either against the platform/stdlib is not viable: a correct S3 client (SigV4 signing,
presigned URLs, retries) and a correct SMTP client (TLS, auth, MIME) are exactly the kind of
audited, zero-business-logic libraries the dependency policy says to *reuse over hand-roll* (the
same reasoning that admitted `jose` for JWT and `exceljs` for XLSX).

## Decision

We will add two new backend runtime dependencies and stand up two platform capabilities behind
**provider interfaces with config-gated activation**:

- **Object storage** — `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, wrapped by a
  `StorageProvider` interface in `apps/api/src/platform/storage/`. A factory `getStorage()`
  returns the real `S3Storage` only when `STORAGE_BACKEND='s3'` (or `'minio'`) **and** the
  `S3_*` env is present; otherwise it returns a **disabled provider** that throws a structured
  `STORAGE_NOT_CONFIGURED` (503) on use. The AWS SDK is **lazy-imported** inside `S3Storage` so an
  unconfigured deployment never loads it.
- **Transactional email** — `nodemailer`, wrapped by a `Mailer` interface in
  `apps/api/src/platform/mail/`. A factory `getMailer()` returns the real `SmtpMailer` only
  when `SMTP_HOST` is set; otherwise a **disabled mailer** that logs-and-skips (send is always
  best-effort — a mail failure must never block the request that triggered it).

Both providers are **injectable** (`setStorage`/`setMailer`, mirroring `setPool`) so tests run
against fakes with no live AWS/SMTP. Every install is recorded in `ALLOWED_DEPENDENCIES.md`.

## Consequences

### Positive

- Profile-photo binaries leave Postgres; the DB stores only an opaque object key.
- Email and storage each have ONE seam — callers depend on the interface, not the SDK.
- Deferred activation is explicit and safe: unconfigured = a clean 503 / logged skip, never a 500.
- Real, audited SDKs (correct signing, TLS, presigning) rather than hand-rolled crypto/protocol.

### Negative

- Two more dependencies to keep patched (`@aws-sdk/*`, `nodemailer`). Both are write-only from our
  side and parse no untrusted input beyond their own responses; the AWS SDK tree is large but
  lazy-loaded.
- Provider factories add a small indirection over calling an SDK directly.

## Alternatives Considered

- **Stub-only interfaces (no real deps yet)** — rejected by the owner: they wanted the real S3/SMTP
  implementation written now, with only the credentials deferred.
- **Store photos as `bytea` in Postgres** — rejected: bloats the DB/backups, no CDN/lifecycle, and
  contradicts the object-store decision baked into `STORAGE_BACKEND` since day 1.
- **A managed email API (SES/SendGrid SDK)** — rejected for now: SMTP is provider-agnostic and the
  deploy target's mail relay is undecided; `nodemailer` speaks to any of them (incl. SES SMTP).

## Related ADRs

- ADR-0011 — additive `/api/v2` evolution (the photo endpoints are additive).
- ADR-0014 — auth (the one-time-password flow these emails carry).
