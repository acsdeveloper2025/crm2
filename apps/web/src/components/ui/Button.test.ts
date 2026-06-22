import { describe, it, expect } from 'vitest';
import { buttonClass } from './Button.js';

/**
 * The button variant system (ADR-0052): primary (solid blue) · secondary (tonal blue) ·
 * destructive (filled red) · ghost (borderless utility) · link (text). One primary per view.
 * Palette stays Blue+Slate — only existing tokens, no new colors.
 */
describe('buttonClass', () => {
  it('primary = solid blue brand fill', () => {
    const c = buttonClass('primary');
    expect(c).toContain('bg-primary');
    expect(c).toContain('text-primary-foreground');
  });

  it('secondary = tonal blue (soft fill + AA-safe blue text), not a solid fill', () => {
    const c = buttonClass('secondary');
    expect(c).toContain('bg-primary-muted');
    // text uses --primary-hover (blue-700 light / blue-400 dark) which clears WCAG-AA on
    // --primary-muted in BOTH themes, unlike --primary (blue-500 ~3.9:1 in dark).
    expect(c).toContain('text-primary-hover');
    expect(c).not.toContain('text-primary-foreground');
  });

  it('destructive = filled red', () => {
    expect(buttonClass('destructive')).toContain('bg-destructive');
    expect(buttonClass('destructive')).toContain('text-destructive-foreground');
  });

  it('ghost = borderless (no border utility), hover background', () => {
    const c = buttonClass('ghost');
    expect(c).toContain('hover:bg-accent');
    expect(c).not.toMatch(/\bborder\b/);
  });

  it('link = text only with underline-on-hover', () => {
    const c = buttonClass('link');
    expect(c).toContain('text-primary');
    expect(c).toContain('hover:underline');
  });

  it('base styles apply to every variant (radius, disabled, label layout)', () => {
    for (const v of ['primary', 'secondary', 'destructive', 'ghost', 'link'] as const) {
      const c = buttonClass(v);
      expect(c).toContain('rounded-md');
      expect(c).toContain('disabled:opacity-50');
      expect(c).toContain('inline-flex');
    }
  });

  it('size sm is more compact than the md default', () => {
    expect(buttonClass('primary', 'sm')).toContain('text-xs');
    expect(buttonClass('primary')).toContain('text-sm');
  });
});
