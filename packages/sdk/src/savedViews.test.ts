import { describe, it, expect } from 'vitest';
import {
  CreateSavedViewSchema,
  UpdateSavedViewSchema,
  SetDefaultSavedViewSchema,
  SavedViewStateSchema,
} from './savedViews.js';

describe('SavedView contract', () => {
  it('accepts a valid create and trims the name', () => {
    const parsed = CreateSavedViewSchema.safeParse({
      resourceKey: 'cases',
      name: '  My Pending  ',
      state: { q: 'x', sort: 'name' },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.name).toBe('My Pending');
  });

  it('rejects an empty name / resourceKey', () => {
    expect(CreateSavedViewSchema.safeParse({ resourceKey: 'cases', name: '', state: {} }).success).toBe(
      false,
    );
    expect(CreateSavedViewSchema.safeParse({ resourceKey: '', name: 'X', state: {} }).success).toBe(false);
  });

  it('rejects a non-string state value (state is a flat string map)', () => {
    expect(SavedViewStateSchema.safeParse({ q: 'x' }).success).toBe(true);
    expect(SavedViewStateSchema.safeParse({ q: 1 }).success).toBe(false);
  });

  it('update requires at least one of name/state', () => {
    expect(UpdateSavedViewSchema.safeParse({ name: 'A' }).success).toBe(true);
    expect(UpdateSavedViewSchema.safeParse({ state: { q: 'y' } }).success).toBe(true);
    expect(UpdateSavedViewSchema.safeParse({}).success).toBe(false);
  });

  it('set-default takes a boolean', () => {
    expect(SetDefaultSavedViewSchema.safeParse({ isDefault: true }).success).toBe(true);
    expect(SetDefaultSavedViewSchema.safeParse({}).success).toBe(false);
  });
});
