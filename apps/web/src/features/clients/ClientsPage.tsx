import { MasterDataCrud } from '../../components/MasterDataCrud.js';

export function ClientsPage() {
  return (
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
}
