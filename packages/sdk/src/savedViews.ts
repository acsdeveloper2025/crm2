/**
 * @crm2/sdk — saved DataGrid views (B-5, DATAGRID_STANDARD §10). A per-user named snapshot of a
 * grid's URL-state for one resource. Own-user scoped server-side (identity, not a permission) —
 * every authenticated user manages their own views, exactly like the notification feed and job tray.
 */
import { z } from 'zod';

/**
 * The captured grid URL-state: a flat string map of the DataGrid's URL keys — `q` (search) · `sort` ·
 * `dir` · `size` (page size) · `cols` (hidden column ids) · `f_<col>` / `f_<col>_from` / `f_<col>_to`
 * (filters). NEVER `page` (a view is a query, not a scroll position). Opaque to the server; the FE
 * applies it straight back onto the URL.
 */
export type SavedViewState = Record<string, string>;

export interface SavedView {
  id: string;
  resourceKey: string;
  name: string;
  state: SavedViewState;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A view's state is a flat string→string map (the URL keys). Bounded to keep a row sane. */
export const SavedViewStateSchema = z.record(z.string().max(64), z.string().max(2000));

export const CreateSavedViewSchema = z.object({
  resourceKey: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  state: SavedViewStateSchema,
  isDefault: z.boolean().optional(),
});
export type CreateSavedViewInput = z.infer<typeof CreateSavedViewSchema>;

/** Rename and/or re-capture the state of an existing view (own-user). */
export const UpdateSavedViewSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    state: SavedViewStateSchema.optional(),
  })
  .refine((b) => b.name !== undefined || b.state !== undefined, {
    message: 'nothing to update',
  });
export type UpdateSavedViewInput = z.infer<typeof UpdateSavedViewSchema>;

/** Set/clear the default view for its (user, resource). Setting one clears any sibling default. */
export const SetDefaultSavedViewSchema = z.object({ isDefault: z.boolean() });
export type SetDefaultSavedViewInput = z.infer<typeof SetDefaultSavedViewSchema>;
