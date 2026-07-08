import { describe, it, expect } from 'vitest';
import { withClientFilter } from './embed.js';

describe('withClientFilter', () => {
  it('sets clientId from the controlled prop when filters has none', () => {
    expect(withClientFilter({}, '7')).toEqual({ clientId: '7' });
  });

  it('controlled clientId wins over an existing filters.clientId', () => {
    expect(withClientFilter({ clientId: '3' }, '7')).toEqual({ clientId: '7' });
  });

  it('falls back to filters.clientId when uncontrolled', () => {
    expect(withClientFilter({ clientId: '3' }, undefined)).toEqual({ clientId: '3' });
  });

  it('is a no-op (clientId stays undefined) when both are absent — behaviour-identical', () => {
    expect(withClientFilter({}, undefined)).toEqual({ clientId: undefined });
  });
});
