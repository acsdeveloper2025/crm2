import { describe, it, expect } from 'vitest';
import { withClientFilter, newRecordHref } from './embed.js';

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

describe('newRecordHref', () => {
  it('bare create route when uncontrolled — behaviour-identical to standalone', () => {
    expect(newRecordHref('/admin/rates', undefined, '/admin/rates', '')).toBe('/admin/rates/new');
  });

  it('carries clientId + returnTo (current location) when controlled', () => {
    expect(newRecordHref('/admin/rates', '7', '/admin/client-setup', '?clientId=7&step=3')).toBe(
      '/admin/rates/new?clientId=7&returnTo=%2Fadmin%2Fclient-setup%3FclientId%3D7%26step%3D3',
    );
  });
});
