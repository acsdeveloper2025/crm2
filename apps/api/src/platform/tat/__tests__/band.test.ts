import { describe, it, expect } from 'vitest';
import { classifyBand } from '../band.js';

const BANDS = [4, 6, 8, 12, 24, 48]; // usable tat_hours, ascending

describe('classifyBand', () => {
  it('returns the smallest band >= elapsed hours', () => {
    expect(classifyBand(0, BANDS)).toBe(4);
    expect(classifyBand(4 * 60, BANDS)).toBe(4); // exactly 4h -> 4
    expect(classifyBand(4 * 60 + 1, BANDS)).toBe(6); // 4h01m -> 6
    expect(classifyBand(7 * 60, BANDS)).toBe(8);
    expect(classifyBand(24 * 60, BANDS)).toBe(24);
  });
  it('returns -1 (overflow) when elapsed exceeds the max band', () => {
    expect(classifyBand(48 * 60 + 1, BANDS)).toBe(-1);
  });
  it('returns null when elapsed is null/undefined', () => {
    expect(classifyBand(null, BANDS)).toBeNull();
  });
  it('returns -1 when there are no usable bands', () => {
    expect(classifyBand(60, [])).toBe(-1);
  });
});
