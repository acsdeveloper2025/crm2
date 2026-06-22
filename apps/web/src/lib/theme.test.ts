import { describe, it, expect } from 'vitest';
import { resolveTheme, applyTheme, nextTheme } from './theme.js';

/** A minimal classList stub so we can unit-test applyTheme without a DOM (no jsdom in this stack). */
function fakeRoot(initial: string[] = []) {
  const set = new Set(initial);
  return {
    classList: {
      add: (c: string) => void set.add(c),
      remove: (c: string) => void set.delete(c),
      contains: (c: string) => set.has(c),
    },
    has: (c: string) => set.has(c),
  };
}

describe('resolveTheme', () => {
  it('honors a stored preference over the system setting', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });
  it('falls back to the system preference when nothing is stored', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });
  it('treats an invalid stored value as no preference', () => {
    expect(resolveTheme('purple', true)).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('adds the .dark class for dark', () => {
    const root = fakeRoot();
    applyTheme('dark', root);
    expect(root.has('dark')).toBe(true);
  });
  it('removes the .dark class for light', () => {
    const root = fakeRoot(['dark']);
    applyTheme('light', root);
    expect(root.has('dark')).toBe(false);
  });
});

describe('nextTheme', () => {
  it('toggles between light and dark', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
  });
});
