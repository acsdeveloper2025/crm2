/**
 * Shared tab strip — one source for the underline-tab pattern that was hand-rolled identically in
 * CaseDetailPage (task buckets) and UserRecordPage (Profile/Access). Renders an ARIA `tablist` of
 * `tab` buttons; the caller owns the panel rendering (keeps it flexible — a tab may filter a list or
 * swap a panel). Buttons are `type="button"` so a tab inside a form never submits it.
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
  return (
    <div role="tablist" className={className ? `${TABLIST_BASE} ${className}` : TABLIST_BASE}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          className={tabButtonClass(active === t.key)}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
