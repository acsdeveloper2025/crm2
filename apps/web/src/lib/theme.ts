/**
 * Light/dark theme control. The full dark palette already exists in `@crm2/ui-theme`
 * (`.dark` on <html> swaps every token value) — this module just resolves, applies, and
 * persists the user's choice. Device-level pref via localStorage; defaults to the OS setting.
 */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'crm2.theme';

/** Stored preference wins; otherwise follow the OS. Pure — unit-tested. */
export function resolveTheme(stored: string | null, systemPrefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored;
  return systemPrefersDark ? 'dark' : 'light';
}

type RootEl = { classList: { add(c: string): void; remove(c: string): void } };

/** Add/remove the `.dark` class that drives the token swap. Pure — unit-tested. */
export function applyTheme(theme: Theme, root: RootEl): void {
  if (theme === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

/** Flip light↔dark. Pure — unit-tested. */
export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

// --- browser glue (exercised by the e2e, not the unit tests) ---

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The active theme = stored pref (if any) else OS preference. */
export function currentTheme(): Theme {
  return resolveTheme(localStorage.getItem(STORAGE_KEY), systemPrefersDark());
}

/** Apply the resolved theme to <html> at boot (call once before render). */
export function initTheme(): void {
  applyTheme(currentTheme(), document.documentElement);
}

/** Persist + apply an explicit choice. */
export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme, document.documentElement);
}

/** Toggle to the other theme, persist + apply, and return the new value. */
export function toggleTheme(): Theme {
  const t = nextTheme(currentTheme());
  setTheme(t);
  return t;
}
