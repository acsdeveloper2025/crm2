import { describe, it, expect } from 'vitest';
import {
  validateDraft,
  isDraftValid,
  firstError,
  isLockedCell,
  LOCKED_CELL_TITLE,
  type EditableField,
} from './inline-edit.js';

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

/**
 * UX-12: a `createOnly` column (e.g. rate-type code, ADR-0064 Phase A) is settable on the add-row
 * but read-only forever after — it renders with no styling hook at all today, so a user has to
 * click it to discover it doesn't edit. isLockedCell is the exact predicate the JSX gates the
 * muted+lock-glyph+title affordance on: true only for a createOnly column on an EXISTING row
 * (never during the add-row draft, where it's still an editable input).
 */
describe('isLockedCell (createOnly affordance, UX-12)', () => {
  it('is true for a createOnly column on an existing row', () => {
    expect(isLockedCell({ createOnly: true }, false)).toBe(true);
  });

  it('is false for a createOnly column while creating (still an editable input)', () => {
    expect(isLockedCell({ createOnly: true }, true)).toBe(false);
  });

  it('is false for a plain editable column', () => {
    expect(isLockedCell({ editable: true }, false)).toBe(false);
  });

  it('is false for a column that is neither createOnly nor editable', () => {
    expect(isLockedCell({}, false)).toBe(false);
  });

  it('pins the lock-cell tooltip copy', () => {
    expect(LOCKED_CELL_TITLE).toBe('Locked — set at creation');
  });
});
