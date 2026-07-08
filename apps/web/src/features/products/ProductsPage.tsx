import { Link, useSearchParams } from 'react-router-dom';
import { safeReturnTo } from '../clientSetup/index.js';
import { MasterDataCrud } from '../../components/MasterDataCrud.js';

export function ProductsPage() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const grid = (
    <MasterDataCrud
      config={{
        title: 'Products',
        subtitle: 'Loan and account products verification is run against.',
        basePath: '/api/v2/products',
        queryKey: 'products',
        codePlaceholder: 'HOME_LOAN',
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
