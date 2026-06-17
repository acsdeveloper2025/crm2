import {
  CreateSavedViewSchema,
  UpdateSavedViewSchema,
  SetDefaultSavedViewSchema,
  type SavedView,
} from '@crm2/sdk';
import { savedViewRepository as repo } from './repository.js';
import { AppError } from '../../platform/errors.js';

/**
 * Saved DataGrid views (B-5). Own-user scoped (identity, not a permission — like the notification
 * feed and job tray): the actor's `userId` is forced into every repo call, so a caller can only ever
 * read or mutate their own views. Inputs are validated against the shared zod schema (400 on bad
 * shape); a duplicate name on the same grid is a 409 (mapped in the repository).
 */
export const savedViewService = {
  list(userId: string, rawQuery: Record<string, unknown>): Promise<SavedView[]> {
    const resourceKey = typeof rawQuery['resourceKey'] === 'string' ? rawQuery['resourceKey'].trim() : '';
    if (!resourceKey) throw AppError.badRequest('RESOURCE_KEY_REQUIRED');
    return repo.listByResource(userId, resourceKey);
  },

  create(userId: string, body: unknown): Promise<SavedView> {
    const input = CreateSavedViewSchema.parse(body); // throws ZodError → 400
    return repo.create({
      userId,
      resourceKey: input.resourceKey,
      name: input.name,
      state: input.state,
      isDefault: input.isDefault ?? false,
    });
  },

  async update(userId: string, id: string, body: unknown): Promise<SavedView> {
    const input = UpdateSavedViewSchema.parse(body);
    const fields: { name?: string; state?: Record<string, string> } = {};
    if (input.name !== undefined) fields.name = input.name;
    if (input.state !== undefined) fields.state = input.state;
    const row = await repo.update(userId, id, fields);
    if (!row) throw AppError.notFound('SAVED_VIEW_NOT_FOUND');
    return row;
  },

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const removed = await repo.remove(userId, id);
    if (!removed) throw AppError.notFound('SAVED_VIEW_NOT_FOUND');
    return { ok: true };
  },

  async setDefault(userId: string, id: string, body: unknown): Promise<SavedView> {
    const { isDefault } = SetDefaultSavedViewSchema.parse(body);
    const row = await repo.setDefault(userId, id, isDefault);
    if (!row) throw AppError.notFound('SAVED_VIEW_NOT_FOUND');
    return row;
  },
};
