import { describe, it, expect } from 'vitest';
import { CreatePolicySchema } from '@crm2/sdk';
import { zodFieldErrors } from './zodForm.js';

/**
 * `zodFieldErrors` lets a record-page form surface inline per-field errors from the SAME @crm2/sdk
 * schema the server enforces — no react-hook-form dependency (frozen stack). Pure, unit-tested.
 */
describe('zodFieldErrors', () => {
  it('returns {} when the values satisfy the schema', () => {
    expect(zodFieldErrors(CreatePolicySchema, { code: 'PRIVACY', name: 'Privacy', content: 'Body' })).toEqual(
      {},
    );
  });

  it('maps each invalid top-level field to a message (one per field)', () => {
    const errs = zodFieldErrors(CreatePolicySchema, { code: 'not a code', name: '', content: '' });
    expect(Object.keys(errs).sort()).toEqual(['code', 'content', 'name']);
    expect(typeof errs['code']).toBe('string');
    expect(errs['code']).toBeTruthy();
  });

  it('reports only the fields that fail', () => {
    const errs = zodFieldErrors(CreatePolicySchema, { code: 'PRIVACY', name: 'Privacy', content: '' });
    expect(Object.keys(errs)).toEqual(['content']);
  });
});
