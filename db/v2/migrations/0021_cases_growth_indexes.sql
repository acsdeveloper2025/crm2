-- 0021_cases_growth_indexes.sql
-- DataGrid + server-pagination rollout tail (B-2 / cases-growth ratchet): the cases list is the
-- one operational table that grows unbounded (one row per verification case). It is browsed via the
-- Universal DataGrid (server pagination + global ILIKE search + column sort). Back its access paths
-- so the grid stays fast as cases accumulate. Forward-only, idempotent.
--
-- Pre-existing cases indexes (0010): idx_cases_client (client_id), idx_cases_status (status).
-- Pre-existing applicant search indexes (0010): idx_applicants_name (lower(name)) — serves equality,
-- NOT the list's `ILIKE '%term%'` (leading wildcard) — hence the trigram index below.

-- Default sort: `ORDER BY cs.created_at DESC, cs.id DESC` (CASE_PAGE_SPEC.defaultSort=createdAt desc).
-- A matching DESC composite lets the planner read the first page straight off the index, no sort.
CREATE INDEX IF NOT EXISTS idx_cases_created_at ON cases (created_at DESC, id DESC);

-- The list SELECT does `JOIN products p ON p.id = cs.product_id` (client side already has
-- idx_cases_client). Index the FK so the join uses it instead of a hash/seq scan as rows grow.
CREATE INDEX IF NOT EXISTS idx_cases_product ON cases (product_id);

-- Global search is `cs.case_number ILIKE '%term%' OR pa.name ILIKE '%term%'`. Leading wildcards
-- need trigram GIN (a b-tree can't help). One per searched column so the planner can BitmapOr.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_cases_case_number_trgm ON cases USING gin (case_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_applicants_name_trgm ON case_applicants USING gin (name gin_trgm_ops);
