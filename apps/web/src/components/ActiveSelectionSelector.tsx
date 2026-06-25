import { useQuery } from '@tanstack/react-query';
import type { Option } from '@crm2/sdk';
import { api } from '../lib/sdk.js';
import { SearchableSelect, type Opt } from './ui/SearchableSelect.js';
import { useActiveSelection } from '../lib/ActiveSelectionContext.js';

/**
 * Navbar global client + product selector (ADR-0066). Options come from the scope-limited
 * `/clients|products/options` feeds, so a user only ever sees/selects entities in their own scope.
 * The selection narrows operational lists (Cases, Pipeline) via the DataGrid `filters` prop.
 *
 * Auto-hidden when there is nothing to narrow (≤1 client and ≤1 product in scope) — a single-client
 * user's lone client already applies implicitly through their data scope.
 */
const toOpts = (rows: Option[] | undefined, allLabel: string): Opt[] => [
  { value: '', label: allLabel },
  ...(rows ?? []).map((r) => ({ value: String(r.id), label: r.name })),
];

export function ActiveSelectionSelector() {
  const { clientId, productId, setClientId, setProductId } = useActiveSelection();
  const clients = useQuery({
    queryKey: ['clients', 'options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/clients/options'),
  });
  const products = useQuery({
    queryKey: ['products', 'options'],
    queryFn: () => api<Option[]>('GET', '/api/v2/products/options'),
  });

  // Nothing to narrow → don't clutter the header.
  if ((clients.data?.length ?? 0) <= 1 && (products.data?.length ?? 0) <= 1) return null;

  return (
    <div className="flex items-center gap-2" aria-label="Active client and product filter">
      <SearchableSelect
        value={clientId === null ? '' : String(clientId)}
        onChange={(v) => setClientId(v === '' ? null : Number(v))}
        options={toOpts(clients.data, 'All clients')}
        placeholder="All clients"
        width="min-w-[10rem]"
      />
      <SearchableSelect
        value={productId === null ? '' : String(productId)}
        onChange={(v) => setProductId(v === '' ? null : Number(v))}
        options={toOpts(products.data, 'All products')}
        placeholder="All products"
        width="min-w-[10rem]"
      />
    </div>
  );
}
