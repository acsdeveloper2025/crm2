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

describe('PROPERTY_INDIVIDUAL default template renders v1-faithful narratives', () => {
  const body = FIELD_REPORT_DEFAULTS['PROPERTY_INDIVIDUAL']!.templateBody;
  const cols = colsFor('PROPERTY_INDIVIDUAL');

  it('Positive & Door Open — ownership + property detail grammar', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        'property-individual',
        'PROPERTY_INDIVIDUAL',
        {
          addressRating: 'Good',
          buildingStatus: 'Completed',
          metPersonName: 'SUNIL',
          relationship: 'Brother',
          propertyOwnerName: 'RAJESH KUMAR',
          approxArea: 900,
          doorNamePlateStatus: 'Sighted',
          nameOnDoorPlate: 'RAJESH',
          societyNamePlateStatus: 'Sighted',
          nameOnSocietyBoard: 'GREEN APT',
          locality: 'Residential',
          addressStructure: '7',
          addressStructureColor: 'Cream',
          doorColor: 'Brown',
          addressFloor: '4',
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
    expect(out).toContain('Property Individual Remark: POSITIVE & DOOR OPEN.');
    expect(out).toContain('The building status is completed.'); // lc building_status
    expect(out).toContain('Met with SUNIL (Brother)');
    expect(out).toContain('Property owner: RAJESH KUMAR.');
    expect(out).toContain('Approximate area is 900 sq. feet.'); // area
    expect(out).toContain('Door nameplate shows the name "RAJESH".');
    expect(out).toContain('Society board displays "GREEN APT".');
    expect(out).toContain('The premises is located on the 4th floor.'); // addressFloor
    expect(out).toContain('Hence the profile is marked as Positive.');
    expect(out).not.toContain('SHIFTED'); // PROP_INDIV has no Shifted outcomes
    expect(out).not.toMatch(/&quot;|&amp;|&lt;/);
  });
});

describe('PROPERTY_APF default template renders v1-faithful narratives', () => {
  const body = FIELD_REPORT_DEFAULTS['PROPERTY_APF']!.templateBody;
  const cols = colsFor('PROPERTY_APF');

  it('Positive — activity-verdict sentence (SEEN + Positive)', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        'property-apf',
        'PROPERTY_APF',
        {
          addressRating: 'Good',
          constructionActivity: 'Seen',
          metPersonName: 'SUNIL',
          metPersonDesignation: 'Site Engineer',
          companyNamePlateStatus: 'Sighted',
          nameOnBoard: 'ACS BUILDERS',
          tpcName1: 'AMIT',
          tpcMetPerson1: 'Neighbour',
          tpcName2: 'RITA',
          tpcMetPerson2: 'Security',
          locality: 'Suburb',
          landmark1: 'NEPTUNE',
          landmark2: 'CROMA',
          dominatedArea: 'Not Dominated',
          feedbackFromNeighbour: 'No Adverse',
          politicalConnection: 'Not Having',
          otherObservation: 'All ok',
          finalStatus: 'Positive',
        },
        'Positive',
      ),
    );
    expect(out).toContain('Property APF Remark: POSITIVE.');
    expect(out).toContain('Construction activity: Seen.');
    expect(out).toContain('Met with SUNIL (Site Engineer), who confirmed the project at the given address.'); // activityVerdict
    expect(out).toContain('Company nameplate displays "ACS BUILDERS".');
    expect(out).toContain('Hence the profile is marked as Positive.');
  });

  it('Negative (STOP) — project details + reason, no vacant clause', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        'property-apf',
        'PROPERTY_APF',
        {
          addressRating: 'Average',
          constructionActivity: 'Construction Is Stop',
          activityStopReason: 'Funding issue',
          buildingStatus: 'Under Construction',
          projectName: 'GREEN HEIGHTS',
          projectStartedDate: '2024-01-15',
          projectCompletionDate: '2026-12-31',
          totalWing: '3',
          totalFlats: '120',
          projectCompletionPercent: '40',
          staffStrength: '15',
          staffSeen: '8',
          tpcName1: 'AMIT',
          tpcMetPerson1: 'Neighbour',
          locality: 'Suburb',
          landmark1: 'L1',
          landmark2: 'L2',
          dominatedArea: 'Not Dominated',
          feedbackFromNeighbour: 'No Adverse',
          politicalConnection: 'Not Having',
          otherObservation: 'Construction halted',
          finalStatus: 'Negative',
        },
        'Negative',
      ),
    );
    expect(out).toContain('Property APF Remark: NEGATIVE.');
    expect(out).toContain('Reason for stop: Funding issue.');
    expect(out).toContain('Project name: GREEN HEIGHTS.');
    expect(out).toContain('Building status: under construction.'); // lc
    expect(out).toContain('Project started on 2024-01-15, expected completion on 2026-12-31.'); // date helper
    expect(out).toContain('Total wings: 3. Total flats: 120. Project completion: 40%.');
    expect(out).not.toContain('currently vacant'); // STOP path, not VACANT
    expect(out).toContain('Hence the profile is marked as Negative.');
  });

  it('Negative (VACANT) — vacant clause, no project details', () => {
    const out = renderNarrative(
      body,
      cols,
      ctx(
        'property-apf',
        'PROPERTY_APF',
        {
          addressRating: 'Average',
          constructionActivity: 'Plot Is Vacant',
          locality: 'Suburb',
          landmark1: 'L1',
          landmark2: 'L2',
          dominatedArea: 'Not Dominated',
          feedbackFromNeighbour: 'No Adverse',
          politicalConnection: 'Not Having',
          otherObservation: 'Vacant plot',
          finalStatus: 'Negative',
        },
        'Negative',
      ),
    );
    expect(out).toContain('Property APF Remark: NEGATIVE.');
    expect(out).toContain(
      'The plot at the given address is currently vacant — no construction or project activity was observed.',
    );
    expect(out).not.toContain('Project name:'); // VACANT path omits project details
    expect(out).not.toContain('Reason for stop:');
    expect(out).toContain('Hence the profile is marked as Negative.');
  });
});
