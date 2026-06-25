import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Global "active selection" — a navbar-driven CONVENIENCE filter (ADR-0066): the user picks a client
 * (+ optional product) and operational lists (Cases, Pipeline) narrow to it. It is NOT a security
 * boundary — the server ANDs it with the hard data-scope predicate (ADR-0022) and the dropdown options
 * are themselves scope-limited (`/clients|products/options`), so the selection can only narrow WITHIN
 * what the user is already allowed to see, never widen it.
 *
 * Per-tab (sessionStorage, not localStorage): the selection dies with the tab and cannot leak across
 * browser sessions. Lists re-key automatically — each passes the selection into the DataGrid `filters`
 * prop, which is part of the grid's react-query key, so changing the selection refetches.
 */
const KEY = 'crm2.activeSelection';

export interface ActiveSelection {
  clientId: number | null;
  productId: number | null;
}

interface ActiveSelectionContextValue extends ActiveSelection {
  setClientId: (id: number | null) => void;
  setProductId: (id: number | null) => void;
}

const ActiveSelectionContext = createContext<ActiveSelectionContextValue | null>(null);

function load(): ActiveSelection {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { clientId: null, productId: null };
    const v = JSON.parse(raw) as Partial<ActiveSelection>;
    return {
      clientId: typeof v.clientId === 'number' ? v.clientId : null,
      productId: typeof v.productId === 'number' ? v.productId : null,
    };
  } catch {
    return { clientId: null, productId: null };
  }
}

function save(sel: ActiveSelection): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(sel));
  } catch {
    /* sessionStorage unavailable (private mode / disabled) — selection stays in-memory only */
  }
}

export function ActiveSelectionProvider({ children }: { children: ReactNode }) {
  const [sel, setSel] = useState<ActiveSelection>(load);

  const apply = useCallback((next: ActiveSelection) => {
    setSel(next);
    save(next);
  }, []);

  // Changing the client clears the product (the product list is client-dependent).
  const setClientId = useCallback((id: number | null) => apply({ clientId: id, productId: null }), [apply]);
  const setProductId = useCallback(
    (id: number | null) => apply({ clientId: sel.clientId, productId: id }),
    [apply, sel.clientId],
  );

  const value = useMemo<ActiveSelectionContextValue>(
    () => ({ clientId: sel.clientId, productId: sel.productId, setClientId, setProductId }),
    [sel.clientId, sel.productId, setClientId, setProductId],
  );

  return <ActiveSelectionContext.Provider value={value}>{children}</ActiveSelectionContext.Provider>;
}

export function useActiveSelection(): ActiveSelectionContextValue {
  const ctx = useContext(ActiveSelectionContext);
  if (!ctx) throw new Error('useActiveSelection must be used within an ActiveSelectionProvider');
  return ctx;
}

/**
 * The active selection as DataGrid `filters` entries (top-level `clientId`/`productId` query params,
 * read server-side by the cases/tasks list endpoints). Spread into a list's `filters` prop; absent keys
 * mean "all". Returned as strings — the DataGrid `filters` contract is string/boolean/undefined.
 */
export function useActiveSelectionFilters(): Record<string, string | undefined> {
  const { clientId, productId } = useActiveSelection();
  return useMemo(
    () => ({
      ...(clientId !== null ? { clientId: String(clientId) } : {}),
      ...(productId !== null ? { productId: String(productId) } : {}),
    }),
    [clientId, productId],
  );
}
