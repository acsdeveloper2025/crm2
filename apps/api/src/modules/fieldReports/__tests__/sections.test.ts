import { describe, it, expect } from 'vitest';
import { buildSections, toLabel } from '../sections.js';

describe('field-report sections', () => {
  it('toLabel humanizes camelCase and snake_case', () => {
    expect(toLabel('customerName')).toBe('Customer Name');
    expect(toLabel('met_person_relation')).toBe('Met Person Relation');
    expect(toLabel('tpc1Name')).toBe('Tpc1 Name');
  });

  it('groups by form-type slug, flattens keyed fields + surfaces outcome', () => {
    const out = buildSections({
      residence: {
        formData: { customerName: 'RAJESH', stayingPeriod: '5 Years', totalFamilyMembers: 4 },
        verificationOutcome: 'POSITIVE_DOOR_OPEN',
        photos: [{ id: 'x' }],
        geoLocation: { latitude: 1 },
        metadata: { app: 'v1' },
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('Residence');
    expect(out[0]!.fields).toEqual([
      { label: 'Customer Name', value: 'RAJESH' },
      { label: 'Staying Period', value: '5 Years' },
      { label: 'Total Family Members', value: '4' },
      { label: 'Verification Outcome', value: 'POSITIVE_DOOR_OPEN' },
    ]);
  });

  it('skips system/bulky keys and null/empty/nested-object values', () => {
    const out = buildSections({
      office: {
        formData: {
          companyName: 'ACME',
          empty: '',
          missing: null,
          nested: { deep: 1 },
          tags: ['a', 'b'],
        },
      },
    });
    expect(out[0]!.fields).toEqual([
      { label: 'Company Name', value: 'ACME' },
      { label: 'Tags', value: 'a, b' },
    ]);
  });

  it('falls back to the blob itself when there is no nested formData', () => {
    const out = buildSections({ noc: { remark: 'ok', area: 'BTM' } });
    expect(out[0]!.title).toBe('Noc');
    expect(out[0]!.fields).toEqual([
      { label: 'Remark', value: 'ok' },
      { label: 'Area', value: 'BTM' },
    ]);
  });

  it('empty / null / non-object input → no sections; a slug with no usable fields is dropped', () => {
    expect(buildSections(null)).toEqual([]);
    expect(buildSections({})).toEqual([]);
    expect(buildSections({ residence: { photos: [], metadata: {} } })).toEqual([]);
  });
});
