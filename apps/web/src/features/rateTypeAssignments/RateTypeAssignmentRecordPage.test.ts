import { describe, it, expect } from 'vitest';
import { NO_CPV_MAPPING, CPV_ADMIN_PATH } from './RateTypeAssignmentRecordPage.js';

/**
 * UX-3: when a concrete client + product is picked and /cpv-units/available returns [], the admin
 * gets an explicit "no CPV mapping" warning + a link to the CPV admin — warning ONLY, the unit
 * picker's behavior is unchanged. Pin the copy and href so they can't silently drift.
 */
describe('CPV-missing warning copy', () => {
  it('names the missing-mapping state explicitly', () => {
    expect(NO_CPV_MAPPING).toBe('This client + product has no CPV mapping yet');
  });

  it('links straight to the CPV admin', () => {
    expect(CPV_ADMIN_PATH).toBe('/admin/cpv');
  });
});
