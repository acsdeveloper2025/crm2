import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.js';
import { useFocusTrap } from '../lib/useFocusTrap.js';
import { NotificationBell } from './NotificationBell.js';
import { JobsTray } from './JobsTray.js';
import { HeaderClock } from './HeaderClock.js';
import { UserMenu } from './UserMenu.js';
import { useRealtimeNotifications } from '../features/notifications/useNotifications.js';
import { useRealtimeJobs } from '../features/jobs/useJobs.js';

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

const BRAND = 'CRM2';

/** Frozen CRM2 navigation (web). Operations land later; all Administration screens are built. */
const OPERATIONS: { label: string; to?: string; perm?: string }[] = [
  { label: 'Dashboard', to: '/dashboard', perm: 'page.dashboard' },
  { label: 'Pipeline', to: '/pipeline', perm: 'case.view' },
  { label: 'Cases', to: '/cases', perm: 'case.view' },
  { label: 'Dedupe Check', to: '/dedupe', perm: 'dedupe.view' },
  { label: 'MIS & Billing' },
  { label: 'Billing & Commission', to: '/billing', perm: 'billing.view' },
  { label: 'Field Monitoring', to: '/field-monitoring', perm: 'page.field_monitoring' },
];
// Each item carries the SAME permission its page's read endpoint enforces (so the nav mirrors the
// API: a route the user would be 403'd from is not shown). Gated below via `has(perm)`.
const ADMINISTRATION: { label: string; to: string; perm: string }[] = [
  { label: 'Verification Units', to: '/admin/verification-units', perm: 'page.masterdata' },
  { label: 'Clients', to: '/admin/clients', perm: 'page.masterdata' },
  { label: 'Products', to: '/admin/products', perm: 'page.masterdata' },
  { label: 'CPV Mapping', to: '/admin/cpv', perm: 'page.masterdata' },
  { label: 'Rate Management', to: '/admin/rates', perm: 'page.masterdata' },
  { label: 'Commission Rates', to: '/admin/commission-rates', perm: 'masterdata.manage' },
  { label: 'MIS Layouts', to: '/admin/report-layouts', perm: 'report_template.manage' },
  { label: 'Location Management', to: '/admin/locations', perm: 'page.masterdata' },
  { label: 'User Management', to: '/admin/users', perm: 'page.users' },
  { label: 'Departments', to: '/admin/departments', perm: 'page.users' },
  { label: 'Designations', to: '/admin/designations', perm: 'page.users' },
  { label: 'Access Control', to: '/admin/rbac', perm: 'page.access' },
  { label: 'Templates', to: '/admin/templates', perm: 'page.templates' },
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
        <div className="mt-auto border-t border-border px-4 pt-3">
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
  return (
    <div className="flex min-h-screen bg-surface-muted text-foreground">
      {/* Backdrop — only below lg (overlay mode), only while open */}
      {open && (
        <button
          type="button"
          aria-label="Close menu"
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
          <span className="text-base font-bold tracking-tight text-foreground">{BRAND}</span>
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
        {/* Nav sits a little below the header line; scrolls if it outgrows the viewport. */}
        <div className="flex flex-1 flex-col overflow-y-auto pb-4 pt-5">
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
          {!open && <span className="text-base font-bold tracking-tight text-foreground">{BRAND}</span>}
          <div className="ml-auto flex items-center gap-4">
            <HeaderClock />
            <JobsTray />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
