import type { KycResult, ApplicantType, CaseStatus, Priority } from './cases.js';
import type { PageSize, PageOrientation } from './reportLayouts.js';

/** Page geometry for the PDF when no CASE_REPORT layout is configured (ADR-0041 slice 2b), and the
 *  Designer's default pickers (slice 3). */
export const DEFAULT_PDF_PAGE_SIZE: PageSize = 'A4';
export const DEFAULT_PDF_ORIENTATION: PageOrientation = 'portrait';

/** Downloadable CASE_REPORT formats (ADR-0041). The report is generated as ONE background job
 *  (JobType=CASE_REPORT) parameterized by `format` — pdf (slice 2b, Puppeteer), docx (slice 4, the
 *  `docx` package), xlsx (slice 5, exceljs). All three reuse the job tray + presigned-URL download. */
export const CASE_REPORT_FORMATS = ['pdf', 'docx', 'xlsx'] as const;
export type CaseReportFormat = (typeof CASE_REPORT_FORMATS)[number];

/**
 * @crm2/sdk — CASE_REPORT engine contract (ADR-0041). The case-level downloadable client report
 * (PDF/Word/Excel) is composed by a server-side ASSEMBLY ENGINE into a `CaseReportContext` and then
 * rendered by one of three sinks (Slice 2 PDF / Slice 4 docx / Slice 5 xlsx). All three sinks read
 * the SAME context — no per-format duplication.
 *
 * Result source = single-layer (v2-by-design): `case_tasks.verification_outcome` per task,
 * `cases.verification_outcome` per case. Both server-written on completion; no FE-mutable draft.
 *
 * Output-encoding (Security BLOCK-level): the per-task `narrative` + raw `sections` come from the
 * FIELD_REPORT engine as PLAIN TEXT (noEscape:true). Every renderer MUST output-encode at the sink
 * boundary — PDF via Handlebars auto-escape (noEscape:false); docx via TextRun's plain-text API;
 * xlsx via exceljs's value setter + formula-injection guard. Triple-stash (`{{{var}}}`) is forbidden
 * in CASE_REPORT template bodies (lint gate at save in Slice 3).
 */

/** A submitted field group from the FIELD_REPORT engine (mirrors FieldReportSection). */
export interface CaseReportSection {
  title: string;
  fields: { label: string; value: string }[];
}

/** One field photo (ADR-0034) with the frozen reverse-geocoded address (Slice C closes the v1 gap). */
export interface CaseReportPhoto {
  id: string;
  /** Photo type slug from the device (RESIDENCE_FRONT, OFFICE_BOARD, …); null when unset. */
  photoType: string | null;
  /** Server-issued presigned URL the renderer fetches the image bytes from. */
  url: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  /** Frozen by ADR-0040 trigger; null when geocoding is unconfigured or the resolver returned null. */
  reverseGeocodedAddress: string | null;
  /** From geo_location.timestamp; the shutter time on the device. */
  captureTime: string | null;
}

/** Per-task block: identity + dispatch + the OFFICIAL outcome + the FIELD_REPORT engine's narrative
 *  and raw sections (PLAIN TEXT, must be encoded by every renderer) + the task's field photos. */
export interface CaseReportTask {
  id: string;
  taskNumber: string;
  verificationType: string;
  unitName: string;
  applicantName: string;
  address: string;
  /** OFFICIAL per-task result (mig 0041); null until the task is COMPLETED with a result. */
  outcome: KycResult | null;
  remark: string | null;
  completedAt: string | null;
  completedByName: string | null;
  /** FIELD_REPORT engine output (ADR-0039) — plain text; null when no template configured. */
  narrative: string | null;
  /** FIELD_REPORT raw submitted fields, grouped by form-type slug; [] when no form_data. */
  sections: CaseReportSection[];
  /** Field photos grouped under this task (kind=FIELD_PHOTO, ADR-0034 + ADR-0040 address). */
  photos: CaseReportPhoto[];
}

export interface CaseReportContext {
  case: {
    id: string;
    caseNumber: string;
    customerName: string;
    customerPhone: string | null;
    panNumber: string | null;
    applicantType: ApplicantType | null;
    backendContactNumber: string;
    status: CaseStatus;
    /** Trigger from the primary task (dispatch bank instruction; empty when no tasks). */
    trigger: string;
    priority: Priority | null;
    receivedDate: string;
    completedDate: string | null;
    /** OFFICIAL per-case result (mig 0052); null until case.finalize. */
    verificationOutcome: KycResult | null;
    resultRemark: string | null;
    tatDays: number | null;
  };
  client: { id: number; name: string };
  product: { id: number; name: string };
  applicants: {
    id: string;
    name: string;
    mobile: string | null;
    pan: string | null;
    applicantType: ApplicantType;
    isPrimary: boolean;
  }[];
  tasks: CaseReportTask[];
  totals: {
    totalTasks: number;
    completedTasks: number;
    positiveTasks: number;
    negativeTasks: number;
    referTasks: number;
    fraudTasks: number;
    photoCount: number;
  };
  generation: {
    generatedAt: string;
    generatedById: string;
    generatedByName: string;
  };
  /** The active CASE_REPORT layout for (client, product) — id/name/page/version. Null = no template
   *  configured yet; renderers degrade to a built-in default in slice 2 onward. */
  layout: {
    id: number;
    name: string;
    pageSize: PageSize;
    pageOrientation: PageOrientation;
    version: number;
  } | null;
}

