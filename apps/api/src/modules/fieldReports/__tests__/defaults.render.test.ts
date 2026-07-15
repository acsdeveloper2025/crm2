import { describe, it, expect } from 'vitest';
import { FIELD_REPORT_DEFAULTS, type ReportLayoutColumn } from '@crm2/sdk';
import { renderNarrative } from '../render.js';
import type { TaskRenderContext } from '../repository.js';

/** Build a render context for a residence submission with the given form fields + outcome. */
const ctx = (formData: Record<string, unknown>, outcome: string): TaskRenderContext => ({
  taskId: 't1',
  clientId: 1,
  productId: 2,
  verificationType: 'RESIDENCE',
  formData: { residence: { formData, verificationOutcome: outcome } },
  task: { address: '12 MG ROAD' },
  case: {},
  applicant: { name: 'RAJESH KUMAR', applicant_type: 'Applicant' },
});

// the default columns are ReportLayoutColumnInput[]; the render typing wants ReportLayoutColumn[] —
// fill the read-model-only fields (id/displayOrder/options/validation) the renderer ignores.
const cols = FIELD_REPORT_DEFAULTS['RESIDENCE']!.columns.map(
  (c, i): ReportLayoutColumn => ({
    id: i + 1,
    columnKey: c.columnKey,
    headerLabel: c.headerLabel,
    sourceType: c.sourceType,
    sourceRef: c.sourceRef ?? null,
    dataType: c.dataType,
    displayOrder: i,
    section: c.section ?? null,
    isRequired: c.isRequired ?? false,
    options: [],
    validation: {},
  }),
);
const body = FIELD_REPORT_DEFAULTS['RESIDENCE']!.templateBody;

describe('RESIDENCE default template renders v1-faithful narratives', () => {
  it('Positive & Door Open — full positive narrative with grammar helpers', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        {
          addressRating: 'Poor',
          metPersonName: 'MAYUR',
          metPersonRelation: 'Son',
          stayingPeriod: '6 Year',
          stayingStatus: 'On a Self Owned Basis',
          approxArea: 500,
          totalFamilyMembers: 6,
          totalEarningMember: 5,
          workingStatus: 'Salaried',
          companyName: 'ACS',
          doorNamePlateStatus: 'Sighted',
          nameOnDoorPlate: 'MAYUR',
          societyNamePlateStatus: 'Sighted',
          nameOnSocietyBoard: 'MAYUR',
          locality: 'Commercial Tower',
          addressStructure: '4',
          addressFloor: '3', // real device key (mobile builders emit addressFloor) — audit A2026-0623-08
          addressStructureColor: 'Light Grey',
          doorColor: 'Light Grey',
          tpcName1: 'MAYUR',
          tpcMetPerson1: 'Neighbour',
          tpcConfirmation1: 'Confirmed',
          tpcName2: 'SUNIL',
          tpcMetPerson2: 'Security',
          tpcConfirmation2: 'Confirmed',
          landmark1: 'NEPTUNE',
          landmark2: 'CROMA',
          dominatedArea: 'Not Dominated',
          feedbackFromNeighbour: 'No Adverse',
          politicalConnection: 'Not Having',
          documentShown: 'Did Not Showed Any Document',
          otherObservation: 'All ok',
          finalStatus: 'Positive',
        },
        'Positive & Door Open',
      ),
    );
    expect(out).toContain('Residence Remark: POSITIVE & DOOR OPEN.');
    expect(out).toContain('Visited at the given address (12 MG ROAD) for RAJESH KUMAR (Applicant).');
    expect(out).toContain('rated as Poor');
    expect(out).toContain('met with MAYUR (Son), who confirmed');
    expect(out).toContain('for the last 6 Years on a self owned basis.'); // pluralize + lc
    expect(out).toContain('approximate area of the premises is 500 sq. feet'); // area helper
    expect(out).toContain('RAJESH KUMAR is salaried at ACS.'); // workingProfile composite
    expect(out).toContain('The door nameplate shows the name "MAYUR".'); // nameplate, literal quotes
    expect(out).toContain('Society board displays "MAYUR".');
    expect(out).toContain('staying on the 3rd floor'); // ordinal
    expect(out).toContain('During the visit, the met person did not show any document.'); // documentShown
    expect(out).toContain('TPC was conducted with MAYUR (Neighbour), who confirmed'); // tpcLabel + lc
    expect(out).toContain('The area is not dominated by any particular community'); // dominatedArea
    expect(out).toContain('No adverse feedback was received from neighbours.'); // capFirst
    expect(out).toContain('does not have any political connections'); // politicalConnection
    expect(out).toContain('Hence the profile is marked as Positive.');
    // plain text — literal quotes, no HTML entities
    expect(out).not.toMatch(/&quot;|&amp;|&lt;/);
  });

  it('Untraceable — branch selection + call/landmark prose', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        {
          callRemark: 'Number is Switch Off',
          contactPerson: 'A SHOPKEEPER',
          locality: 'Residential',
          landmark1: 'L1',
          landmark2: 'L2',
          landmark3: 'L3',
          landmark4: 'L4',
          dominatedArea: 'Not Dominated',
          otherObservation: 'Not found',
          finalStatus: 'Untraceable',
        },
        'Untraceable',
      ),
    );
    expect(out).toContain('Residence Remark: UNTRACEABLE.');
    expect(out).toContain('The given address is incorrect and untraceable.');
    expect(out).toContain('We called RAJESH KUMAR, but the number was switched off.'); // callRemark
    expect(out).toContain('inquired with A SHOPKEEPER');
    expect(out).toContain('NEPTUNE'.replace('NEPTUNE', 'L1')); // landmarks listed
    expect(out).toContain('Hence the profile is marked as Untraceable.');
    // only the untraceable branch rendered (no positive header)
    expect(out).not.toContain('POSITIVE & DOOR OPEN');
  });

  it('final_status falls back to outcome when finalStatus is blank (default helper)', () => {
    const out = renderNarrative(body, cols, ctx({ callRemark: 'x' }, 'Untraceable'));
    expect(out).toContain('Hence the profile is marked as Untraceable.');
  });
});

