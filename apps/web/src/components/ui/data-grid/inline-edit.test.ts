import { describe, it, expect } from 'vitest';
import { validateDraft, isDraftValid, firstError, type EditableField } from './inline-edit.js';

const FIELDS: EditableField[] = [
  { field: 'name', editor: 'text', required: true },
  { field: 'description', editor: 'text' },
  {
    field: 'effectiveFrom',
    editor: 'date',
    validate: (v) => (v && Number.isNaN(Date.parse(v)) ? 'Invalid date' : null),
  },
];

describe('validateDraft', () => {
  it('flags a missing required field', () => {
    const errors = validateDraft({ name: '   ', description: 'x', effectiveFrom: '' }, FIELDS);
    expect(errors['name']).toBe('Required');
    expect(isDraftValid(errors)).toBe(false);
  });

  it('passes when required fields are present and validators are happy', () => {
    const errors = validateDraft({ name: 'Ops', description: '', effectiveFrom: '2026-06-23' }, FIELDS);
    expect(errors).toEqual({});
    expect(isDraftValid(errors)).toBe(true);
  });

  it('runs a column validator and surfaces its message', () => {
    const errors = validateDraft({ name: 'Ops', effectiveFrom: 'not-a-date' }, FIELDS);
    expect(errors['effectiveFrom']).toBe('Invalid date');
  });

  it('a non-required empty field with no validator is valid', () => {
    const errors = validateDraft({ name: 'Ops', description: '' }, FIELDS);
    expect(errors['description']).toBeUndefined();
  });

  it('firstError returns the first message or null', () => {
    expect(firstError({})).toBeNull();
    expect(firstError({ name: 'Required' })).toBe('Required');
  });
});
