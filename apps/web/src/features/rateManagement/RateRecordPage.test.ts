import { describe, it, expect } from 'vitest';
import {
  friendlyError,
  PICK_COMBO_FIRST,
  NO_RATE_TYPES_FOR_COMBO,
  ASSIGN_RATE_TYPES_PATH,
  hasDownstreamValues,
  MODE_LOCKED_HELPER,
  CLEAR_FIELDS_LABEL,
} from './RateRecordPage.js';

/**
 * UX-4: the create/revise 409 must read as plain English, not a raw server code — the page maps
 * RATE_EXISTS locally and falls through to the raw code for anything unknown (STALE_UPDATE is
 * handled separately by the ConflictDialog and must NOT be swallowed by this map).
 */
describe('friendlyError (rates)', () => {
  it('maps RATE_EXISTS to the overlap copy, verbatim', () => {
    expect(friendlyError('RATE_EXISTS')).toBe(
      'An active rate for this combination already overlaps this period — revise or end-date it first.',
    );
  });

  it('returns null for unknown codes so the raw-code fallback still applies', () => {
    expect(friendlyError('STALE_UPDATE')).toBeNull();
    expect(friendlyError('VALIDATION')).toBeNull();
    expect(friendlyError('')).toBeNull();
  });
});

/**
 * UX-3: the Rate Type picker has two DISTINCT gated states with distinct copy —
 * (a) combo incomplete → "pick the dims first" placeholder;
 * (b) combo complete but zero assignments → explicit message + a real link to create one.
 * These constants are what the JSX renders; pin them so the copy and href can't silently drift.
 */
describe('rate-type gating copy', () => {
  it('keeps the incomplete-combo placeholder', () => {
    expect(PICK_COMBO_FIRST).toBe('Pick client, product & unit first');
  });

  it('names the empty-assignments state explicitly', () => {
    expect(NO_RATE_TYPES_FOR_COMBO).toBe('No rate types assigned for this combination');
  });

  it('links straight to the new-assignment form', () => {
    expect(ASSIGN_RATE_TYPES_PATH).toBe('/admin/rate-type-assignments/new');
  });
});

/**
 * UX-9: switching Field/Office silently resets unit/pincode/area/rate type (onModeChange clears all
 * four). Rather than a confirm dialog, the toggle disables itself once any downstream field is set —
 * keyboard-safe, no modal to dismiss. hasDownstreamValues is the exact predicate the JSX disables on.
 */
describe('hasDownstreamValues (Field/Office toggle guard)', () => {
  const empty = { unitId: '', pincode: '', locationId: '', clientRateType: '' };

  it('is false when every downstream field is empty', () => {
    expect(hasDownstreamValues(empty)).toBe(false);
  });

  it('is true when unit is set', () => {
    expect(hasDownstreamValues({ ...empty, unitId: '3' })).toBe(true);
  });

  it('is true when pincode is set', () => {
    expect(hasDownstreamValues({ ...empty, pincode: '400001' })).toBe(true);
  });

  it('is true when area (locationId) is set', () => {
    expect(hasDownstreamValues({ ...empty, locationId: '9' })).toBe(true);
  });

  it('is true when rate type is set', () => {
    expect(hasDownstreamValues({ ...empty, clientRateType: 'LOCAL' })).toBe(true);
  });

  it('pins the helper-text copy', () => {
    expect(MODE_LOCKED_HELPER).toBe('Clear unit/location fields to switch mode');
  });

  // SearchableSelect has no clear affordance once a value commits, so the helper alone would be a
  // dead-end instruction — the Clear-fields action (rendered iff modeLocked, right after the helper)
  // is the recovery path. Same predicate gates both, so visibility can't drift apart.
  it('pins the Clear-fields action label', () => {
    expect(CLEAR_FIELDS_LABEL).toBe('Clear fields');
  });
});
