-- 0068_policy_acceptance.sql — Login policy acceptance (ADR-0043).
-- Admin-managed, versioned policies; every user must accept all active+effective policies before
-- the app loads (server-driven gate: login returns mustAcceptPolicies, refresh re-checks). Mirrors
-- the mustChangePassword gate. Forward-only, idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS policies (
    id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            varchar(50)  NOT NULL,
    name            varchar(150) NOT NULL,
    description     text,
    content         text         NOT NULL,
    content_version integer      NOT NULL DEFAULT 1,
    is_active       boolean      NOT NULL DEFAULT false,
    effective_from  timestamptz  NOT NULL DEFAULT now(),
    version         integer      NOT NULL DEFAULT 1,
    created_by      uuid,
    updated_by      uuid,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_policies_code CHECK (code ~ '^[A-Z][A-Z0-9_]*$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_policies_code_active ON policies (code) WHERE is_active;

CREATE TABLE IF NOT EXISTS policy_acceptances (
    id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         uuid    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    policy_id       integer NOT NULL REFERENCES policies (id) ON DELETE RESTRICT,
    content_version integer NOT NULL,
    ip              inet,
    user_agent      text,
    source          varchar(10) NOT NULL DEFAULT 'WEB' CHECK (source IN ('WEB','MOBILE')),
    accepted_at     timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_policy_acceptances_user ON policy_acceptances (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_acceptances_user_policy_ver
    ON policy_acceptances (user_id, policy_id, content_version);

-- Policy administration is SUPER_ADMIN-only (grants_all covers page.policies + policy.manage),
-- so there is NO explicit role_permissions seed — this keeps DB↔code role/permission parity (ADR-0022).

INSERT INTO policies (code, name, description, content, content_version, is_active)
SELECT 'FIELD_EXEC_ACKNOWLEDGEMENT',
       'Field Executive Acknowledgement',
       'Code of conduct, anti-bribery, confidentiality, data & location consent (DPDP).',
       $policy$ALL CHECK SERVICES — FIELD EXECUTIVE ACKNOWLEDGEMENT
Last updated: May 2026 · Policy version: 1

By tapping "I Accept" below, you confirm you have read and agree to the following terms as a condition of using this application for verification work assigned by All Check Services LLP ("ACS", "we", "us", "the company").

────────────────────────────────────────
1. CODE OF CONDUCT
────────────────────────────────────────
You agree to:
- Conduct every verification visit professionally — wear your ID badge, identify yourself as an ACS field executive, and treat applicants, neighbours, and third parties with courtesy.
- Report only what you personally verified. Do not fabricate visit outcomes, photos, GPS positions, addresses, or signatures.
- Arrive at the assigned site, not a substitute. Substitute-address verifications, "phone-only" verifications, or photo capture from a different location are misconduct and grounds for termination.
- Follow safety protocols. Do not take risks for a verification (entering unsafe premises, confronting hostile persons, driving unsafely). Escalate to your reporting officer instead.

────────────────────────────────────────
2. ANTI-BRIBERY AND CORRUPTION (ZERO TOLERANCE)
────────────────────────────────────────
ACS operates on a STRICT zero-tolerance policy on bribery and corruption. You agree to:

- NEVER accept any gift, cash, payment, favour, hospitality, entertainment, gift card, or anything of value — from an applicant, applicant's family, neighbour, employer, intermediary, agent, broker, DSA, or any other party connected to a verification.
- NEVER demand, request, suggest, or hint at any payment, favour, or benefit in exchange for a positive verification outcome, faster service, or any other action.
- NEVER pay a bribe yourself to obtain access to a premises, secure cooperation, or any other purpose. Use only legitimate means.
- NEVER act as an intermediary for a bribe being offered to or by another person.
- IMMEDIATELY report any bribe offer, demand, or attempt — whether directed at you or witnessed — to your reporting officer and to ethics@allcheckservices.com. Failure to report is itself a violation of this policy.

Violations of this clause result in immediate termination, recovery of any benefit received, and reporting to law enforcement and to the affected client (bank / NBFC / employer). Anti-bribery law (Prevention of Corruption Act, 1988; Indian Penal Code §§ 161–171; Bharatiya Nyaya Sanhita 2023) may apply.

────────────────────────────────────────
3. FITNESS FOR DUTY — NO INTOXICATION
────────────────────────────────────────
You agree:
- NOT to perform any verification work while under the influence of alcohol, recreational drugs, or any substance (including prescription medication that impairs judgement, motor function, or reaction time).
- NOT to consume alcohol or drugs during your shift hours, or before a shift in a way that leaves you impaired during the shift.
- NOT to carry, store, or transport alcohol, illegal drugs, or intoxicants while on company business.
- To declare to your reporting officer if a prescribed medication may affect your fitness for fieldwork, so a substitute or schedule adjustment can be arranged.
- To submit to a reasonable-suspicion test if a supervisor observes signs of impairment (visible intoxication, accident, customer complaint).

Working under the influence endangers the agent, the applicant, the public, and the integrity of every verification report produced that day. Violations result in disciplinary action up to and including termination.

────────────────────────────────────────
4. CONFIDENTIALITY / NON-DISCLOSURE
────────────────────────────────────────
All data you handle through this app — applicant names, addresses, phone numbers, identity documents, photos, family details, financial documents, employer information, business records, and any client (bank / NBFC / employer / merchant) information — is CONFIDENTIAL.

You agree:
- NOT to share, copy, screenshot, forward, post, or transmit any case data outside the app — via WhatsApp, email, social media, printouts, or any other channel.
- NOT to discuss case details with any person who is not an authorised ACS team member working on that same case.
- NOT to disclose the identity of ACS's clients (banks, NBFCs, employers) or the existence of a verification request to anyone outside ACS.
- NOT to use any applicant/client data for personal purposes (telephoning applicants for unrelated reasons, soliciting business, cross-selling, etc.).

This confidentiality obligation continues after your employment ends.

────────────────────────────────────────
5. NO CLIENT DATA SHARING
────────────────────────────────────────
Verification reports, applicant information, and client identities are the property of ACS and our clients. You may NOT:
- Share verification reports, applicant photos, or case data with unauthorised internal staff, family, friends, competitors, or any external party.
- Take screenshots of case data, even for "personal reference".
- Save case data on personal cloud drives, external SD cards, or any storage outside this app.

Photos captured for verifications are evidence; they belong to ACS and the requesting client.

────────────────────────────────────────
6. DEVICE SECURITY
────────────────────────────────────────
You agree:
- NOT to share your login credentials with any other person.
- NOT to install a sideloaded / modified / unofficial version of this app. Only install from the official channel provided by ACS.
- To use a screen lock (PIN / fingerprint / pattern) on the device you use for ACS work.
- To report a lost or stolen device to your reporting officer immediately so we can revoke access.

────────────────────────────────────────
7. DATA WE COLLECT AND HOW WE USE IT
────────────────────────────────────────
We collect:
- Account identity: name, employee ID, phone, designation, email.
- Verification activity: tasks accepted, photos captured, forms submitted, the GPS location at the moment of each photo capture.
- Live location: when an admin requests your current location during shift hours (typically 8:00 AM – 10:00 PM IST), the app captures one GPS fix silently and sends it to ACS. This is for shift monitoring, safety, and dispute resolution. It does NOT run continuously in the background.
- Device diagnostics: device model, OS version, app version, crash logs — used only to fix app issues.

We use it ONLY for:
- Assigning verification tasks to you.
- Producing verification reports for our clients.
- Computing commissions and payouts.
- Diagnosing app and network issues.
- Investigating misconduct or compliance disputes.

We do NOT sell your data. We do NOT share it with parties outside the ACS verification workflow.

────────────────────────────────────────
8. LIVE LOCATION MONITORING
────────────────────────────────────────
During your assigned shift window (default 8:00 AM – 10:00 PM IST), an authorised ACS supervisor may trigger an on-demand GPS check from the admin dashboard. When this happens:
- The app captures one GPS reading and sends it to ACS silently.
- You will not see a separate alert or banner on your phone for each check (it is silent by design, to keep the live map accurate).
- Outside the shift window, on-demand checks are disabled.
- You can review the full history of when your location was requested by emailing support@allcheckservices.com.

────────────────────────────────────────
9. YOUR RIGHTS (Digital Personal Data Protection Act, 2023)
────────────────────────────────────────
You can:
- Request access to your personal data on file.
- Request correction of inaccurate data.
- Request deletion of your account and data (subject to legal retention obligations for verification reports already delivered to our clients).
- Withdraw this consent (note: withdrawal means you cannot continue working through this app).

To exercise any right, email support@allcheckservices.com or use Profile → Privacy Policy in the app.

────────────────────────────────────────
10. DISCIPLINARY CONSEQUENCES
────────────────────────────────────────
Violations of these terms — falsified verifications, accepted bribes, working under the influence, confidentiality breaches, sharing client data externally, or operational misconduct — may result in disciplinary action up to and including termination, recovery of damages, and legal action where applicable. ACS maintains an audit trail of app activity (logins, photos, GPS, form submissions, consent timestamps) which may be used in any such proceeding.

────────────────────────────────────────

By tapping "I Accept", you confirm that you have read and agreed to all 10 sections above. Your acceptance, the time of acceptance, your device's identifying information, and the policy version are recorded by ACS for compliance and audit purposes.

If you do not agree, please close this app and contact your reporting officer or support@allcheckservices.com.
$policy$,
       1, true
WHERE NOT EXISTS (SELECT 1 FROM policies WHERE code = 'FIELD_EXEC_ACKNOWLEDGEMENT');

COMMIT;
