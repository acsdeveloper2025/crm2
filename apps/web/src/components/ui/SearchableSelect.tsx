import { useId, useState } from 'react';

/** One option in a {@link SearchableSelect}: the committed `value` and its display `label`. */
export type Opt = { value: string; label: string };

/**
 * A type-to-search dropdown. Static lists filter client-side; pass `onQueryChange` to let a parent
 * refine the option set server-side (used for the huge pincode list).
 *
 * Keyboard combobox (K3): ArrowDown/Up move the active option, Enter selects, Escape closes —
 * role=combobox/listbox/option + aria-activedescendant keep it operable without a mouse.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  onQueryChange,
  disabled,
  width = 'min-w-[12rem]',
}: {
  value: string;
  onChange: (v: string) => void;
  options: Opt[];
  placeholder?: string;
  onQueryChange?: (q: string) => void;
  disabled?: boolean;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const selected = options.find((o) => o.value === value);
  const filtered = onQueryChange
    ? options
    : options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  // Keep the active option in range as the list shrinks while typing.
  const hl = filtered.length === 0 ? -1 : Math.min(highlight, filtered.length - 1);

  const commit = (o: Opt) => {
    onChange(o.value);
    setOpen(false);
  };

  // Keyboard combobox (K3): the picker previously committed on onMouseDown only, so keyboard users
  // could never select an option. Arrow keys move the active option, Enter selects, Escape closes.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && hl >= 0 && filtered[hl]) {
        e.preventDefault();
        commit(filtered[hl]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };

  return (
    <div className={`relative ${width}`}>
      <input
        className="input w-full disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        disabled={disabled}
        placeholder={placeholder ?? 'Search…'}
        value={open ? q : (selected?.label ?? '')}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && hl >= 0 ? `${listId}-opt-${hl}` : undefined}
        onFocus={() => {
          setOpen(true);
          setQ('');
          setHighlight(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          setQ(e.target.value);
          setHighlight(0);
          onQueryChange?.(e.target.value);
        }}
      />
      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-card shadow-lg"
        >
          {filtered.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">No matches</li>}
          {filtered.map((o, i) => (
            <li key={o.value}>
              <button
                id={`${listId}-opt-${i}`}
                type="button"
                role="option"
                aria-selected={i === hl}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-muted ${
                  i === hl ? 'bg-surface-muted' : ''
                }`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(o);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
