import { describe, it, expect } from 'vitest';
import type { CaseReportContext } from '@crm2/sdk';
import { renderCaseReportXlsx, csvSafe } from '../xlsx.js';

const ctx = (overrides: Partial<CaseReportContext> = {}): CaseReportContext => ({
  case: {
    id: 'c1',
    caseNumber: 'CASE-001',
    customerName: 'RAJESH KUMAR',
    customerPhone: '9876543210',
    panNumber: 'ABCDE1234F',
    applicantType: 'APPLICANT',
    backendContactNumber: '1112223334',
    status: 'IN_PROGRESS',
    trigger: 'NEW',
    priority: 'MEDIUM',
    receivedDate: '2026-06-10T09:00:00Z',
    completedDate: null,
    verificationOutcome: 'POSITIVE',
    resultRemark: null,
    tatDays: 2,
  },
  client: { id: 1, name: 'Axis Bank' },
  product: { id: 2, name: 'HOME LOAN' },
  applicants: [
    {
      id: 'a1',
      name: 'RAJESH KUMAR',
      mobile: '9876543210',
      pan: 'ABCDE1234F',
      applicantType: 'APPLICANT',
      isPrimary: true,
    },
  ],
  tasks: [
    {
      id: 't1',
      taskNumber: 'CASE-001-1',
      verificationType: 'RESIDENCE',
      unitName: 'Residence',
      applicantName: 'RAJESH KUMAR',
      address: '12 MG ROAD',
      outcome: 'POSITIVE',
      remark: null,
      completedAt: '2026-06-12T09:00:00Z',
      completedByName: 'Office User',
      narrative: 'Visited.',
      sections: [],
      photos: [
        {
          id: 'p1',
          photoType: 'RESIDENCE_FRONT',
          url: 'https://signed.example/k/a.jpg',
          latitude: 12.97,
          longitude: 77.59,
          accuracy: 8,
          reverseGeocodedAddress: 'MG Road, Bengaluru',
          captureTime: '2026-06-12T10:00:00Z',
          mapImage: null,
        },
      ],
    },
  ],
  totals: {
    totalTasks: 1,
    completedTasks: 1,
    positiveTasks: 1,
    negativeTasks: 0,
    referTasks: 0,
    fraudTasks: 0,
    photoCount: 1,
  },
  generation: {
    generatedAt: '2026-06-17T09:00:00Z',
    generatedById: 'u1',
    generatedByName: 'System Administrator',
  },
  layout: null,
  ...overrides,
});

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // xlsx is a zip

describe('CASE_REPORT xlsx render (ADR-0041 S5 slice 5)', () => {
  it('renders a valid .xlsx (zip) workbook from the context', async () => {
    const buf = await renderCaseReportXlsx(ctx());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4)).toEqual(ZIP_MAGIC);
  });

  it('csvSafe neutralizes spreadsheet formula-injection (=/+/-/@/tab/CR), passes plain text through', () => {
    expect(csvSafe('=cmd|calc')).toBe("'=cmd|calc");
    expect(csvSafe('+1234')).toBe("'+1234");
    expect(csvSafe('-1+1')).toBe("'-1+1");
    expect(csvSafe('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvSafe('\t=evil')).toBe("'\t=evil");
    // plain values are untouched
    expect(csvSafe('RAJESH KUMAR')).toBe('RAJESH KUMAR');
    expect(csvSafe('12 MG ROAD')).toBe('12 MG ROAD');
    expect(csvSafe(null)).toBe('');
    expect(csvSafe(42)).toBe('42');
  });

  it('a malicious applicant name still yields a valid workbook (guard does not break the render)', async () => {
    const c = ctx();
    c.case.customerName = '=cmd|calc';
    c.tasks[0]!.applicantName = '+1234';
    const buf = await renderCaseReportXlsx(c);
    expect(buf.subarray(0, 4)).toEqual(ZIP_MAGIC);
    expect(buf.length).toBeGreaterThan(1000);
  });
});
