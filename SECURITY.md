# Security Policy

CRM2 is a private application. **Do not open public issues for security problems.**

## Reporting a vulnerability
Email **Mayur Kulkarni — `mayurkulkarni786@gmail.com`** with details and reproduction steps. You'll get an acknowledgement and a remediation timeline.

## Where security lives in this repo
- **Governance & cadence:** [docs/security/SECURITY_STANDARDS.md](docs/security/SECURITY_STANDARDS.md)
- **Practitioner guide:** [docs/security/SECURITY_GUIDE.md](docs/security/SECURITY_GUIDE.md)
- **Data retention / DPDP:** [docs/security/DATA_RETENTION_POLICY.md](docs/security/DATA_RETENTION_POLICY.md)

## Secret handling
Secrets live **only** in `secrets/` or `.env` — both gitignored. Never commit a credential. Secret scanning is enforced in CI via `.gitleaks.toml`; service-account / certificate patterns are gitignored as defense-in-depth.
