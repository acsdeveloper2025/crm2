-- 0020_locations_search_indexes.sql
-- DataGrid + server-pagination rollout (C-?): the locations catalog is ~157k rows and is
-- now browsed through the Universal DataGrid (server pagination + global ILIKE search +
-- column sort). Add the indexes that back those access paths so the grid stays <2s at scale.
-- Forward-only, idempotent.

-- Trigram search: the grid's global search is `pincode/area/city/state ILIKE '%term%'`
-- (leading wildcard ⇒ a plain b-tree can't help). pg_trgm GIN indexes let the planner
-- BitmapOr across the four columns instead of a 157k sequential scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_locations_pincode_trgm ON locations USING gin (pincode gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_locations_area_trgm ON locations USING gin (area gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_locations_city_trgm ON locations USING gin (city gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_locations_state_trgm ON locations USING gin (state gin_trgm_ops);

-- Default sort is `ORDER BY pincode, id` over ALL rows (admin list has no is_active filter,
-- so the pre-existing partial idx_locations_pincode WHERE is_active doesn't cover it).
CREATE INDEX IF NOT EXISTS idx_locations_pincode_sort ON locations (pincode, id);
