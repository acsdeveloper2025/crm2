import { describe, it, expect } from 'vitest';
import { FIELD_REPORT_DEFAULTS, type ReportLayoutColumn } from '@crm2/sdk';
import { renderNarrative } from '../render.js';
import type { TaskRenderContext } from '../repository.js';

/** Fill the read-model-only fields the renderer ignores (default columns are ReportLayoutColumnInput[]). */
const colsFor = (type: string): ReportLayoutColumn[] =>
  FIELD_REPORT_DEFAULTS[type]!.columns.map(
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

const ctx = (
  slug: string,
  type: string,
  formData: Record<string, unknown>,
  outcome: string,
): TaskRenderContext => ({
  taskId: 't1',
  clientId: 1,
  productId: 2,
  verificationType: type,
  formData: { [slug]: { formData, verificationOutcome: outcome } },
  task: { address: '12 MG ROAD' },
  case: {},
  applicant: { name: 'RAJESH KUMAR', applicant_type: 'Applicant' },
});

describe('OFFICE default template renders v1-faithful narratives', () => {
  const body = FIELD_REPORT_DEFAULTS['OFFICE']!.templateBody;
  const cols = colsFor('OFFICE');

  it('Positive & Door Open — employment + office detail grammar', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        'office',
        'OFFICE',
        {
          addressRating: 'Good',
          officeStatus: 'Open',
          metPersonName: 'SUNIL',
          metPersonDesignation: 'HR Manager',
          workingPeriod: '2 Year',
          applicantDesignation: 'Manager',
          applicantWorkingPremises: 'Same Location',
          officeType: 'Private Limited',
          companyNatureOfBusiness: 'IT Services',
          establishmentPeriod: '5 Year',
          staffStrength: '50',
          staffSeen: '20',
          officeApproxArea: 800,
          companyNamePlateStatus: 'Sighted',
          nameOnBoard: 'ACS',
          documentShown: 'Showed',
          locality: 'Commercial',
          addressStructure: '4',
          addressStructureColor: 'Grey',
          doorColor: 'Brown',
          addressFloor: '2',
          tpcName1: 'AMIT',
          tpcMetPerson1: 'Colleague',
          tpcConfirmation1: 'Confirmed',
          tpcName2: 'RITA',
          tpcMetPerson2: 'Security',
          tpcConfirmation2: 'Confirmed',
          landmark1: 'NEPTUNE',
          landmark2: 'CROMA',
          dominatedArea: 'Not Dominated',
          feedbackFromNeighbour: 'No Adverse',
          politicalConnection: 'Not Having',
          otherObservation: 'All ok',
          finalStatus: 'Positive',
        },
        'Positive & Door Open',
      ),
    );
    expect(out).toContain('Office Remark: POSITIVE & DOOR OPEN.');
    expect(out).toContain('Visited at the given address (12 MG ROAD) for RAJESH KUMAR (Applicant).');
    expect(out).toContain('the office was open.'); // lc officeStatus
    expect(out).toContain('Met with SUNIL (HR Manager)');
    expect(out).toContain('for the last 2 Years as Manager.'); // pluralize working_period
    expect(out).toContain('sits at the same location as the office'); // sittingLocation
    expect(out).toContain('established at the given address for the last 5 Years'); // pluralize
    expect(out).toContain('office area is approximately 800 sq. feet'); // area
    expect(out).toContain('Company nameplate displays "ACS".'); // nameplate displays + literal quotes
    expect(out).toContain('During the visit, the met person showed an identity proof.'); // documentShown
    expect(out).toContain('TPC was conducted with AMIT (Colleague), who confirmed'); // tpcLabel + lc
    expect(out).toContain('No adverse feedback was received regarding RAJESH KUMAR and the firm.'); // capFirst
    expect(out).toContain('Hence the profile is marked as Positive.');
    expect(out).not.toMatch(/&quot;|&amp;|&lt;/);
  });

  it('Untraceable — branch isolation + call grammar', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        'office',
        'OFFICE',
        {
          callRemark: 'Did Not Pick',
          contactPerson: 'A SHOPKEEPER',
          locality: 'Commercial',
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
    expect(out).toContain('Office Remark: UNTRACEABLE.');
    expect(out).toContain('We called RAJESH KUMAR, but the call was not picked up.'); // callRemark
    expect(out).not.toContain('POSITIVE & DOOR OPEN');
    expect(out).toContain('Hence the profile is marked as Untraceable.');
  });
});

