import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ImageRun,
  BorderStyle,
} from 'docx';
import { logger } from '@crm2/logger';
import type { CaseReportContext, CaseReportTask } from '@crm2/sdk';

/**
 * CASE_REPORT → Word (.docx) renderer (ADR-0041 S5 slice 4). Builds the document PROGRAMMATICALLY from
 * the typed `CaseReportContext` — NOT from HTML. Every text value goes through `docx`'s `TextRun`,
 * which writes a plain-text run (no markup parsing), so the plain-text FIELD_REPORT narrative + case
 * fields can NEVER become an injection sink here (output-encoding is structural, not a gate). Photos
 * are embedded via `ImageRun` from the presigned bytes; a fetch failure degrades to a caption-only
 * entry (never fails the whole report).
 */

const PHOTO_W = 220;
const PHOTO_H = 165;
const IMG_FETCH_TIMEOUT_MS = 15_000;

const dash = (v: unknown): string => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? '—' : s;
};
const fmtDate = (v: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
};

/** A 2-col key/value table row. */
function kvRow(k: string, v: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 28, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, size: 18 })] })],
      }),
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: v, size: 18 })] })] }),
    ],
  });
}

function gridTable(rows: TableRow[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
      left: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
      right: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
    },
  });
}

function headerCell(text: string): TableCell {
  return new TableCell({
    shading: { fill: 'F3F3F3' },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 16 })] })],
  });
}
function cell(text: string): TableCell {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, size: 18 })] })] });
}

/** Fetch a photo's bytes from its presigned URL (server-side). Returns null on any failure (the report
 *  degrades to a caption-only photo). The URL is server-signed by our object store — not user input. */
async function fetchImage(
  photoId: string,
  url: string,
): Promise<{ data: Buffer; type: 'jpg' | 'png' } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), IMG_FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) {
      // Log the drop so an ops person can explain a photo missing from a delivered report (Reliability).
      logger.warn('docx: photo fetch non-ok — embedding caption only', { photoId, status: res.status });
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type')?.includes('png') ? 'png' : 'jpg';
    return { data: buf, type };
  } catch (e) {
    logger.warn('docx: photo fetch failed — embedding caption only', {
      photoId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Plain-text narrative → one Paragraph per line (preserves the FIELD_REPORT line breaks). */
function narrativeParagraphs(narrative: string): Paragraph[] {
  return narrative
    .split(/\r?\n/)
    .map((line) => new Paragraph({ children: [new TextRun({ text: line, size: 18 })] }));
}

async function taskBlock(task: CaseReportTask): Promise<(Paragraph | Table)[]> {
  const out: (Paragraph | Table)[] = [];
  const heading = `${dash(task.unitName)} — ${dash(task.taskNumber)}${task.outcome ? ` [${task.outcome}]` : ''}`;
  out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: heading })] }));
  out.push(
    new Paragraph({
      children: [
        new TextRun({ text: `${dash(task.applicantName)} · ${dash(task.address)}`, italics: true, size: 18 }),
      ],
    }),
  );
  if (task.narrative) out.push(...narrativeParagraphs(task.narrative));
  for (const sec of task.sections) {
    out.push(
      gridTable([
        new TableRow({ children: [headerCell(sec.title), headerCell('')] }),
        ...sec.fields.map((f) => new TableRow({ children: [cell(f.label), cell(f.value)] })),
      ]),
    );
  }
  for (const photo of task.photos) {
    const img = await fetchImage(photo.id, photo.url);
    if (img) {
      out.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: img.data,
              type: img.type,
              transformation: { width: PHOTO_W, height: PHOTO_H },
            }),
          ],
        }),
      );
    }
    const caption = [
      dash(photo.photoType),
      photo.reverseGeocodedAddress ?? '',
      typeof photo.latitude === 'number' ? `GPS ${photo.latitude}, ${photo.longitude}` : '',
      fmtDate(photo.captureTime),
    ]
      .filter((s) => s && s !== '—')
      .join(' · ');
    out.push(new Paragraph({ children: [new TextRun({ text: caption, size: 14, color: '444444' })] }));
  }
  return out;
}

/** Render the CASE_REPORT context to a .docx buffer. */
export async function renderCaseReportDocx(ctx: CaseReportContext): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  // Header
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: ctx.client.name })] }),
  );
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: `${ctx.product.name} — Verification Report`, color: '666666', size: 20 }),
      ],
    }),
  );
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `${ctx.case.caseNumber} · ${ctx.case.status}`, bold: true })],
    }),
  );

  // Case
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Case' })] }),
  );
  children.push(
    gridTable([
      kvRow('Customer', dash(ctx.case.customerName)),
      kvRow('Phone', dash(ctx.case.customerPhone)),
      kvRow('PAN', dash(ctx.case.panNumber)),
      kvRow('Applicant Type', dash(ctx.case.applicantType)),
      kvRow('Backend Contact', dash(ctx.case.backendContactNumber)),
      kvRow('Trigger', dash(ctx.case.trigger)),
      kvRow('Received', fmtDate(ctx.case.receivedDate)),
      kvRow('Completed', fmtDate(ctx.case.completedDate)),
      kvRow('Case Result', dash(ctx.case.verificationOutcome)),
      kvRow('TAT (days)', dash(ctx.case.tatDays)),
      ...(ctx.case.resultRemark ? [kvRow('Result Remark', ctx.case.resultRemark)] : []),
    ]),
  );

  // Applicants
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Applicants' })] }),
  );
  children.push(
    gridTable([
      new TableRow({
        children: [headerCell('Name'), headerCell('Type'), headerCell('Mobile'), headerCell('PAN')],
      }),
      ...ctx.applicants.map(
        (a) =>
          new TableRow({
            children: [
              cell(dash(a.name)),
              cell(dash(a.applicantType)),
              cell(dash(a.mobile)),
              cell(dash(a.pan)),
            ],
          }),
      ),
    ]),
  );

  // Verifications
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: `Verifications (${ctx.totals.totalTasks})` })],
    }),
  );
  for (const task of ctx.tasks) children.push(...(await taskBlock(task)));

  // Footer
  const t = ctx.totals;
  children.push(
    new Paragraph({
      spacing: { before: 300 },
      children: [
        new TextRun({
          text:
            `Generated ${fmtDate(ctx.generation.generatedAt)} by ${dash(ctx.generation.generatedByName)}. ` +
            `Tasks: ${t.totalTasks} total, ${t.completedTasks} completed ` +
            `(${t.positiveTasks} positive, ${t.negativeTasks} negative, ${t.referTasks} refer, ${t.fraudTasks} fraud) · ` +
            `${t.photoCount} photos.`,
          color: '666666',
          size: 14,
        }),
      ],
    }),
  );

  const doc = new Document({
    creator: 'CRM2',
    title: `${ctx.client.name} — Verification Report — ${ctx.case.caseNumber}`,
    sections: [{ children }],
  });
  const buf = await Packer.toBuffer(doc);
  logger.info('docx: rendered case report', { caseId: ctx.case.id, bytes: buf.length });
  return Buffer.from(buf);
}
