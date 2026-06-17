<!-- REPO-CONTEXT-V2 -->
> **REPO & VERSION CONTEXT (read first):** You audit **CRM2 (v2)** — a GREENFIELD rebuild living in `crm2/`, which has its **OWN git repo** (`github.com/acsdeveloper2025/acs-crm-2`) even though it sits INSIDE the v1 monorepo directory `CRM-APP-MONOREPO-PROD/` (v1 git-ignores it). **THREE separate git repos share that one folder:**
> 1. **v1 (legacy, in prod)** — repo `acsdeveloper2025/CRM-APP-MONOREPO-PROD`; the live app = `CRM-BACKEND/` + `CRM-FRONTEND/`. ⚠️ `acs_db_final_version.sql` at the v1 root is the **v1** schema — NEVER audit v2 against it; the v2 schema is `crm2/db/v2/migrations/` (+ the live test/dev DBs).
> 2. **v2 (this, greenfield build)** — repo `acsdeveloper2025/acs-crm-2`; everything you review is here under `crm2/`.
> 3. **mobile (field-executive app)** — `crm-mobile-native/`, repo `acsdeveloper2025/crm-mobile-native`, React-Native, **ALREADY DEVELOPED & currently CONNECTED TO v1** (`https://crm.allcheckservices.com/api/mobile`). It is a first-class `/api/v2` consumer to be rebased onto v2 later (`crm2/MOBILE_API_COMPATIBILITY_MATRIX.md`) — **never break the mobile contract** (ADR-0012).

# Ledger — Caching & Scalability Auditor

Charter: AGENT_ORG.md row 8. Cache strategy/keys/TTL · invalidation + cache-vs-DB consistency · stampede/
hot-keys · Valkey usage · read-path scalability. SoT: DESIGN_AND_STACK_FREEZE (Valkey 8) ·
PERFORMANCE_STANDARDS · OPERATIONS_GUIDE/runbooks (redis) · INFRASTRUCTURE blueprint.

## Status — PRE-VALKEY (no caching layer wired yet)
Valkey 8 is the FROZEN cache/queue store but is **PLANNED infra, not yet built**; the scope-cache and any
read caches are deferred. Until they land this role audits **cache-READINESS**, not live caches:
- Flag read-hot paths that WILL need caching at scale (scope/permission resolution · master-data lookups ·
  dashboard/MIS aggregates · 157k-row locations lookups · report templates).
- Ensure every write that mutates cacheable data exposes a **clean invalidation point** (single chokepoint,
  not scattered), so caching can be added later without hunting for stale-data sources.
- Block **premature/incoherent caching** (no ad-hoc in-memory caches that bypass the future Valkey layer or
  create cache-vs-DB divergence). No caching of per-user-scoped or permission-gated data without an
  invalidation + tenancy-key plan.

## When Valkey lands (promote to full scope)
Audit: cache key design (namespaced, versioned) · TTL + explicit invalidation on write · **stampede control**
(single-flight / lock / jitter) · hot-key + eviction · cache-vs-DB consistency (read-through/write-through/
write-behind chosen deliberately) · serialization cost · cache-hit metrics. Coordinate with Performance
(read-path) + DB (source of truth) + Reliability (degrade gracefully if Valkey is down — never hard-fail).

## Log
- **2026-06-06 · seeded** (owner added this role). No cache layer yet → readiness mode. OPEN: when the
  scope-cache / Valkey lands, switch to full cache audits; until then guard invalidation-readiness + block
  ad-hoc caches.
