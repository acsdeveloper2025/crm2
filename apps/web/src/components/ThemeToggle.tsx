import { useState } from 'react';
import { currentTheme, toggleTheme, type Theme } from '../lib/theme.js';

function MoonIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

/** Header control that flips light↔dark and persists the choice (ADR-0008 dark palette). */
export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(() => currentTheme());
  const goingDark = theme !== 'dark';
  return (
    <button
      type="button"
      aria-label={goingDark ? 'Switch to dark theme' : 'Switch to light theme'}
      title={goingDark ? 'Dark mode' : 'Light mode'}
      className="rounded-md p-1 text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      onClick={() => setThemeState(toggleTheme())}
    >
      {goingDark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
