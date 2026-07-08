import { Link, useSearchParams } from 'react-router-dom';
import { safeReturnTo } from '../clientSetup/index.js';
import { MasterDataCrud } from '../../components/MasterDataCrud.js';

export function ClientsPage() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const grid = (
    <MasterDataCrud
      config={{
        title: 'Clients',
        subtitle: 'Banks and institutions that send verification work.',
        basePath: '/api/v2/clients',
        queryKey: 'clients',
        codePlaceholder: 'HDFC',
      }}
    />
  );
  if (!returnTo) return grid;
  return (
    <div className="space-y-3">
      <Link to={returnTo} className="text-sm text-primary hover:underline">
        ← Back to Client Setup
      </Link>
      {grid}
    </div>
  );
}
