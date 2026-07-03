import { useId, useRef, type KeyboardEvent } from 'react';

/**
 * Shared tab strip — one source for the underline-tab pattern that was hand-rolled identically in
 * CaseDetailPage (task buckets) and UserRecordPage (Profile/Access). Renders an ARIA `tablist` of
 * `tab` buttons; the caller owns the panel rendering (keeps it flexible — a tab may filter a list or
 * swap a panel). Buttons are `type="button"` so a tab inside a form never submits it.
 *
 * Keyboard (WAI-ARIA APG horizontal tablist, KN-5): roving tabindex — only the active tab is a tab
 * stop; Arrow Left/Right (wrapping) and Home/End move focus AND activate (automatic activation, cheap
 * panels). Set `panelId` on a tab whose panel is a discrete element to emit `aria-controls`; that panel
 * should carry `id={panelId}` + `role="tabpanel"` (+ `tabIndex={0}`).
 */
const TAB_BASE = 'px-3 py-1.5 text-sm font-medium';
const TABLIST_BASE = 'flex gap-1 border-b border-border';

/** Pure class fn for one tab button (unit-tested without jsdom, mirroring buttonClass). */
export function tabButtonClass(isActive: boolean): string {
  return `${TAB_BASE} ${
    isActive ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'
  }`;
}

export interface TabItem<K extends string> {
  key: K;
  label: string;
  /** Optional id of the panel this tab controls → emits `aria-controls` (put `id`+`role="tabpanel"` there). */
  panelId?: string;
}

export function Tabs<K extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: ReadonlyArray<TabItem<K>>;
  active: K;
  onChange: (key: K) => void;
  /** Extra classes on the tablist container (e.g. spacing: `mb-4`, `px-3`). */
  className?: string;
}) {
  const baseId = useId();
  const refs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({});

  const focusKey = (key: K) => {
    onChange(key);
    refs.current[key]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.key === active);
    if (i < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      focusKey(tabs[(i + dir + tabs.length) % tabs.length]!.key);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusKey(tabs[0]!.key);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusKey(tabs[tabs.length - 1]!.key);
    }
  };

  return (
    <div
      role="tablist"
      className={className ? `${TABLIST_BASE} ${className}` : TABLIST_BASE}
      onKeyDown={onKeyDown}
    >
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[t.key] = el;
            }}
            id={`${baseId}-tab-${t.key}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={t.panelId}
            tabIndex={isActive ? 0 : -1}
            className={tabButtonClass(isActive)}
            onClick={() => onChange(t.key)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
