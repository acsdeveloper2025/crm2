-- CRM2 — Verification Unit Registry seed (Build Step 1)
-- 9 FIELD_VISIT units (explicit) + 59 KYC_DOCUMENT units (one shared profile).
-- Idempotent: ON CONFLICT (code) DO NOTHING. Codes carried from v1 (verification_types, document_types).

BEGIN;

-- ===========================================================================
-- FIELD_VISIT units (9) — each has a bespoke form + narrative report template
-- ===========================================================================
INSERT INTO verification_units
  (code, name, category, kind, worker_role, assignment_method, required_form_code,
   required_photos, required_gps, required_attachments, billing_profile, commission_profile,
   report_template_type, reverification_rule, pii_sensitive, sort_order)
VALUES
  ('RESIDENCE',            'Residence Verification',            'FIELD','FIELD_VISIT','FIELD_AGENT','TERRITORY_AUTO','RESIDENCE_FORM',            5,true,'[]',  'AGENT_COMMISSION','FIELD_RATE','FIELD_NARRATIVE','REVISIT_PARENT_RATE', false, 1),
  ('OFFICE',               'Office Verification',               'FIELD','FIELD_VISIT','FIELD_AGENT','TERRITORY_AUTO','OFFICE_FORM',               5,true,'[]',  'AGENT_COMMISSION','FIELD_RATE','FIELD_NARRATIVE','REVISIT_PARENT_RATE', false, 2),
  ('RESIDENCE_CUM_OFFICE', 'Residence cum Office Verification', 'FIELD','FIELD_VISIT','FIELD_AGENT','TERRITORY_AUTO','RESIDENCE_CUM_OFFICE_FORM',  5,true,'[]',  'AGENT_COMMISSION','FIELD_RATE','FIELD_NARRATIVE','REVISIT_PARENT_RATE', false, 3),
  ('BUSINESS',             'Business Verification',             'FIELD','FIELD_VISIT','FIELD_AGENT','TERRITORY_AUTO','BUSINESS_FORM',             5,true,'[]',  'AGENT_COMMISSION','FIELD_RATE','FIELD_NARRATIVE','REVISIT_PARENT_RATE', false, 4),
  ('BUILDER',              'Builder Verification',              'FIELD','FIELD_VISIT','FIELD_AGENT','TERRITORY_AUTO','BUILDER_FORM',              5,true,'[]',  'AGENT_COMMISSION','FIELD_RATE','FIELD_NARRATIVE','REVISIT_PARENT_RATE', false, 5),
  ('NOC',                  'NOC Verification',                  'FIELD','FIELD_VISIT','FIELD_AGENT','TERRITORY_AUTO','NOC_FORM',                  5,true,'[]',  'AGENT_COMMISSION','FIELD_RATE','FIELD_NARRATIVE','REVISIT_PARENT_RATE', false, 6),
  ('DSA_CONNECTOR',        'DSA DST & Connector Verification',  'FIELD','FIELD_VISIT','FIELD_AGENT','TERRITORY_AUTO','DSA_CONNECTOR_FORM',        5,true,'[]',  'AGENT_COMMISSION','FIELD_RATE','FIELD_NARRATIVE','REVISIT_PARENT_RATE', false, 7),
  ('PROPERTY_APF',         'Property APF Verification',         'FIELD','FIELD_VISIT','FIELD_AGENT','TERRITORY_AUTO','PROPERTY_APF_FORM',         5,true,'[]',  'AGENT_COMMISSION','FIELD_RATE','FIELD_NARRATIVE','REVISIT_PARENT_RATE', false, 8),
  ('PROPERTY_INDIVIDUAL',  'Property Individual Verification',  'FIELD','FIELD_VISIT','FIELD_AGENT','TERRITORY_AUTO','PROPERTY_INDIVIDUAL_FORM',  5,true,'[]',  'AGENT_COMMISSION','FIELD_RATE','FIELD_NARRATIVE','REVISIT_PARENT_RATE', false, 9)
ON CONFLICT (code) DO NOTHING;

-- ===========================================================================
-- KYC_DOCUMENT units (59) — ONE shared profile; rows vary only by code/name/category/pii.
-- Profile constants (per FINAL_DATA_MODEL_FREEZE): worker=KYC_VERIFIER, assign=DESK_POOL,
-- form=NULL, photos=0, gps=false, attach=[{document min 1}], billing=CLIENT_INVOICE,
-- commission=NONE, report=KYC_DOCUMENT, reverif=RECHECK_FRESH_RATE.
-- pii_sensitive = true for IDENTITY + FINANCIAL categories (DPDP).
-- ===========================================================================
INSERT INTO verification_units
  (code, name, category, kind, worker_role, assignment_method, required_form_code,
   required_photos, required_gps, required_attachments, billing_profile, commission_profile,
   report_template_type, reverification_rule, pii_sensitive, sort_order)
SELECT v.code, v.name, v.category, 'KYC_DOCUMENT','KYC_VERIFIER','DESK_POOL', NULL,
       0, false, '[{"type":"DOCUMENT","min":1}]'::jsonb, 'CLIENT_INVOICE','NONE',
       'KYC_DOCUMENT','RECHECK_FRESH_RATE',
       (v.category IN ('IDENTITY','FINANCIAL')), 100 + row_number() OVER ()
