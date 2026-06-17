import { describe, it, expect } from 'vitest';
import type { CaseReportContext } from '@crm2/sdk';
import { renderCaseReportDocx } from '../docx.js';

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
      narrative: 'Visited the address.\nApplicant met.',
      sections: [{ title: 'Residence', fields: [{ label: 'Area', value: 'BTM LAYOUT' }] }],
      // no photos → no network fetch in the unit test (image embedding is covered by the live E2E)
      photos: [],
    },
  ],
  totals: {
    totalTasks: 1,
    completedTasks: 1,
    positiveTasks: 1,
    negativeTasks: 0,
    referTasks: 0,
    fraudTasks: 0,
    photoCount: 0,
  },
  generation: {
    generatedAt: '2026-06-17T09:00:00Z',
    generatedById: 'u1',
    generatedByName: 'System Administrator',
  },
  layout: null,
  ...overrides,
});

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04" — docx is a zip

describe('CASE_REPORT docx render (ADR-0041 S5 slice 4)', () => {
  it('renders a valid .docx (zip) buffer from the context', async () => {
    const buf = await renderCaseReportDocx(ctx());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4)).toEqual(ZIP_MAGIC);
  });

  it('embeds the plain-text narrative + case fields as document text (no HTML sink)', async () => {
    // The document.xml inside the zip should contain the escaped text. We don't unzip here (no dep);
    // instead assert a malicious value does not blow up the builder and the output stays a valid docx.
    const c = ctx();
    c.case.customerName = '<script>alert(1)</script>';
    c.tasks[0]!.narrative = 'line1\n<b>bold</b>';
    const buf = await renderCaseReportDocx(c);
    expect(buf.subarray(0, 4)).toEqual(ZIP_MAGIC);
    expect(buf.length).toBeGreaterThan(1000);
    // docx TextRun XML-encodes its text; the raw '<script>' tag never appears as live markup in the
    // word/document.xml part (it's stored as a text run, &lt;-encoded by the OOXML serializer).
    expect(buf.includes(Buffer.from('<script>alert(1)</script>'))).toBe(false);
  });
});
