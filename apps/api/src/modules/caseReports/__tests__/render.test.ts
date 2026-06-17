import { describe, it, expect } from 'vitest';
import type { CaseReportContext } from '@crm2/sdk';
import { renderCaseReportHtml, DEFAULT_CASE_REPORT_TEMPLATE } from '../render.js';

const baseCtx = (overrides: Partial<CaseReportContext> = {}): CaseReportContext => ({
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
    verificationOutcome: null,
    resultRemark: null,
    tatDays: null,
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

describe('CASE_REPORT HTML render (ADR-0041 S5 slice 2a)', () => {
  it('renders the built-in default with case + applicants + task + narrative + photo', () => {
    const html = renderCaseReportHtml(baseCtx(), null);
    expect(html).toContain('Axis Bank');
    expect(html).toContain('HOME LOAN');
    expect(html).toContain('CASE-001');
    expect(html).toContain('RAJESH KUMAR');
    expect(html).toContain('Residence — CASE-001-1');
    // narrative newline → <br>
    expect(html).toContain('Visited the address.<br>Applicant met.');
    expect(html).toContain('BTM LAYOUT');
    expect(html).toContain('https://signed.example/k/a.jpg');
    expect(html).toContain('MG Road, Bengaluru');
    expect(html).toContain('POSITIVE');
  });

  it('OUTPUT-ENCODES user-controlled values — XSS in a name/narrative is inert (Security BLOCK-level)', () => {
    const ctx = baseCtx();
    ctx.case.customerName = '<script>alert(1)</script>';
    ctx.applicants[0]!.name = '<img src=x onerror=alert(2)>';
    ctx.tasks[0]!.narrative = 'line1\n<script>alert(3)</script>';
    ctx.tasks[0]!.sections[0]!.fields[0]!.value = '<b>danger</b>';
    const html = renderCaseReportHtml(ctx, null);
    // No raw script/img-onerror tag survives — all escaped to entities.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(3)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(2)>');
    expect(html).not.toContain('<b>danger</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // Handlebars also escapes `=` → `&#x3D;`, so the img attrs can't reassemble into a real tag.
    expect(html).toContain('&lt;img');
    // nl2br escapes THEN adds <br>: the script is escaped, only the structural <br> is real markup.
    expect(html).toContain('line1<br>&lt;script&gt;alert(3)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;danger&lt;/b&gt;');
  });

  it('escapes a malicious presigned URL in the img src (no attribute-breakout)', () => {
    const ctx = baseCtx();
    ctx.tasks[0]!.photos[0]!.url = 'x" onerror="alert(4)';
    const html = renderCaseReportHtml(ctx, null);
    expect(html).not.toContain('onerror="alert(4)"');
    expect(html).toContain('&quot;');
  });

  it('renders an admin layout body when provided (still auto-escaped)', () => {
    const body = '<h1>{{client.name}}</h1><p>{{case.customerName}}</p>';
    const ctx = baseCtx();
    ctx.case.customerName = '<script>x</script>';
    const html = renderCaseReportHtml(ctx, body);
    expect(html).toContain('<h1>Axis Bank</h1>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>x</script>');
  });

  it('the built-in default template contains NO triple-stash (output-encoding invariant)', () => {
    expect(DEFAULT_CASE_REPORT_TEMPLATE).not.toMatch(/\{\{\{/);
  });
});
