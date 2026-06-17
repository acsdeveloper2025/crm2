-- E2E operational fixture (idempotent). Applied by the CI `e2e` job after the
-- migrations (which only self-seed the admin SUPER_ADMIN). The Playwright specs
-- datagrid.spec (row-select bulk bar + CPV master-detail) and pipeline.spec
-- (row-select → Assign dialog) need real rows to act on; the migrations leave the
-- operational tables empty. Kept deliberately small + stable so assertions stay
-- deterministic. Re-runnable: every insert is guarded by its natural unique key.
--
-- Graph: 3 clients · 2 products · 3 CPV links (client_products) · 1 case with one
-- primary applicant and one PENDING (unassigned) field task for the Pipeline queue.

-- Clients (Select-row bulk-bar test selects the first row; CPV test needs an owner).
INSERT INTO clients (code, name)
VALUES ('HDFC', 'HDFC Bank'), ('ICICI', 'ICICI Bank'), ('AXIS', 'Axis Bank')
ON CONFLICT (code) DO NOTHING;

-- Products.
INSERT INTO products (code, name)
VALUES ('HL', 'Home Loan'), ('PL', 'Personal Loan')
ON CONFLICT (code) DO NOTHING;

-- CPV links (client_products) — each expandable row drives the master-detail test.
INSERT INTO client_products (client_id, product_id)
SELECT c.id, p.id
FROM (VALUES ('HDFC', 'HL'), ('HDFC', 'PL'), ('ICICI', 'HL')) AS m(client_code, product_code)
JOIN clients c ON c.code = m.client_code
JOIN products p ON p.code = m.product_code
ON CONFLICT (client_id, product_id) DO NOTHING;

-- One case + primary applicant + one PENDING field task for the Pipeline queue.
DO $$
DECLARE
  v_client_id  integer;
  v_product_id integer;
  v_unit_id    integer;
  v_case_id    uuid;
  v_applicant  uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM cases WHERE case_number = 'E2E-0001') THEN
    RETURN; -- already seeded
  END IF;

  SELECT id INTO v_client_id FROM clients WHERE code = 'HDFC';
  SELECT id INTO v_product_id FROM products WHERE code = 'HL';
  SELECT id INTO v_unit_id FROM verification_units WHERE kind = 'FIELD_VISIT' ORDER BY id LIMIT 1;

  INSERT INTO cases (case_number, client_id, product_id, status, dedupe_decision, backend_contact_number)
  VALUES ('E2E-0001', v_client_id, v_product_id, 'NEW', 'NO_DUPLICATES_FOUND', '9990000001')
  RETURNING id INTO v_case_id;

  INSERT INTO case_applicants (case_id, name, calling_code, is_primary)
  VALUES (v_case_id, 'E2E Applicant', '+91', true)
  RETURNING id INTO v_applicant;

  INSERT INTO case_tasks (case_id, verification_unit_id, applicant_id, address, task_number, status, visit_type)
  VALUES (v_case_id, v_unit_id, v_applicant, '1 Test Street, Mumbai', 'E2E-0001-1', 'PENDING', 'FIELD');
END $$;
