-- 0049_backend_user_product_restrict.sql — fix BACKEND_USER portfolio scoping.
--
-- BACKEND_USER held CLIENT + PRODUCT both as EXPAND. EXPAND is ADDITIVE (a union ORed on top of the
-- hierarchy), so a PRODUCT assignment pulled in EVERY client that has that product — a backend user
-- assigned (client=HDFC, product=HOME LOAN) also saw ICICI/Axis home-loan cases. CLIENT stays EXPAND
-- (a backend reviewer owns no cases, so a cap would show nothing — EXPAND is what GRANTS them their
-- client's cases); PRODUCT becomes a RESTRICT cap so it NARROWS the client's cases to the assigned
-- product instead of widening across clients. Visible ⇔ (own work OR assigned client) AND product.
--
-- Operating model (owner-confirmed): every backend user is assigned a FULL client+product portfolio.
-- RESTRICT is fail-closed, so a backend user with no product assignment sees nothing — intended here.
-- Forward-only, idempotent (only flips a still-EXPAND row, so a later admin change is preserved).

UPDATE role_scope_dimensions
   SET mode = 'RESTRICT'
 WHERE role_code = 'BACKEND_USER' AND dimension_code = 'PRODUCT' AND mode = 'EXPAND';
