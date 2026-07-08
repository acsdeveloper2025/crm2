import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.js';
import { useFocusTrap } from '../lib/useFocusTrap.js';
import { NotificationBell } from './NotificationBell.js';
import { JobsTray } from './JobsTray.js';
import { HeaderClock } from './HeaderClock.js';
import { Logo } from './Logo.js';
import { AppFooter } from './AppFooter.js';
import { ActiveSelectionSelector } from './ActiveSelectionSelector.js';
import { UserMenu } from './UserMenu.js';
import { ThemeToggle } from './ThemeToggle.js';
import { useRealtimeNotifications } from '../features/notifications/useNotifications.js';
import { useRealtimeJobs } from '../features/jobs/useJobs.js';
import { useRealtimeCaseUpdates } from '../features/cases/useRealtimeCaseUpdates.js';
import { IdleLogoutManager } from '../features/auth/IdleLogoutManager.js';

/** Sidebar toggle glyph (VS Code / Claude-style "panel-left") — raw SVG, no icon dep. */
function PanelLeftIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  );
}

/** Frozen CRM2 navigation (web). Operations land later; all Administration screens are built. */
const OPERATIONS: { label: string; to?: string; perm?: string }[] = [
  { label: 'Dashboard', to: '/dashboard', perm: 'page.dashboard' },
  // ADR-0085: the ops LIST pages are page.operations-gated (case data itself stays case.view) — the
  // KYC verifier's nav is Dashboard + KYC Verification only; case DETAIL still opens from his queue.
  { label: 'Pipeline', to: '/pipeline', perm: 'page.operations' },
  { label: 'Cases', to: '/cases', perm: 'page.operations' },
  { label: 'KYC Verification', to: '/kyc-queue', perm: 'kyc_tasks.view' },
  { label: 'Dedupe Check', to: '/dedupe', perm: 'dedupe.view' },
  { label: 'Billing', to: '/billing', perm: 'billing.view' },
  { label: 'Commission Summary', to: '/commission-summary', perm: 'commission_summary.view' },
  { label: 'MIS', to: '/mis', perm: 'mis.view' },
  { label: 'Field Monitoring', to: '/field-monitoring', perm: 'page.field_monitoring' },
];
// Each item carries the SAME permission its page's read endpoint enforces (so the nav mirrors the
// API: a route the user would be 403'd from is not shown). Gated below via `has(perm)`.
const ADMINISTRATION: { label: string; to: string; perm: string }[] = [
  { label: 'Client Setup', to: '/admin/client-setup', perm: 'page.masterdata' },
  { label: 'Verification Units', to: '/admin/verification-units', perm: 'page.masterdata' },
  { label: 'Clients', to: '/admin/clients', perm: 'page.masterdata' },
  { label: 'Products', to: '/admin/products', perm: 'page.masterdata' },
  { label: 'CPV Mapping', to: '/admin/cpv', perm: 'page.masterdata' },
  { label: 'Rate Management', to: '/admin/rates', perm: 'page.masterdata' },
  { label: 'Rate Types', to: '/admin/rate-types', perm: 'page.masterdata' },
  { label: 'Rate Type Assignments', to: '/admin/rate-type-assignments', perm: 'page.masterdata' },
  { label: 'Commission Rates', to: '/admin/commission-rates', perm: 'masterdata.manage' },
  { label: 'Location Management', to: '/admin/locations', perm: 'page.masterdata' },
  { label: 'User Management', to: '/admin/users', perm: 'page.users' },
  { label: 'Departments', to: '/admin/departments', perm: 'page.users' },
  { label: 'Designations', to: '/admin/designations', perm: 'page.users' },
  { label: 'Access Control', to: '/admin/rbac', perm: 'page.access' },
  { label: 'Policies', to: '/admin/policies', perm: 'page.policies' },
  { label: 'System', to: '/admin/system', perm: 'page.system' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-1 space-y-0.5">{children}</div>
    </div>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-1.5 text-sm transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-secondary-foreground hover:bg-accent hover:text-accent-foreground'
  }`;

/** Shared sidebar nav — same markup at every breakpoint (the brand lives in the sidebar logo bar). */
function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const has = (perm: string) =>
    !!user && (user.grantsAll === true || (user.permissions ?? []).includes(perm));
  const adminItems = ADMINISTRATION.filter((a) => has(a.perm));
  return (
    <>
      <Section title="Operations">
        {OPERATIONS.filter((o) => !o.perm || has(o.perm)).map((o) =>
          o.to ? (
            <NavLink key={o.label} to={o.to} className={navLinkClass} onClick={onNavigate}>
              {o.label}
            </NavLink>
          ) : (
            <div
              key={o.label}
              aria-disabled="true"
              className="cursor-not-allowed px-3 py-1.5 text-sm text-muted-foreground/60"
            >
              {o.label}
            </div>
          ),
        )}
      </Section>
      {adminItems.length > 0 && (
        <Section title="Administration">
          {adminItems.map((a) => (
            <NavLink key={a.label} to={a.to} className={navLinkClass} onClick={onNavigate}>
              {a.label}
            </NavLink>
          ))}
        </Section>
      )}
      {/* Footer carries identity only — Profile / Security / Sign Out moved to the header account menu. */}
      {user && (
        <div className="mt-auto flex min-h-14 flex-col justify-center border-t border-border px-4">
          <div className="truncate text-sm font-medium text-foreground">{user.name}</div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {user.role.replace(/_/g, ' ')}
          </div>
        </div>
      )}
    </>
  );
}

const isWide = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

export function Layout({ children }: { children: React.ReactNode }) {
  // One hamburger-driven sidebar at every breakpoint. Starts open on laptop/desktop, closed on phones.
  const [open, setOpen] = useState(isWide);
  // Track the lg breakpoint reactively so the mobile focus-trap deactivates on resize to desktop.
  const [wide, setWide] = useState(isWide);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    // Crossing the lg boundary re-syncs both flags: the sidebar is in-flow (open) on desktop and
    // collapsed behind the hamburger on phones. Driving `open` off the breakpoint here also makes
    // the state deterministic regardless of whether Layout mounts before or after a viewport change.
    const onChange = () => {
      setWide(mq.matches);
      setOpen(mq.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const closeOnMobileNav = () => {
    if (!wide) setOpen(false);
  };
  // Below lg the sidebar is a fixed overlay drawer → trap focus + close on Escape (a11y 2.1.2/2.4.3).
  // At lg+ it is `lg:static` in-flow navigation, so the trap MUST stay inert (never trap desktop users).
  const drawerTrapActive = open && !wide;
  const drawerRef = useFocusTrap<HTMLElement>(drawerTrapActive, () => setOpen(false));
  // Live channel (ADR-0027): connects the socket + refetches the bell/roster on pushed events.
  useRealtimeNotifications();
  // Background-job progress/completion (ADR-0030): live-updates the Jobs tray.
  useRealtimeJobs();
  // Case/task status changes (ADR-0027): refetch case/pipeline/dashboard on device + office actions.
  useRealtimeCaseUpdates();
  return (
    <div className="flex min-h-screen bg-surface-muted text-foreground">
      {/* Skip link (a11y) — the first tab stop, so keyboard users can jump past the nav to the
          page content; visually hidden until focused. */}
      <a
        href="#main"
        className="sr-only rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50"
      >
        Skip to content
      </a>
      {/* Idle / absolute-session auto-logout (ADR-0045) — self-disables for exempt roles. */}
      <IdleLogoutManager />
      {/* Backdrop — only below lg (overlay mode), only while open. aria-hidden + tabIndex=-1 (like the
          DataGrid menu backdrops) so a mouse-close never moves focus onto it and orphans it (KN-6);
          keyboard users close via Escape (the drawer focus-trap) or a nav link. */}
      {open && (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          className="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar — below lg: fixed overlay drawer; lg+: in-flow, pushes the content. Hidden when closed. */}
      <aside
        ref={drawerRef}
        className={
          open
            ? 'fixed inset-y-0 left-0 z-40 flex w-60 max-w-[80vw] shrink-0 flex-col border-r border-border bg-card shadow-lg lg:static lg:z-auto lg:max-w-none lg:shadow-none'
            : 'hidden'
        }
      >
        {/* Logo bar — brand + collapse toggle. Same h-14 + border-b as the header so the two bottom
            borders meet as one continuous line across the full width. */}
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
          <Logo />
          <button
            type="button"
            aria-label="Collapse menu"
            aria-expanded={open}
            className="rounded-md p-1 text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => setOpen(false)}
          >
            <PanelLeftIcon />
          </button>
        </div>
        {/* Nav sits a little below the header line; scrolls if it outgrows the viewport. The identity
            bar below is flush to the bottom (no pb-4) so its top border lines up with the content footer. */}
        <div className="flex flex-1 flex-col overflow-y-auto pt-5">
          <NavContent onNavigate={closeOnMobileNav} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — the open affordance + brand show only while the sidebar is closed (two-button
            split, like v1); the live IST clock + bell sit on the right. */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
          {/* The open affordance stays mounted (hidden while open) so the focus trap can restore
              focus to it on close — a conditionally-rendered trigger would be a detached node. */}
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={open}
            className={`rounded-md p-1 text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground${
              open ? ' hidden' : ''
            }`}
            onClick={() => setOpen(true)}
          >
            <PanelLeftIcon />
          </button>
          {!open && <Logo />}
          {/* Global client+product filter (ADR-0066) — desktop only (hidden <lg to avoid header
              overflow; auto-hides for single-client users). Convenience narrowing, not a security gate. */}
          <div className="ml-4 hidden lg:flex">
            <ActiveSelectionSelector />
          </div>
          <div className="ml-auto flex items-center gap-4">
            <HeaderClock />
            <ThemeToggle />
            <JobsTray />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-6 focus:outline-none">
          {children}
        </main>
        <footer className="flex min-h-14 shrink-0 items-center border-t border-border px-4">
          <AppFooter className="w-full" />
        </footer>
      </div>
    </div>
  );
}
