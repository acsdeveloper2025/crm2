import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Option, ClientProductView, Paginated } from '@crm2/sdk';
import { api } from '../lib/sdk.js';
import { SearchableSelect, type Opt } from './ui/SearchableSelect.js';
import { useActiveSelection } from '../lib/ActiveSelectionContext.js';
import { useAuth } from '../lib/AuthContext.js';

/**
 * Navbar global client + product selector (ADR-0066). Both dropdowns are SCOPE-LIMITED: the
 * `/clients|products/options` feeds resolve `scopedEntityIds(actor, …)` server-side, so a user only
 * ever sees/selects clients/products in their own data scope. The selection narrows operational lists
 * (Cases, Pipeline) via the DataGrid `filters` prop.
 *
 * Client→product cascade (v1 parity): when a client is chosen, the product dropdown shows ONLY the
 * products mapped to that client (`client_products` / CPV), intersected client-side with the scoped
 * product list — i.e. products that are BOTH assigned to the client AND in the user's portfolio. With
 * no client chosen ("All clients") it shows the full scoped product list.
 *
 * Auto-hidden when there is nothing to narrow (≤1 client and ≤1 product in scope).
 */
const toOpts = (rows: { id: number; name: string }[], allLabel: string): Opt[] => [
  { value: '', label: allLabel },
  ...rows.map((r) => ({ value: String(r.id), label: r.name })),
];

export function ActiveSelectionSelector() {
  const { clientId, productId, setClientId, setProductId } = useActiveSelection();
  // The `/clients|products/options` feeds require `page.masterdata` (same as the endpoints). Roles
  // without it (KYC_VERIFIER, FIELD_AGENT on web) would 403 on every page — and every role that can
  // actually use this filter (page.operations ⇒ Cases/Pipeline) also holds page.masterdata. Gate the
  // fetches so an unauthorised role never fires them (the selector already hides when there's nothing).
  const { has } = useAuth();
  const canView = has('page.masterdata');

  const clients = useQuery({
    queryKey: ['clients', 'options'],
    enabled: canView,
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  // All in-scope products — shown when no client is chosen.
  const products = useQuery({
    queryKey: ['products', 'options'],
    enabled: canView,
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });
  // Products mapped to the chosen client (CPV). The CPV list endpoint is not user-scoped, so the
  // result is intersected with the scoped product list below — never widening beyond the user's scope.
  const clientProducts = useQuery({
    queryKey: ['client-products', 'selector', clientId],
    enabled: canView && clientId !== null,
    queryFn: () =>
      api<Paginated<ClientProductView>>('GET', `/api/v2/client-products?clientId=${clientId}&limit=500`),
  });

  const scopedProducts = useMemo(() => products.data ?? [], [products.data]);
  const productOpts = useMemo<Opt[]>(() => {
    if (clientId === null) return toOpts(scopedProducts, 'All products');
    const mapped = new Set((clientProducts.data?.items ?? []).map((cp) => cp.productId));
    return toOpts(
      scopedProducts.filter((p) => mapped.has(p.id)),
      'All products',
    );
  }, [clientId, scopedProducts, clientProducts.data]);

  // Nothing to narrow → don't clutter the header.
  if ((clients.data?.length ?? 0) <= 1 && scopedProducts.length <= 1) return null;

  return (
    <div className="flex items-center gap-2" aria-label="Active client and product filter">
      <SearchableSelect
        value={clientId === null ? '' : String(clientId)}
        onChange={(v) => setClientId(v === '' ? null : Number(v))}
        options={toOpts(clients.data ?? [], 'All clients')}
        placeholder="All clients"
        width="min-w-[10rem]"
      />
      <SearchableSelect
        value={productId === null ? '' : String(productId)}
        onChange={(v) => setProductId(v === '' ? null : Number(v))}
        options={productOpts}
        placeholder={clientId === null ? 'All products' : 'Products for client'}
        width="min-w-[10rem]"
      />
    </div>
  );
}
