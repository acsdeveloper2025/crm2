import { MasterDataCrud } from '../../components/MasterDataCrud.js';

export function ProductsPage() {
  return (
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
}
