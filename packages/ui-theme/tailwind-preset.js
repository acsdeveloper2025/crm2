const hsl = (v) => `hsl(var(${v}))`;
const alpha = (v) => `hsl(var(${v}) / <alpha-value>)`;
const fg = (v) => ({ DEFAULT: alpha(v), foreground: hsl(`${v}-foreground`) });
const status = (n) => ({ DEFAULT: alpha(`--st-${n}`), bg: alpha(`--st-${n}-bg`) });

/**
 * Shared Tailwind preset — maps the @crm2/ui-theme CSS variables to semantic tokens.
 * The ONLY color source. No hardcoded colors anywhere in app code. PERMANENT FREEZE.
 */
export default {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: alpha('--background'),
        foreground: alpha('--foreground'),
        surface: {
          DEFAULT: alpha('--surface'),
          muted: alpha('--surface-muted'),
          sunken: alpha('--surface-sunken'),
        },
        border: { DEFAULT: alpha('--border'), strong: alpha('--border-strong') },
        input: alpha('--input'),
        ring: alpha('--ring'),
        card: fg('--card'),
        popover: fg('--popover'),
        primary: {
          DEFAULT: alpha('--primary'),
          foreground: hsl('--primary-foreground'),
          hover: alpha('--primary-hover'),
          muted: alpha('--primary-muted'),
        },
        secondary: {
          DEFAULT: alpha('--secondary'),
          foreground: hsl('--secondary-foreground'),
          hover: alpha('--secondary-hover'),
        },
        muted: fg('--muted'),
        accent: fg('--accent'),
        destructive: fg('--destructive'),
        success: fg('--success'),
        warning: fg('--warning'),
        info: fg('--info'),
        // Workflow status — use as: text-st-approved / bg-st-approved-bg / border-st-approved
        st: {
          pending: status('pending'),
          assigned: status('assigned'),
          'in-progress': status('in-progress'),
          submitted: status('submitted'),
          'under-review': status('under-review'),
          approved: status('approved'),
          rejected: status('rejected'),
          revisit: status('revisit'),
        },
        // Table interaction
        row: {
          hover: alpha('--row-hover'),
          selected: alpha('--row-selected'),
          'selected-border': alpha('--row-selected-border'),
        },
        chart: {
          1: hsl('--chart-1'),
          2: hsl('--chart-2'),
          3: hsl('--chart-3'),
          4: hsl('--chart-4'),
          5: hsl('--chart-5'),
          6: hsl('--chart-6'),
        },
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      fontFamily: { sans: 'var(--font-sans)', mono: 'var(--font-mono)' },
      boxShadow: { sm: 'var(--shadow-sm)', md: 'var(--shadow-md)', lg: 'var(--shadow-lg)' },
      fontSize: {
        xs: ['12px', '1.4'],
        sm: ['13px', '1.45'],
        base: ['14px', '1.45'],
        md: ['16px', '1.5'],
        lg: ['20px', '1.3'],
        xl: ['24px', '1.25'],
        '2xl': ['30px', '1.2'],
      },
    },
  },
};