/*
 * ERT (Entry Restricted) — LIVE BUG 2026-07-15, CASE-000002-1 (TAFSEER AHMED …, agent jayant.panchal).
 * The agent recorded `Applicant Staying Status = "Applicant is Shifted From"`, and the report printed
 * "SECURITY confirmed <name>'s stay at the given address" — the OPPOSITE of the field truth, on a
 * client-facing document.
 *
 * Cause: the template welded `metPersonConfirmation`'s VERB to a hard-coded person-fact OBJECT
 * ("{{customer_name}}'s stay at the given address") and never rendered `applicant_staying_status`.
 * The guard's legitimate "Confirmed" (confirming the applicant had SHIFTED) got attached to the stay.
 * Residence was the only ERT template whose object was a person-fact — the other 8 confirm an
 * *existence* fact, which a staying status cannot contradict. Fix mirrors the shipped
 * Residence-cum-Office ERT clause. Owner decision 2026-07-15: drop the weld.
 */
describe('RESIDENCE ERT — the narrative must say what the met person actually confirmed', () => {
  // Device form (crm-mobile-native LegacyFormTemplateBuilders.ts) is the SOURCE OF TRUTH:
  //   metPersonConfirmation: ['Confirmed', 'Not Confirmed']
  //   applicantStayingStatus: ['Applicant is Staying At','Applicant is Shifted From','No Such Person Staying At']
  //   applicantStayingStatus is conditional on metPersonConfirmation notEquals 'Not Confirmed'
  // => the staying status IS the object of the confirmation. It is only collected when they confirmed.
  const ertForm = (extra: Record<string, unknown>) => ({
    addressRating: 'Average',
    metPersonName: 'SECURITY',
    metPersonType: 'Security',
    societyNamePlateStatus: 'Sighted',
    nameOnSocietyBoard: 'TAFSEER',
    locality: 'Residential Society',
    addressStructure: '7',
    addressStructureColor: 'Cream',
    landmark1: 'D-MART',
    landmark2: 'PETROL PUMP',
    dominatedArea: 'Not Dominated',
    feedbackFromNeighbour: 'No Adverse',
    callRemark: 'Call Received',
    callConfirmation: 'Confirmed',
    otherObservation: 'Entry not allowed by security',
    ...extra,
  });

  it('CASE-000002-1: shifted — never claims a confirmed stay', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        ertForm({ metPersonConfirmation: 'Confirmed', applicantStayingStatus: 'Applicant is Shifted From' }),
        'ERT',
      ),
    );
    expect(out).not.toMatch(/confirmed RAJESH KUMAR's stay/i);
    expect(out).not.toContain("RAJESH KUMAR's stay at the given address");
    expect(out).toContain('SECURITY confirmed that the applicant has shifted from the given address.');
  });

  it('staying — the confirmation attaches to the staying status', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        ertForm({ metPersonConfirmation: 'Confirmed', applicantStayingStatus: 'Applicant is Staying At' }),
        'ERT',
      ),
    );
    expect(out).toContain('SECURITY confirmed that the applicant is staying at the given address.');
  });

  it('no such person — the third device option renders truthfully', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        ertForm({ metPersonConfirmation: 'Confirmed', applicantStayingStatus: 'No Such Person Staying At' }),
        'ERT',
      ),
    );
    expect(out).toContain('SECURITY confirmed that no such person is staying at the given address.');
  });

  it('Not Confirmed — no staying status is collected, so none is invented', () => {
    // The device hides applicantStayingStatus entirely in this branch.
    const out = renderNarrative(body, cols, ctx(ertForm({ metPersonConfirmation: 'Not Confirmed' }), 'ERT'));
    expect(out).toContain("SECURITY did not confirm RAJESH KUMAR's residency at the given address.");
    expect(out).not.toContain('staying status is not specified');
    expect(out).not.toMatch(/confirmed that the applicant/i);
  });
});