describe('BUSINESS default template renders v1-faithful narratives', () => {
  const body = FIELD_REPORT_DEFAULTS['BUSINESS']!.templateBody;
  const cols = colsFor('BUSINESS');

  it('Positive & Door Open — business detail grammar (ownershipType, area)', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        'business',
        'BUSINESS',
        {
          addressRating: 'Good',
          businessStatus: 'Open',
          metPersonName: 'SUNIL',
          metPersonDesignation: 'Owner',
          businessPeriod: '3 Year',
          businessType: 'Retail',
          ownershipType: 'Is Owned',
          companyNatureOfBusiness: 'Garments',
          officeApproxArea: 600, // real device key (mobile buildLegacyBusinessTemplate) — audit A2026-0623-03
          nameOfCompanyOwners: 'RAJESH KUMAR',
          companyNamePlateStatus: 'Sighted',
          nameOnBoard: 'ACS TRADERS',
          staffStrength: '10',
          staffSeen: '5',
          documentShown: 'Showed',
          locality: 'Market',
          addressStructure: '2',
          addressStructureColor: 'White',
          doorColor: 'Blue',
          addressFloor: '0',
          tpcName1: 'AMIT',
          tpcMetPerson1: 'Neighbour Shop',
          tpcConfirmation1: 'Confirmed',
          tpcName2: 'RITA',
          tpcMetPerson2: 'Neighbour Shop',
          tpcConfirmation2: 'Confirmed',
          landmark1: 'NEPTUNE',
          landmark2: 'CROMA',
          dominatedArea: 'Not Dominated',
          feedbackFromNeighbour: 'No Adverse',
          politicalConnection: 'Not Having',
          otherObservation: 'All ok',
          finalStatus: 'Positive',
        },
        'Positive & Door Open',
      ),
    );
    expect(out).toContain('Business Remark: POSITIVE & DOOR OPEN.');
    expect(out).toContain('the business was open.'); // lc business_status
    expect(out).toContain('running the business at the given address for the last 3 Years.'); // pluralize
    expect(out).toContain('Business type is Retail (Owned)'); // ownershipType strips "Is "
    expect(out).toContain('business area is approximately 600 sq. feet'); // area
    expect(out).toContain('located on the ground floor'); // addressFloor '0' → ground (not "0th floor")
    expect(out).toContain('Business owner: RAJESH KUMAR.');
    expect(out).toContain('Company nameplate displays "ACS TRADERS".');
    expect(out).toContain('Hence the profile is marked as Positive.');
    expect(out).not.toMatch(/&quot;|&amp;|&lt;/);
  });
});

describe('RESIDENCE_CUM_OFFICE default template renders v1-faithful narratives', () => {
  const body = FIELD_REPORT_DEFAULTS['RESIDENCE_CUM_OFFICE']!.templateBody;
  const cols = colsFor('RESIDENCE_CUM_OFFICE');

  it('Positive & Door Open — residence + business clauses (setup, businessLocation, ordinal)', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        'residence-cum-office',
        'RESIDENCE_CUM_OFFICE',
        {
          addressRating: 'Good',
          resiCumOfficeStatus: 'Open',
          metPersonName: 'SUNIL',
          relation: 'Self',
          stayingPeriod: '5 Year',
          stayingStatus: 'On Rent',
          addressFloor: '2', // real device key (mobile builders emit addressFloor) — audit A2026-0623-08
          residenceSetup: 'Sighted',
          businessPeriod: '3 Year',
          companyNatureOfBusiness: 'Retail',
          businessStatus: 'Proprietorship',
          businessLocation: 'At Same Address',
          businessSetup: 'Sighted',
          officeApproxArea: 700, // real RCO device key (mobile buildLegacyResidenceCumOfficeTemplate:2570) — audit A2026-0623-03 sibling
          doorNamePlateStatus: 'Sighted',
          nameOnDoorPlate: 'RAJESH',
          societyNamePlateStatus: 'Sighted',
          nameOnSocietyBoard: 'GREEN APT',
          companyNamePlateStatus: 'Sighted',
          nameOnBoard: 'ACS',
          documentShown: 'Showed',
          locality: 'Mixed',
          addressStructure: '3',
          addressStructureColor: 'Cream',
          doorColor: 'Brown',
          tpcName1: 'AMIT',
          tpcMetPerson1: 'Neighbour',
          tpcConfirmation1: 'Confirmed',
          tpcName2: 'RITA',
          tpcMetPerson2: 'Security',
          tpcConfirmation2: 'Confirmed',
          landmark1: 'NEPTUNE',
          landmark2: 'CROMA',
          dominatedArea: 'Not Dominated',
          feedbackFromNeighbour: 'No Adverse',
          politicalConnection: 'Not Having',
          otherObservation: 'All ok',
          finalStatus: 'Positive',
        },
        'Positive & Door Open',
      ),
    );
    expect(out).toContain('Residence-cum-Office Remark: POSITIVE & DOOR OPEN.');
    expect(out).toContain('the residence-cum-office was open.'); // lc house_status
    expect(out).toContain('Met with SUNIL (Self)');
    expect(out).toContain('for the last 5 Years on rent, on the 2nd floor.'); // pluralize + lc + ordinal
    expect(out).toContain('Residence setup was sighted.'); // setup
    expect(out).toContain('operating the business at the given address for the last 3 Years.'); // pluralize
    expect(out).toContain('operated as Proprietorship at the same address.'); // businessLocation
    expect(out).toContain('Business setup was sighted.'); // setup
    expect(out).toContain('approximate area of the premises is 700 sq. feet.');
    expect(out).toContain('Door nameplate shows the name "RAJESH".'); // nameplate
    expect(out).toContain('Society board displays "GREEN APT".');
    expect(out).toContain('Hence the profile is marked as Positive.');
    expect(out).not.toMatch(/&quot;|&amp;|&lt;/);
  });
});