/** The fixed CASE_REPORT variable catalog (ADR-0041 slice 3) — the `{{ }}` paths a Designer template
 *  may reference, grouped for the reference panel. CASE_REPORT renders against this FIXED context
 *  (unlike FIELD_REPORT, whose columns ARE its catalog), so the list is code-defined, not stored. */
export const CASE_REPORT_VARIABLE_CATALOG: { group: string; vars: { path: string; note: string }[] }[] = [
  {
    group: 'Case',
    vars: [
      { path: 'case.caseNumber', note: 'Case number' },
      { path: 'case.customerName', note: 'Primary applicant name' },
      { path: 'case.customerPhone', note: 'Primary mobile' },
      { path: 'case.panNumber', note: 'Primary PAN' },
      { path: 'case.applicantType', note: 'APPLICANT / CO_APPLICANT' },
      { path: 'case.backendContactNumber', note: 'Office contact' },
      { path: 'case.status', note: 'Case status' },
      { path: 'case.trigger', note: 'Bank instruction' },
      { path: 'case.verificationOutcome', note: 'OFFICIAL case result' },
      { path: 'case.resultRemark', note: 'Case result remark' },
      { path: 'case.receivedDate', note: 'Created (use {{fmtDate …}})' },
      { path: 'case.completedDate', note: 'Completed (use {{fmtDate …}})' },
      { path: 'case.tatDays', note: 'Turnaround days' },
    ],
  },
  {
    group: 'Client / Product / Totals',
    vars: [
      { path: 'client.name', note: 'Client name' },
      { path: 'product.name', note: 'Product name' },
      { path: 'totals.totalTasks', note: 'Task count' },
      { path: 'totals.completedTasks', note: 'Completed count' },
      { path: 'totals.positiveTasks', note: 'Positive count' },
      { path: 'totals.negativeTasks', note: 'Negative count' },
      { path: 'totals.referTasks', note: 'Refer count' },
      { path: 'totals.fraudTasks', note: 'Fraud count' },
      { path: 'totals.photoCount', note: 'Photo count' },
      { path: 'generation.generatedAt', note: 'Generated at (use {{fmtDate …}})' },
      { path: 'generation.generatedByName', note: 'Generated by' },
    ],
  },
  {
    group: 'Loops — {{#each applicants}} … {{/each}}',
    vars: [
      { path: 'name', note: 'Applicant name' },
      { path: 'applicantType', note: 'Applicant type' },
      { path: 'mobile', note: 'Mobile' },
      { path: 'pan', note: 'PAN' },
    ],
  },
  {
    group: 'Loops — {{#each tasks}} … {{/each}}',
    vars: [
      { path: 'unitName', note: 'Verification unit' },
      { path: 'taskNumber', note: 'Task number' },
      { path: 'applicantName', note: 'Applicant' },
      { path: 'address', note: 'Address' },
      { path: 'outcome', note: 'OFFICIAL task result' },
      { path: 'nl2br narrative', note: 'Narrative (use {{nl2br narrative}})' },
      { path: '#each sections', note: 'then {{title}} + {{#each fields}}{{label}}/{{value}}' },
      { path: '#each photos', note: 'then {{url}} {{reverseGeocodedAddress}} {{photoType}}' },
    ],
  },
];

/**
 * The built-in default CASE_REPORT template (ADR-0041). Used by the renderer when no CASE_REPORT
 * layout is configured for the case's client+product, AND offered by the admin Designer as the
 * "Load default template" starter (slice 3). Self-contained HTML + inline CSS — print/Puppeteer
 * portable, no external assets. Every context value uses `{{ }}` (auto-escaped) or the
 * `nl2br`/`orDash`/`fmtDate`/`badge` helpers (which escape internally). NO `{{{ }}}` anywhere — the
 * triple-stash gate (CreateReportLayoutSchema) would reject it.
 */
