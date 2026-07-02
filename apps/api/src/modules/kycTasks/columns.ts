import type { FilterField } from '../../platform/pagination.js';

/**
 * KYC-queue column registry (ADR-0085, MIS pattern): every column's SQL is a code-owned constant —
 * the API accepts only registry KEYS (unknown/duplicate → 400), so no request string ever reaches
 * SQL. `fe` = the task's FIRST-export event (LEFT JOIN, 1:1 by the partial unique), `ue` = its
 * exporter. No money columns on this surface (nothing billing.view-gated leaves via the KYC queue).
 */
export interface KycQueueColumn {
  key: string;
  label: string;
  dataType: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'JSON';
  sql: string;
  sortable?: boolean;
  filterable?: boolean;
  defaultVisible?: boolean;
  filterKind?: FilterField['kind'];
}

export const KYC_QUEUE_COLUMNS: KycQueueColumn[] = [
  {
    key: 'taskNumber',
    label: 'Task #',
    dataType: 'TEXT',
    sql: 'ct.task_number',
    sortable: true,
    filterable: true,
    defaultVisible: true,
  },
  {
    key: 'caseNumber',
    label: 'Case #',
    dataType: 'TEXT',
    sql: 'cs.case_number',
    sortable: true,
    filterable: true,
    defaultVisible: true,
  },
  {
    key: 'clientName',
    label: 'Client',
    dataType: 'TEXT',
    sql: 'cl.name',
    filterable: true,
    defaultVisible: true,
  },
  { key: 'productName', label: 'Product', dataType: 'TEXT', sql: 'p.name', filterable: true },
  {
    key: 'unitCategory',
    label: 'Category',
    dataType: 'SELECT',
    sql: 'vu.category',
    filterable: true,
    filterKind: 'code',
  },
  {
    key: 'unitName',
    label: 'Document type',
    dataType: 'TEXT',
    sql: 'vu.name',
    filterable: true,
    defaultVisible: true,
  },
  {
    key: 'documentNumber',
    label: 'Document number',
    dataType: 'TEXT',
    sql: 'ct.document_number',
    filterable: true,
    defaultVisible: true,
  },
  {
    key: 'documentHolderName',
    label: 'Name on document',
    dataType: 'TEXT',
    sql: 'ct.document_holder_name',
    defaultVisible: true,
  },
  // Rendered one line per label in the grid; exported one COLUMN per label (never one flattened cell).
  {
    key: 'documentDetails',
    label: 'Details',
    dataType: 'JSON',
    sql: 'ct.document_details',
    defaultVisible: true,
  },
  {
    key: 'applicantName',
    label: 'Applicant',
    dataType: 'TEXT',
    sql: 'ta.name',
    filterable: true,
    defaultVisible: true,
  },
  { key: 'applicantPan', label: 'Applicant PAN', dataType: 'TEXT', sql: 'ta.pan' },
  { key: 'applicantMobile', label: 'Applicant mobile', dataType: 'TEXT', sql: 'ta.mobile' },
  { key: 'applicantCompany', label: 'Applicant company', dataType: 'TEXT', sql: 'ta.company_name' },
  { key: 'trigger', label: 'Trigger', dataType: 'TEXT', sql: 'ct.trigger' },
  {
    key: 'priority',
    label: 'Priority',
    dataType: 'SELECT',
    sql: 'ct.priority',
    filterable: true,
    filterKind: 'code',
  },
  {
    key: 'status',
    label: 'Task status',
    dataType: 'SELECT',
    sql: 'ct.status',
    filterable: true,
    filterKind: 'code',
    defaultVisible: true,
  },
  {
    key: 'assignedAt',
    label: 'Assigned',
    dataType: 'DATE',
    sql: 'ct.assigned_at',
    sortable: true,
    filterable: true,
    filterKind: 'date',
    defaultVisible: true,
  },
  { key: 'createdAt', label: 'Created', dataType: 'DATE', sql: 'ct.created_at', sortable: true },
  { key: 'tatHours', label: 'TAT (h)', dataType: 'NUMBER', sql: 'ct.tat_hours' },
  {
    key: 'exportedAt',
    label: 'Exported',
    dataType: 'DATE',
    sql: 'fe.created_at',
    sortable: true,
    defaultVisible: true,
  },
  { key: 'exportedBy', label: 'Exported by', dataType: 'TEXT', sql: 'ue.name', defaultVisible: true },
  {
    key: 'exportCount',
    label: 'Exports',
    dataType: 'NUMBER',
    sql: '(SELECT count(*)::int FROM task_export_events e2 WHERE e2.task_id = ct.id)',
    defaultVisible: true,
  },
];

export const KYC_QUEUE_COLUMNS_BY_KEY: ReadonlyMap<string, KycQueueColumn> = new Map(
  KYC_QUEUE_COLUMNS.map((c) => [c.key, c]),
);
