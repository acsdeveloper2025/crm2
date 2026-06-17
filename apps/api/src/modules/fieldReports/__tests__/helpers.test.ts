import { describe, it, expect } from 'vitest';
import { FIELD_REPORT_HELPERS } from '@crm2/sdk';
import { hb } from '../helpers.js';

// Handlebars' own built-ins on a fresh instance — excluded when comparing the custom helper set.
const BUILTINS = new Set([
  'helperMissing',
  'blockHelperMissing',
  'each',
  'if',
  'unless',
  'with',
  'log',
  'lookup',
]);

/** Render a one-helper template against a context (mirrors the engine: plain-text noEscape). */
const r = (tpl: string, ctx: Record<string, unknown> = {}): string =>
  hb.compile(tpl, { noEscape: true })(ctx);

describe('field-report grammar helpers (v1 parity)', () => {
  it('ordinal', () => {
    expect(r('{{ordinal n}}', { n: 1 })).toBe('1st');
    expect(r('{{ordinal n}}', { n: 2 })).toBe('2nd');
    expect(r('{{ordinal n}}', { n: 3 })).toBe('3rd');
    expect(r('{{ordinal n}}', { n: 11 })).toBe('11th');
    expect(r('{{ordinal n}}', { n: 'Ground' })).toBe('Ground');
  });

  it('pluralize period', () => {
    expect(r('{{pluralize p}}', { p: '5 Year' })).toBe('5 Years');
    expect(r('{{pluralize p}}', { p: '1 Year' })).toBe('1 Year');
    expect(r('{{pluralize p}}', { p: '10 month' })).toBe('10 Months');
    expect(r('{{pluralize p}}', { p: 'Ground' })).toBe('Ground');
  });

  it('lc / capFirst', () => {
    expect(r('{{lc s}}', { s: 'Salaried' })).toBe('salaried');
    expect(r('{{capFirst s}}', { s: 'No Adverse' })).toBe('No adverse');
  });

  it('date (local, never UTC)', () => {
    expect(r('{{date d}}', { d: '2023-01-15' })).toBe('2023-01-15');
    expect(r('{{date d}}', { d: '2023-01-15T18:30:00.000Z' })).toMatch(/^2023-01-1[56]$/);
    expect(r('{{date d}}', { d: '' })).toBe('');
  });

  it('area', () => {
    expect(r('{{area a}}', { a: 500 })).toBe('500 sq. feet');
    expect(r('{{area a}}', { a: 0 })).toBe('Not provided');
    expect(r('{{area a}}', {})).toBe('Not provided');
  });

  it('nameplate (door shows the name / society displays / not sighted)', () => {
    expect(r('{{nameplate s n}}', { s: 'Sighted', n: 'MAYUR' })).toBe('shows the name "MAYUR"');
    expect(r('{{nameplate s n "displays"}}', { s: 'Sighted', n: 'ACS' })).toBe('displays "ACS"');
    expect(r('{{nameplate s n}}', { s: 'Not Sighted', n: 'X' })).toBe('is not sighted');
  });

  it('dominatedArea / politicalConnection', () => {
    expect(r('{{dominatedArea v}}', { v: 'Not Dominated' })).toMatch(/not dominated/);
    expect(r('{{dominatedArea v}}', {})).toMatch(/not specified/);
    expect(r('{{politicalConnection v}}', { v: 'Not Having' })).toMatch(/does not have any political/);
    expect(r('{{politicalConnection v}}', { v: 'Having' })).toMatch(/has political connections/);
  });

  it('tpcLabel / tpcPair (graceful, no dangling)', () => {
    expect(r('{{tpcLabel n rel}}', { n: 'MAYUR', rel: 'Neighbour' })).toBe('MAYUR (Neighbour)');
    expect(r('{{tpcLabel n rel}}', { n: 'MAYUR', rel: 'Not provided' })).toBe('MAYUR');
    expect(r('{{tpcLabel n rel}}', {})).toBe('');
    expect(r('{{tpcPair p1 n1 p2 n2}}', { p1: 'Neighbour', n1: 'A', p2: 'Security', n2: 'B' })).toBe(
      'Neighbour A and Security B',
    );
    expect(r('{{tpcPair p1 n1 p2 n2}}', { p1: 'Neighbour', n1: 'A' })).toBe('Neighbour A');
  });

  it('workingProfile via lc + composed (all-or-nothing pattern using documentShown/sentenceClause)', () => {
    // documentShown — both free-text and select values
    expect(r('{{documentShown s d}}', { s: 'No' })).toMatch(/did not show any document/);
    expect(r('{{documentShown s d}}', { s: 'Showed', d: 'Aadhaar' })).toBe(
      'the met person showed Aadhaar as identity proof',
    );
    expect(r('{{documentShownSentence s d}}', { s: '' })).toBe(''); // silent when nothing captured
    expect(r('{{documentShownSentence s d}}', { s: 'Showed', d: 'PAN' })).toBe(
      'During the visit, the met person showed PAN as identity proof.',
    );
  });

  it('callRemark (incl. pickup → callConfirmation delegation; options-arg safe)', () => {
    expect(r('{{callRemark v}}', { v: 'Did Not Pick Up Call' })).toBe('the call was not picked up');
    expect(r('{{callRemark v}}', { v: 'Number is Switch Off' })).toBe('the number was switched off');
    // one-arg call: the trailing Handlebars options object must NOT be stringified
    expect(r('{{callRemark v}}', { v: 'Pickup call & confirm' })).toBe(
      'the applicant confirmed the details over the call',
    );
    expect(r('{{callRemark v c}}', { v: 'Pickup call & confirm', c: 'Address is shifted' })).toBe(
      'the applicant informed that the address has been shifted',
    );
  });

  it('sentenceClause / existsClause / currentCompanyOperating drop cleanly when empty', () => {
    expect(r('{{sentenceClause v "for the last " "."}}', { v: '5 Years' })).toBe('for the last 5 Years.');
    expect(r('{{sentenceClause v "for the last " "."}}', {})).toBe('');
    expect(r('{{existsClause v}}', { v: 'Operational' })).toBe(' — Operational');
    expect(r('{{existsClause v}}', {})).toBe('');
    expect(r('{{currentCompanyOperating n p}}', { n: 'ACS', p: '3 Years' })).toBe(
      'ACS is currently operating at the given address for the last 3 Years. ',
    );
    expect(r('{{currentCompanyOperating n p}}', {})).toBe('');
  });

  it('APF activityVerdict / verdictOverride coherence', () => {
    expect(r('{{activityVerdict a s n d o}}', { a: 'SEEN', s: 'positive', n: 'RAJ', d: 'Engineer' })).toBe(
      'Met with RAJ (Engineer), who confirmed the project at the given address.',
    );
    expect(r('{{verdictOverride a s o}}', { a: 'VACANT', s: 'negative' })).toBe('');
    expect(r('{{verdictOverride a s o}}', { a: 'VACANT', s: 'positive', o: 'site cleared' })).toMatch(
      /despite the plot being vacant, the verification was completed as Positive — site cleared/,
    );
  });

  it('default helper', () => {
    expect(r('{{default v "Not provided"}}', { v: '' })).toBe('Not provided');
    expect(r('{{default v "Not provided"}}', { v: 'X' })).toBe('X');
  });

  it('eq block works (engine invariant)', () => {
    expect(r('{{#eq o "POS"}}yes{{else}}no{{/eq}}', { o: 'POS' })).toBe('yes');
    expect(r('{{#eq o "POS"}}yes{{else}}no{{/eq}}', { o: 'NEG' })).toBe('no');
  });

  it('registered helpers match the SDK FIELD_REPORT_HELPERS list (drift guard for the collision check)', () => {
    const registered = Object.keys(hb.helpers)
      .filter((n) => !BUILTINS.has(n))
      .sort();
    expect(registered).toEqual([...FIELD_REPORT_HELPERS].sort());
  });
});
