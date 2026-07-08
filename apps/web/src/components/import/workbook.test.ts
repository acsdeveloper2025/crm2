import { describe, it, expect } from 'vitest';
import type { OnboardingPreviewResult, OnboardingSheetPreview } from '@crm2/sdk';
import { workbookConfirmEnabled, sheetSummary, workbookConfirmLabel } from './ImportModal.js';

const sheet = (overrides: Partial<OnboardingSheetPreview> = {}): OnboardingSheetPreview => ({
  name: 'Products',
  totalRows: 0,
  validRows: 0,
  pendingRows: 0,
  errorRows: 0,
  errors: [],
  ...overrides,
});

const preview = (sheets: OnboardingSheetPreview[]): OnboardingPreviewResult => ({ sheets });

describe('workbookConfirmEnabled', () => {
  it('false when every sheet is all-error (no valid or pending rows anywhere)', () => {
    const p = preview([
      sheet({ name: 'Products', totalRows: 2, errorRows: 2 }),
      sheet({ name: 'CPV', totalRows: 1, errorRows: 1 }),
    ]);
    expect(workbookConfirmEnabled(p)).toBe(false);
  });

  it('true when at least one sheet has a single pending row', () => {
    const p = preview([
      sheet({ name: 'Products', totalRows: 2, errorRows: 2 }),
      sheet({ name: 'CPV', totalRows: 1, pendingRows: 1 }),
    ]);
    expect(workbookConfirmEnabled(p)).toBe(true);
  });
});

describe('workbookConfirmLabel', () => {
  it('singular "row" for exactly 1 committable row', () => {
    const p = preview([sheet({ name: 'Products', totalRows: 1, validRows: 1 })]);
    expect(workbookConfirmLabel(p)).toBe('Import 1 row');
  });

  it('plural "rows" and sums valid+pending across every sheet', () => {
    const p = preview([
      sheet({ name: 'Products', totalRows: 30, validRows: 30 }),
      sheet({ name: 'CPV', totalRows: 12, pendingRows: 12 }),
    ]);
    expect(workbookConfirmLabel(p)).toBe('Import 42 rows');
  });
});

describe('sheetSummary', () => {
  it('renders the exact chip copy with a singular error', () => {
    expect(sheetSummary(sheet({ validRows: 3, pendingRows: 2, errorRows: 1 }))).toBe(
      '✓ 3 valid · ⧗ 2 pending · ✗ 1 error',
    );
  });

  it('renders the exact chip copy for an all-zero (sheet absent from the workbook) sheet', () => {
    expect(sheetSummary(sheet({ validRows: 0, pendingRows: 0, errorRows: 0 }))).toBe(
      '✓ 0 valid · ⧗ 0 pending · ✗ 0 errors',
    );
  });
});
