-- 0051_saved_views.sql — per-user named DataGrid views (B-5, DATAGRID_STANDARD §10).
-- A saved view is a user's named snapshot of a grid's URL-state (search/sort/page-size/visible
-- columns/filters) for one resource. Own-user scoped at the query layer (WHERE user_id = actor) —
-- a saved view is personal UI preference, identity not a permission, exactly like notifications
-- (0045) and jobs (0050). The app may create/rename/delete/re-point a view; there is no shared or
-- cross-user read path. Forward-only, idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS saved_views (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,  -- the owner
  -- the grid this view belongs to = the DataGrid `queryKey` (e.g. 'cases', 'tasks', 'locations').
  resource_key varchar(64) NOT NULL,
  name         varchar(120) NOT NULL,
  -- the captured grid URL-state: { q, sort, dir, size, cols, f_<col>, f_<col>_from/_to, … } as a
  -- flat string map (never `page`). Opaque to the server — the FE applies it back onto the URL.
  state        jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default   boolean NOT NULL DEFAULT false,                          -- auto-applied on grid open
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- a user can't have two views with the same name on the same grid.
  CONSTRAINT uq_saved_views_user_resource_name UNIQUE (user_id, resource_key, name)
);

-- List a user's views for one grid.
CREATE INDEX IF NOT EXISTS idx_saved_views_user_resource ON saved_views (user_id, resource_key);

-- At most ONE default view per (user, grid) — enforced in the DB, not just the service.
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_views_default
  ON saved_views (user_id, resource_key) WHERE is_default;

COMMIT;