export const DEFAULT_CASE_REPORT_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{{client.name}} — Verification Report — {{case.caseNumber}}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #444;
       border-bottom: 1px solid #ccc; padding-bottom: 3px; margin: 18px 0 8px; }
  .muted { color: #666; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  table.kv { width: 100%; border-collapse: collapse; }
  table.kv td { padding: 2px 8px 2px 0; vertical-align: top; }
  table.kv td.k { width: 180px; color: #666; text-transform: uppercase; font-size: 10px; letter-spacing: .03em; }
  table.grid { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.grid th, table.grid td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  table.grid th { background: #f3f3f3; font-size: 10px; text-transform: uppercase; }
  .task { margin-top: 14px; page-break-inside: avoid; }
  .task-h { font-weight: bold; font-size: 13px; }
  .badge { display: inline-block; padding: 1px 6px; border: 1px solid #999; border-radius: 3px; font-size: 10px; }
  .narrative { white-space: normal; margin: 6px 0; }
  .photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .photo { width: 180px; font-size: 10px; }
  .photo img { width: 180px; height: 135px; object-fit: cover; border: 1px solid #ccc; }
  .photo .cap { color: #444; margin-top: 2px; word-break: break-word; }
  .foot { margin-top: 24px; padding-top: 8px; border-top: 1px solid #ccc; color: #666; font-size: 10px; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>{{client.name}}</h1>
      <div class="muted">{{product.name}} — Verification Report</div>
    </div>
    <div class="muted" style="text-align:right">
      <div><strong>{{case.caseNumber}}</strong></div>
      <div>{{badge case.status}}</div>
    </div>
  </div>

  <h2>Case</h2>
  <table class="kv">
    <tr><td class="k">Customer</td><td>{{orDash case.customerName}}</td>
        <td class="k">Phone</td><td>{{orDash case.customerPhone}}</td></tr>
    <tr><td class="k">PAN</td><td>{{orDash case.panNumber}}</td>
        <td class="k">Applicant Type</td><td>{{orDash case.applicantType}}</td></tr>
    <tr><td class="k">Backend Contact</td><td>{{orDash case.backendContactNumber}}</td>
        <td class="k">Trigger</td><td>{{orDash case.trigger}}</td></tr>
    <tr><td class="k">Received</td><td>{{fmtDate case.receivedDate}}</td>
        <td class="k">Completed</td><td>{{fmtDate case.completedDate}}</td></tr>
    <tr><td class="k">Case Result</td><td>{{orDash case.verificationOutcome}}</td>
        <td class="k">TAT (days)</td><td>{{orDash case.tatDays}}</td></tr>
    {{#if case.resultRemark}}<tr><td class="k">Result Remark</td><td colspan="3">{{case.resultRemark}}</td></tr>{{/if}}
  </table>

  <h2>Applicants</h2>
  <table class="grid">
    <tr><th>Name</th><th>Type</th><th>Mobile</th><th>PAN</th></tr>
    {{#each applicants}}
    <tr><td>{{orDash name}}</td><td>{{orDash applicantType}}</td><td>{{orDash mobile}}</td><td>{{orDash pan}}</td></tr>
    {{/each}}
  </table>

  <h2>Verifications ({{totals.totalTasks}})</h2>
  {{#each tasks}}
  <div class="task">
    <div class="task-h">{{orDash unitName}} — {{orDash taskNumber}}
      {{#if outcome}}<span class="badge">{{outcome}}</span>{{/if}}</div>
    <div class="muted">{{orDash applicantName}} · {{orDash address}}</div>
    {{#if narrative}}<div class="narrative">{{nl2br narrative}}</div>{{/if}}
    {{#each sections}}
      <table class="grid">
        <tr><th colspan="2">{{title}}</th></tr>
        {{#each fields}}<tr><td>{{label}}</td><td>{{value}}</td></tr>{{/each}}
      </table>
    {{/each}}
    {{#if photos.length}}
    <div class="photos">
      {{#each photos}}
      <div class="photo">
        <img src="{{url}}" alt="{{orDash photoType}}">
        <div class="cap">
          <strong>{{orDash photoType}}</strong><br>
          {{#if reverseGeocodedAddress}}{{reverseGeocodedAddress}}<br>{{/if}}
          {{#if latitude}}GPS {{latitude}}, {{longitude}}{{#if accuracy}} (±{{accuracy}}m){{/if}}<br>{{/if}}
          {{#if captureTime}}{{fmtDate captureTime}}{{/if}}
        </div>
      </div>
      {{/each}}
    </div>
    {{/if}}
  </div>
  {{/each}}

  <div class="foot">
    Generated {{fmtDate generation.generatedAt}} by {{orDash generation.generatedByName}}.
    Tasks: {{totals.totalTasks}} total, {{totals.completedTasks}} completed
    ({{totals.positiveTasks}} positive, {{totals.negativeTasks}} negative,
    {{totals.referTasks}} refer, {{totals.fraudTasks}} fraud) · {{totals.photoCount}} photos.
  </div>
</body>
</html>`;