FROM (VALUES
  -- IDENTITY
  ('PAN_CARD','PAN Verification','IDENTITY'),
  ('AADHAR_CARD','Aadhaar Verification','IDENTITY'),
  ('PASSPORT','Passport Verification','IDENTITY'),
  ('VOTER_ID','Voter ID Verification','IDENTITY'),
  ('DRIVING_LICENSE','Driving License Verification','IDENTITY'),
  ('OFFICE_ID_CARD','Office ID Card Verification','IDENTITY'),
  ('RATION_CARD','Ration Card Verification','IDENTITY'),
  ('BIRTH_CERTIFICATE','Birth Certificate Verification','IDENTITY'),
  ('SCHOOL_LEAVING_CERTIFICATE','School Leaving Certificate Verification','IDENTITY'),
  ('DEATH_CERTIFICATE','Death Certificate Verification','IDENTITY'),
  -- FINANCIAL
  ('ITR','ITR Verification','FINANCIAL'),
  ('BANK_STATEMENT','Bank Statement Verification','FINANCIAL'),
  ('BANK_STATEMENT_COPY','Bank Statement Copy Verification','FINANCIAL'),
  ('SALARY_SLIP','Salary Slip Verification','FINANCIAL'),
  ('FORM_16','Form 16 Verification','FINANCIAL'),
  ('TDS_CERTIFICATE','TDS Certificate Verification','FINANCIAL'),
  ('26_AS','26 AS Verification','FINANCIAL'),
  ('SHARE_CERTIFICATE','Share Certificate Verification','FINANCIAL'),
  ('EPFO','EPFO Verification','FINANCIAL'),
  ('FINANCIAL','Financial Verification','FINANCIAL'),
  -- BUSINESS
  ('GST','GST Verification','BUSINESS'),
  ('GST_CERTIFICATE','GST Certificate Verification','BUSINESS'),
  ('UDYOG_ADHAR','Udyog Aadhar Verification','BUSINESS'),
  ('SHOP_ACT','Shop Act Verification','BUSINESS'),
  -- ADDRESS
  ('UTILITY_BILL','Utility Bill Verification','ADDRESS'),
  ('ELECTRICITY_BILL','Electricity Bill Verification','ADDRESS'),
  ('LAND_LINE_BILL','Land Line Bill Verification','ADDRESS'),
  ('MOBILE_DETAILS','Mobile Details Verification','ADDRESS'),
  ('RENT_AGREEMENT','Rent Agreement Verification','ADDRESS'),
  -- PROPERTY
  ('PROPERTY_DOCS','Property Documents Verification','PROPERTY'),
  ('AGREEMENT','Agreement Verification','PROPERTY'),
  ('SALE_DEED','Sale Deed Verification','PROPERTY'),
  ('SOCIETY_NOC','Society NOC Verification','PROPERTY'),
  ('BUILDER_NOC','Builder NOC Verification','PROPERTY'),
  ('LANDLORD_NOC','Landlord NOC Verification','PROPERTY'),
  ('TENANT_NOC','Tenant NOC Verification','PROPERTY'),
  ('LEGAL_HEIR_NOC','Legal Heir NOC Verification','PROPERTY'),
  ('PLAN_COPY','Plan Copy Verification','PROPERTY'),
  ('COMMENCEMENT_CERTIFICATE','Commencement Certificate Verification','PROPERTY'),
  ('OCCUPANCY_CERTIFICATE','Occupancy Certificate Verification','PROPERTY'),
  -- LEGAL
  ('SANCTION_LETTER','Sanction Letter Verification','LEGAL'),
  ('DEMAND_LETTER','Demand Letter Verification','LEGAL'),
  ('FORECLOUSER_LETTER','Foreclosure Letter Verification','LEGAL'),
  ('GRAMPANCHAYAT_LETTER','Grampanchayat Letter Verification','LEGAL'),
  ('ARCHITECTURE_CERTIFICATE','Architecture Certificate Verification','LEGAL'),
  -- VERIFICATION
  ('SIGNATURE_VERIFICATION','Signature Verification','VERIFICATION'),
  ('CROSS_PROFILE_CHECK','Cross Profile Check (CPV Cross Check)','VERIFICATION'),
  ('DISCREET_PROFILE','Discreet Profile Verification','VERIFICATION'),
  ('GUARANTOR_VISIT','Guarantor Visit Verification','VERIFICATION'),
  -- MEDICAL
  ('MEDICAL_CERTIFICATE','Medical Certificate Verification','MEDICAL'),
  ('MEDICAL_BILL','Medical Bill Verification','MEDICAL'),
  -- OTHER
  ('EMPLOYEEID','Employee ID Verification','OTHER'),
  ('OFFER_LETTER','Offer Letter Verification','OTHER'),
  ('QUOTATION','Quotation Verification','OTHER'),
  ('INVOICE_COPY','Invoice Copy Verification','OTHER'),
  ('OCR_RECEIPT','OCR Receipt Verification','OTHER'),
  ('APPLICATION_FORM','Application Form Verification','OTHER'),
  ('LIST_OF_DOCUMENT','List of Document Verification','OTHER'),
  ('OTHER','Other Document Verification','OTHER')
) AS v(code, name, category)
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- Sanity (run after seed):
--   SELECT kind, count(*) FROM verification_units GROUP BY kind;   -- FIELD_VISIT 9 · KYC_DOCUMENT 59
--   SELECT count(*) FROM verification_units WHERE pii_sensitive;   -- IDENTITY+FINANCIAL units
