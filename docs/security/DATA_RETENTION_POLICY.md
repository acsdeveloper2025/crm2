# DATA_RETENTION_POLICY.md (Part 7)

CRM2 data-retention & disposal policy. Architecture is **FROZEN** (see
`CRM2_MASTER_MEMORY.md`). Process/policy level. Enforcement automation is
marked **PLANNED**.

## Ground truth
- **DPDP / PII:** verification units flagged `pii_sensitive` (IDENTITY /
  FINANCIAL); `consent`, `retention`, `legal_hold` columns exist **day-1**.
- **Audit log:** append-only, hash-chained, partitioned **monthly**.
- **Evidence images:** §65B-style **sha256** integrity; immutable object store.
- **Financial / commission records:** immutable, append-only.

## Retention schedule
*All periods are **defensible defaults for an Indian banking RCU vendor** and
**MUST be ratified with the client/bank contract + RBI/DPDP counsel**.*

| Entity | Retention (default) | Basis | Disposal method | Legal-hold override |
|---|---|---|---|---|
| Verification reports | 8–10 yrs | Bank contract / RBI record-keeping | Soft-delete → purge after window | Yes — suspends purge |
| Audit logs | 8–10 yrs | Regulatory / forensic | Partition drop (hash-chain preserved) after window | Yes |
| Evidence images / attachments | **Per bank contract** (min report life) | Evidentiary (§65B) | Object-store delete + version expiry | Yes |
| Billing records | 8–10 yrs | Financial / tax (GST) | Immutable; purge only post-window | Yes |
| Commission records | 8–10 yrs | Financial reconciliation | Immutable; purge only post-window | Yes |
| System / application logs | 90–180 d | Operational / security triage | Rotate + delete | Yes |
| Notifications | 90–180 d | Operational | Delete | Yes |
| PII (consent-bound) | Bound to consent + parent-entity life | DPDP (purpose limitation) | Purge / anonymise on consent withdrawal or expiry | Yes |
| Soft-deleted rows | 30–90 d purge window | Cleanup / recoverability | Hard-delete after window | Yes |

## Rules
- **Legal hold suspends disposal.** While `legal_hold` is set on a record (or its
  parent case), no purge/anonymise/expiry runs regardless of retention period.
- **Disposal is logged + audited.** Every purge/anonymise writes an audit-log
  entry (actor=system, what, count, basis); audit entries themselves are
  retained per the audit row above.
- **Immutability respected.** Financial, commission, audit, and evidence records
  are never edited — disposal is whole-record removal **only after** the
  retention window **and** no legal hold.
- **Consent-driven PII:** withdrawal of consent triggers purge/anonymise of
  `pii_sensitive` data not otherwise held by a longer legal/financial basis.
- **Enforcement:** a **scheduled purge job (PLANNED)** evaluates retention +
  legal-hold per entity and performs logged disposal. Until it lands, retention
  is **policy-only** (no automated deletion).

## Cross-references
- `SECURITY_STANDARDS.md` — PII classification, consent model, access control.
- `DISASTER_RECOVERY.md` — backup retention must not outlive disposal windows;
  legal-hold records must survive restore.
