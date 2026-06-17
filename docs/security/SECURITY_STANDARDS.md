# Security Standards (Part 8 — Governance & Process)

CRM2 — banking RCU/KYC CRM. Architecture FROZEN. This document defines
the **scheduled, periodic security governance** that keeps the system safe over
time. For how to build securely day-to-day, see `SECURITY_GUIDE.md`.

## 1. Security Model (ground truth)

- **6 roles**: `SUPER_ADMIN`, `MANAGER`, `TEAM_LEADER`, `BACKEND_USER`,
  `FIELD_AGENT`, `KYC_VERIFIER`. Authorization is **permission-code-driven**
  via `@crm2/access` — routes assert `authorize(perm)`, never a role literal.
- **Default-deny scope**: every list/read is scoped to the caller's hierarchy.
  If scope is **indeterminable**, access is **denied** (fail-closed). Scope is
  recursive: MANAGER sees its whole subtree, TEAM_LEADER its direct team,
  BACKEND_USER/FIELD_AGENT self/territory, KYC_VERIFIER read-only.
- **Audit**: append-only, **hash-chained** (each row links the prior hash via an
  HMAC), partitioned **monthly**. Tampering breaks the chain and is detectable.
- **PII / DPDP**: columns flagged `pii_sensitive`; consent, retention, and
  legal-hold tracked. PII is masked in logs and on serve unless authorized.
- **AuthN**: JWT stateless access tokens + refresh tokens with a **denylist**
  (revocation on logout/rotation).
- **Evidence**: object store, served only via **signed URLs** (no raw paths).
- **Secrets in CI**: `gitleaks` scan (`.gitleaks.toml`); dependency additions
  gated by `ALLOWED_DEPENDENCIES.md`.

## 2. Threat Classes To Keep Closed

| Threat | Primary control |
|---|---|
| Cross-tenant leak | Recursive default-deny scope; deny if indeterminable |
| IDOR | Record-level access check on every detail route |
| Privilege escalation | Permission codes only; quarterly RBAC review |
| Evidence tampering | Hash-chained audit; signed-URL serve; immutable store |
| PII exposure | `pii_sensitive` masking; DPDP consent/retention/legal-hold |
| Injection | Parameterized SQL only (no string interpolation, ever) |

## 3. Governance Controls

**Dependency review** — Audit installed deps for known CVEs. Tool: `npm audit`
(blocking on high/critical in CI) + **PLANNED** scheduled `OSV-Scanner` run.
New deps must be pre-approved in `ALLOWED_DEPENDENCIES.md`.

**Vulnerability scanning** — Three layers, all **PLANNED** as scheduled jobs:
SAST over source, dependency CVE scan, and container image scan. Findings
triaged by severity; high/critical block release.

**Secret rotation** — Secrets **never** live in git; they live in env / secret
store. Rotate on cadence and immediately on suspected compromise:
- JWT signing secret — rotate with overlap window (accept old + new during
  grace), then revoke; refresh denylist absorbs in-flight tokens.
- DB credentials — rotate via secret store; rolling app restart.
- Audit HMAC key — versioned key; chain records which key version signed them
  so old segments stay verifiable after rotation.
- Object-store access keys — rotate; signed URLs are short-lived so blast radius
  is bounded.

**RBAC review (quarterly)** — Audit the role→permission map for **privilege
creep**. Every permission a role holds must trace to a documented need.

**Permission audit** — Verify **default-deny holds**: no list route lacks a
scope clause, no detail route lacks a record-level check. The app **refuses to
boot** if a route is registered without an authorize+scope declaration — this is
the enforcement, not a checklist.

**Access review (joiner/mover/leaver)** — On hire assign least-privilege role;
on role change re-baseline permissions and re-scope hierarchy; on exit revoke
sessions (refresh denylist) and disable the account same-day.

## 4. Cadence Table

| Control | Frequency | Owner |
|---|---|---|
| `gitleaks` secret scan | Every push (CI) | CI / Eng |
| `npm audit` dep gate | Every CI run | CI / Eng |
| OSV / SAST / container scan (PLANNED) | Weekly (scheduled) | Security Eng |
| Dependency review (`ALLOWED_DEPENDENCIES.md`) | Per PR + monthly sweep | Tech Lead |
| Secret rotation (JWT/DB/HMAC/object-store) | Quarterly + on compromise | Platform Owner |
| RBAC role→permission review | Quarterly | Security Owner |
| Permission/default-deny audit | Quarterly (+ boot-time enforced) | Security Eng |
| Access review (joiner/mover/leaver) | On event + quarterly recert | People Ops + Eng |
| Audit-chain integrity verification | Monthly (per partition) | Platform Owner |

## 5. Incident Response (summary)

On suspected breach: rotate affected secrets immediately, revoke sessions via
refresh denylist, verify audit hash-chain to scope the blast radius, preserve
the partition under legal-hold, and file a finding against the relevant control.

See also: `SECURITY_GUIDE.md`, `docs/CI_CD_STANDARDS.md`, `BUSINESS_RULES.md`.
