import { describe, it, expect } from 'vitest';
import { HUB_PATH, STEP_DEFS, parseStep, hubReturnTo, safeReturnTo } from './hubState.js';

describe('parseStep', () => {
  it('defaults to 1 for null', () => {
    expect(parseStep(null)).toBe(1);
  });

  it('parses an in-range step', () => {
    expect(parseStep('3')).toBe(3);
  });

  it('falls back to 1 for an out-of-range step', () => {
    expect(parseStep('9')).toBe(1);
  });

  it('falls back to 1 for a non-numeric value', () => {
    expect(parseStep('x')).toBe(1);
  });
});

describe('hubReturnTo', () => {
  it('builds the exact hub URL', () => {
    expect(hubReturnTo('12', 2)).toBe('/admin/client-setup?clientId=12&step=2');
  });
});

describe('safeReturnTo', () => {
  it('accepts a hubReturnTo output', () => {
    const url = hubReturnTo('12', 2);
    expect(safeReturnTo(url)).toBe(url);
  });

  it('rejects null', () => {
    expect(safeReturnTo(null)).toBeNull();
  });

  it('rejects a non-hub admin path', () => {
    expect(safeReturnTo('/admin/rates')).toBeNull();
  });

  it('rejects an absolute URL to another host', () => {
    expect(safeReturnTo('https://evil.com/admin/client-setup')).toBeNull();
  });

  it('rejects a protocol-relative URL', () => {
    expect(safeReturnTo('//evil.com')).toBeNull();
  });

  it('rejects a sibling path sharing the hub prefix', () => {
    expect(safeReturnTo('/admin/client-setup-evil')).toBeNull();
  });

  it('accepts the bare hub path', () => {
    expect(safeReturnTo('/admin/client-setup')).toBe('/admin/client-setup');
  });
});

describe('STEP_DEFS', () => {
  it('has 4 steps with ids 1-4 and the expected labels', () => {
    expect(STEP_DEFS).toEqual([
      { id: 1, key: 'cpv', label: 'Products & CPV units' },
      { id: 2, key: 'rateTypes', label: 'Rate types' },
      { id: 3, key: 'rates', label: 'Rates' },
      { id: 4, key: 'commission', label: 'Commission rates' },
    ]);
  });
});

describe('HUB_PATH', () => {
  it('is the hub route', () => {
    expect(HUB_PATH).toBe('/admin/client-setup');
  });
});
