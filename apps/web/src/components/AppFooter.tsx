/**
 * App footer line — rendered at the bottom of every screen (the authenticated shell in Layout
 * and the standalone login page). The single source for the "Powered by / copyright / version"
 * text. Version is injected from apps/web/package.json (vite.config `define`); the year is live.
 *
 * Brand policy (DESIGN_AND_STACK_FREEZE.md): CRM2 only — no ACS name/marks anywhere.
 */
export function AppFooter({ className = '' }: { className?: string }) {
  const year = new Date().getFullYear();
  return (
    <p className={`text-center text-xs text-muted-foreground ${className}`}>
      Powered by CRM2 · © {year} CRM2. All rights reserved. · v{__APP_VERSION__}
    </p>
  );
}
