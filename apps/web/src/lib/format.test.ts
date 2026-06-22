import { describe, it, expect } from 'vitest';
import { formatMoney } from './format.js';

describe('formatMoney', () => {
  it('formats a whole number as ₹ with 2 decimals', () => {
    expect(formatMoney(50)).toBe('₹50.00');
  });

  it('keeps 2 decimals for fractional amounts', () => {
    expect(formatMoney(90.5)).toBe('₹90.50');
  });

  it('formats zero', () => {
    expect(formatMoney(0)).toBe('₹0.00');
  });

  it('renders an em-dash for null', () => {
    expect(formatMoney(null)).toBe('—');
  });

  it('renders an em-dash for undefined', () => {
    expect(formatMoney(undefined)).toBe('—');
  });
});
