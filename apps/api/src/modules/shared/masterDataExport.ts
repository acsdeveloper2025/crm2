import type { ExportColumn } from '../../platform/export/index.js';

/** The common code/name/effective/status/audit shape shared by master-data lists (clients, products). */
interface MasterDataRow {
  code: string;
  name: string;
  isActive: boolean;
  effectiveFrom: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The DataGrid export manifest for the shared MasterDataCrud lists (clients/products). Column `id`s
 * match the FE DataGrid column ids so the visible-columns (`cols`) selection filters + orders them;
 * the `actions` column has no data value and is simply absent here.
 */
export function masterDataExportColumns<T extends MasterDataRow>(): ExportColumn<T>[] {
  return [
    { id: 'code', header: 'Code', value: (r) => r.code },
    { id: 'name', header: 'Name', value: (r) => r.name },
    { id: 'effectiveFrom', header: 'Effective From', value: (r) => r.effectiveFrom },
    { id: 'createdAt', header: 'Created', value: (r) => r.createdAt },
    { id: 'updatedAt', header: 'Updated', value: (r) => r.updatedAt },
    { id: 'status', header: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive') },
  ];
}
