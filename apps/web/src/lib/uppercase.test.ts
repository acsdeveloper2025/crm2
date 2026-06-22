import { describe, expect, it } from 'vitest';

import { shouldUppercaseInput, toUpperCaseSafe } from './uppercase.js';

describe('shouldUppercaseInput', () => {
  it('uppercases ordinary text fields by default', () => {
    expect(shouldUppercaseInput('text', 'name')).toBe(true);
    expect(shouldUppercaseInput(undefined, 'companyName')).toBe(true);
    expect(shouldUppercaseInput('text', 'addressLine1')).toBe(true);
    expect(shouldUppercaseInput('text', 'landmark')).toBe(true);
    expect(shouldUppercaseInput('search', 'q')).toBe(true);
  });

  it('preserves case for case-sensitive input types', () => {
    for (const type of [
      'email',
      'password',
      'url',
      'tel',
      'number',
      'date',
      'time',
      'datetime-local',
      'month',
      'week',
      'file',
      'color',
      'range',
    ]) {
      expect(shouldUppercaseInput(type, 'whatever')).toBe(false);
    }
  });

  it('matches case-sensitive types case-insensitively', () => {
    expect(shouldUppercaseInput('EMAIL', 'x')).toBe(false);
    expect(shouldUppercaseInput('Password', 'x')).toBe(false);
  });

  it('preserves case for case-sensitive field names', () => {
    for (const name of [
      'username',
      'email',
      'userEmail',
      'password',
      'confirmPassword',
      'apiKey',
      'api_key',
      'apikey',
      'token',
      'jwt',
      'secret',
      'otp',
      'mfaCode',
      'pin',
      'website',
      'fileName',
      'filePath',
    ]) {
      expect(shouldUppercaseInput('text', name)).toBe(false);
    }
  });

  it('falls back to id when name is absent (password show/hide toggle)', () => {
    // type flips to 'text' when the eye icon reveals the value
    expect(shouldUppercaseInput('text', undefined, undefined, 'confirm-password')).toBe(false);
    expect(shouldUppercaseInput('text', undefined, undefined, 'mfa-code')).toBe(false);
  });

  it('honours the explicit override over auto-detection', () => {
    expect(shouldUppercaseInput('email', 'email', true)).toBe(true);
    expect(shouldUppercaseInput('text', 'name', false)).toBe(false);
  });
});

describe('toUpperCaseSafe', () => {
  it('uppercases strings', () => {
    expect(toUpperCaseSafe('abc')).toBe('ABC');
  });
  it('returns empty string for null/undefined', () => {
    expect(toUpperCaseSafe(null)).toBe('');
    expect(toUpperCaseSafe(undefined)).toBe('');
  });
  it('stringifies non-strings', () => {
    expect(toUpperCaseSafe(42)).toBe('42');
  });
});
