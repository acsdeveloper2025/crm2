-- 0117_field_exec_ack_v2.sql — Sync the FIELD_EXEC_ACKNOWLEDGEMENT policy to version 2 (ADR-0043).
--
-- The mobile app (crm-mobile-native) shipped consent v2
-- (PrivacyConsentService.CURRENT_PRIVACY_POLICY_VERSION = 2 — a material §7/§8 live-location
-- disclosure change) and records acceptance as policy_version = 2. The server policy row was still
-- content_version = 1 (seeded by 0073), so the refresh gate `pendingPoliciesForUser`
-- (consents.policy_version = policies.content_version) NEVER matched a v2 consent → every field-agent
-- POST /auth/refresh hit the ADR-0043 pending-policy gate and returned 401 → the app, unable to refresh
-- its 15-min access token, fell back to a full re-login roughly every ~15 min.
--
-- This bumps the server policy content + version to 2 so existing v2 consents satisfy the gate.
--
-- BLAST RADIUS: the ADR-0043 acceptance gate is GLOBAL (not role-scoped), so a naive bump also makes
-- pending every user who accepted v1 — including office/admin users who accepted this field
-- acknowledgement at web login (on prod: 3 — BACKEND_USER, TEAM_LEADER, SUPER_ADMIN). The material
-- change in v2 is §7/§8 field live-location, which does NOT apply to office/admin work. So this
-- migration also CARRIES FORWARD their existing v1 acceptance to v2 (the INSERT below), so they are
-- NOT re-prompted. FIELD roles are deliberately EXCLUDED from the carry-forward: any field worker on an
-- old (v1) app must re-accept v2 in-app so they actually see the §8 change (their app records v2). Net:
-- field agents already on v2 keep working; office/admin users are untouched; old-app field workers
-- re-consent in-app. Data-only, forward, idempotent (bump guarded on content_version < 2; carry-forward
-- guarded by the unique (user_id, policy_version) constraint).
-- FOLLOW-UP (separate ADR): role-scope this field acknowledgement so office users aren't gated by it at all.
--
-- INVARIANT: this text must stay byte-for-byte in lockstep with
-- crm-mobile-native/src/constants/fieldExecutiveAcknowledgement.ts (the app displays that copy; this is
-- the audit master). Any future material edit there must bump CURRENT_PRIVACY_POLICY_VERSION AND ship a
-- matching policies migration here, or field-agent refresh breaks again.

BEGIN;

UPDATE policies
   SET content = $policy$ALL CHECK SERVICES — FIELD EXECUTIVE ACKNOWLEDGEMENT
Last updated: May 2026 · Policy version: 2

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
- Live location: during your shift window (typically 8:00 AM – 10:00 PM IST), while the ACS app is open on your screen, the app records your GPS location periodically (about once every minute or two) so your supervisor can see your last known position on the live map. The app also records your location when you capture a verification photo, submit a form, or when an admin requests an on-demand check. This is for shift monitoring, safety, and dispute resolution. The app does NOT track your location in the background when the app is closed or minimised, and does NOT record outside your shift window.
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
During your assigned shift window (default 8:00 AM – 10:00 PM IST), ACS maintains a live map of field executives' last known locations. While you are working:
- While the app is open on your screen, your location is recorded periodically (about once every minute or two) and sent to ACS to keep your position on the map current.
- An authorised ACS supervisor may also trigger an on-demand GPS check; the app captures one reading and sends it silently.
- Location recording is silent by design (no per-update banner), to keep the live map accurate.
- The app does NOT record your location when it is closed or running in the background, and does NOT record outside your shift window.
- You can review the history of your recorded locations by emailing support@allcheckservices.com.

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
       content_version = 2,
       updated_at = now()
 WHERE code = 'FIELD_EXEC_ACKNOWLEDGEMENT'
   AND content_version < 2;

-- Carry existing v1 acceptances forward to v2 for NON-field users only, so the bump doesn't re-prompt
-- office/admin users who already accepted (the §8 field-location change is N/A to them). Field roles
-- (FIELD%) are excluded on purpose — they must re-accept v2 in-app to see the change. No-op on a fresh
-- DB (no v1 consents) and on re-run (unique constraint).
INSERT INTO consents (user_id, policy_version)
SELECT DISTINCT u.id, 2
  FROM users u
 WHERE u.role NOT LIKE 'FIELD%'
   AND EXISTS (SELECT 1 FROM consents c WHERE c.user_id = u.id AND c.policy_version = 1)
ON CONFLICT ON CONSTRAINT uq_consents_user_version DO NOTHING;

COMMIT;
