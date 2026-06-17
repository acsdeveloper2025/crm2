import { describe, it, expect } from 'vitest';
import { FIELD_REPORT_DEFAULTS, type ReportLayoutColumn } from '@crm2/sdk';
import { renderNarrative } from '../render.js';
import type { TaskRenderContext } from '../repository.js';

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

describe('BUILDER default template renders v1-faithful narratives', () => {
  const body = FIELD_REPORT_DEFAULTS['BUILDER']!.templateBody;
  const cols = colsFor('BUILDER');

  it('Positive & Door Open — builder detail grammar', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        'builder',
        'BUILDER',
        {
          addressRating: 'Good',
          officeStatus: 'Open',
          metPersonName: 'SUNIL',
          metPersonDesignation: 'Manager',
          businessPeriod: '4 Year',
          businessType: 'Construction',
          ownershipType: 'Is Owned',
          companyNatureOfBusiness: 'Real Estate',
          officeApproxArea: 800,
          addressStatus: 'Owned',
          nameOfCompanyOwners: 'RAJESH KUMAR',
          staffStrength: '25',
          staffSeen: '10',
          companyNamePlateStatus: 'Sighted',
          nameOnBoard: 'ACS BUILDERS',
          documentShown: 'Showed',
          locality: 'Commercial',
          addressStructure: '5',
          addressStructureColor: 'Grey',
          doorColor: 'Brown',
          addressFloor: '1',
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
    expect(out).toContain('Builder Remark: POSITIVE & DOOR OPEN.');
    expect(out).toContain('the builder office was open.'); // lc office_status
    expect(out).toContain('running the builder firm at the given address for the last 4 Years.'); // pluralize
    expect(out).toContain('Builder type is Construction (Owned)'); // ownershipType strips "Is "
    expect(out).toContain('Office area is approximately 800 sq. feet.'); // area
    expect(out).toContain('The office premises are held owned.'); // lc address_status
    expect(out).toContain('Builder name: RAJESH KUMAR.');
    expect(out).toContain('Company nameplate displays "ACS BUILDERS".');
    expect(out).toContain('Hence the profile is marked as Positive.');
    expect(out).not.toMatch(/&quot;|&amp;|&lt;/);
  });

  it('Positive & Door Locked — callRemark uses the pickup-call confirmation (2-arg)', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        'builder',
        'BUILDER',
        {
          addressRating: 'Good',
          officeStatus: 'Closed',
          callRemark: 'Pickup Call',
          callConfirmation: 'Address Is Shifted',
          companyNatureOfBusiness: 'Real Estate',
          companyNamePlateStatus: 'Sighted',
          nameOnBoard: 'ACS',
          tpcName1: 'AMIT',
          tpcMetPerson1: 'Neighbour',
          tpcConfirmation1: 'Confirmed',
          tpcName2: 'RITA',
          tpcMetPerson2: 'Security',
          tpcConfirmation2: 'Confirmed',
          businessPeriod: '2 Year',
          locality: 'Commercial',
          addressStructure: '5',
          addressStructureColor: 'Grey',
          doorColor: 'Brown',
          landmark1: 'L1',
          landmark2: 'L2',
          dominatedArea: 'Not Dominated',
          feedbackFromNeighbour: 'No Adverse',
          politicalConnection: 'Not Having',
          otherObservation: 'ok',
          finalStatus: 'Positive',
        },
        'Positive & Door Locked',
      ),
    );
    expect(out).toContain('Builder Remark: POSITIVE & DOOR LOCKED.');
    // callRemark 'Pickup Call' delegates to callConfirmation('Address Is Shifted')
    expect(out).toContain('the applicant informed that the address has been shifted.');
    expect(out).not.toContain('POSITIVE & DOOR OPEN');
  });
});

describe('DSA_CONNECTOR default template renders v1-faithful narratives', () => {
  const body = FIELD_REPORT_DEFAULTS['DSA_CONNECTOR']!.templateBody;
  const cols = colsFor('DSA_CONNECTOR');

  it('Positive & Door Open — active clients + business grammar', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        'dsa-connector',
        'DSA_CONNECTOR',
        {
          addressRating: 'Good',
          officeStatus: 'Open',
          metPersonName: 'SUNIL',
          metPersonDesignation: 'Owner',
          businessPeriod: '3 Year',
          businessType: 'DSA',
          ownershipType: 'Is Owned',
          companyNatureOfBusiness: 'Loan Sourcing',
          nameOfCompanyOwners: 'RAJESH KUMAR',
          addressStatus: 'Rented',
          officeApproxArea: 400,
          staffStrength: '8',
          staffSeen: '4',
          activeClient: 'HDFC, ICICI',
          companyNamePlateStatus: 'Sighted',
          nameOnBoard: 'ACS DSA',
          locality: 'Commercial',
          addressStructure: '3',
          addressStructureColor: 'White',
          doorColor: 'Blue',
          addressFloor: '2',
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
    expect(out).toContain('DSA/Connector Remark: POSITIVE & DOOR OPEN.');
    expect(out).toContain('the office was open.'); // lc office_status
    expect(out).toContain('Business type is DSA (Owned)'); // ownershipType
    expect(out).toContain('Company owners: RAJESH KUMAR.');
    expect(out).toContain('The premises are held rented.'); // lc address_status
    expect(out).toContain('Office area is approximately 400 sq. feet.'); // area
    expect(out).toContain('Active clients: HDFC, ICICI.');
    expect(out).toContain('Hence the profile is marked as Positive.');
  });
});

describe('NOC default template renders v1-faithful narratives', () => {
  const body = FIELD_REPORT_DEFAULTS['NOC']!.templateBody;
  const cols = colsFor('NOC');

  it('Positive & Door Open — NOC issuance grammar', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        'noc',
        'NOC',
        {
          addressRating: 'Good',
          officeStatus: 'Open',
          metPersonName: 'SUNIL',
          metPersonDesignation: 'Secretary',
          nameOnNoc: 'RAJESH KUMAR',
          flatNo: 'B-204',
          authorisedSignature: 'SOCIETY SECRETARY',
          locality: 'Residential',
          addressStructure: '8',
          addressStructureColor: 'Cream',
          addressFloor: '0',
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
    expect(out).toContain('NOC Remark: POSITIVE & DOOR OPEN.');
    expect(out).toContain('the NOC office was open.'); // lc office_status
    expect(out).toContain('NOC has been issued in the name of RAJESH KUMAR for flat/shop/office no. B-204.');
    expect(out).toContain('The authorised signatory is SOCIETY SECRETARY.');
    expect(out).toContain('Hence the profile is marked as Positive.');
    expect(out).not.toMatch(/&quot;|&amp;|&lt;/);
  });
});
