import type { ReportLayoutColumnInput } from './reportLayouts.js';

/**
 * Standard FIELD_REPORT templates (ADR-0039 S3) — faithful ports of v1's hardcoded narratives
 * (CRM-BACKEND TemplateReportService), offered in the designer as "Load standard template" per
 * verification type. The admin loads one into a (client, product) layout, tweaks if needed, and saves.
 * Each template is ONE Handlebars body branching on the device `outcome` via {{#eq}}; its `columns` are
 * the variable catalog (FORM_DATA_PATH into the device form + case/applicant fields), rendered through
 * the grammar helper library. Verified against the prod (type×outcome) matrix + field keys
 * (docs/specs/2026-06-16-v1-report-mapping.md).
 */

/** The registered grammar-helper names — a variable `columnKey` MUST NOT collide with one (Handlebars
 *  resolves `{{name}}` to the helper, shadowing the variable). The API registers exactly this set
 *  (asserted by a drift test). The designer validates column keys against it. */
export const FIELD_REPORT_HELPERS = [
  'ordinal',
  'pluralize',
  'lc',
  'capFirst',
  'date',
  'area',
  'nameplate',
  'dominatedArea',
  'politicalConnection',
  'sittingLocation',
  'tpcLabel',
  'tpcPair',
  'workingStatus',
  'stayingStatus',
  'setup',
  'businessLocation',
  'documentShown',
  'documentShownSentence',
  'addressFloor',
  'metPersonConfirmation',
  'existsClause',
  'callConfirmation',
  'callRemark',
  'ownershipType',
  'workingProfile',
  'currentCompanyOperating',
  'sentenceClause',
  'activityVerdict',
  'verdictOverride',
  'apfVacant',
  'default',
  'eq',
] as const;
export const FIELD_REPORT_HELPER_SET: ReadonlySet<string> = new Set(FIELD_REPORT_HELPERS);

export interface FieldReportDefault {
  /** the Handlebars narrative body (one template per type; branches on `outcome` via {{#eq}}). */
  templateBody: string;
  /** the variable catalog (each column_key is a Handlebars variable bound to a source). */
  columns: ReportLayoutColumnInput[];
}

/** column builders — keep the catalog readable. */
const F = (columnKey: string, headerLabel: string, ref: string): ReportLayoutColumnInput => ({
  columnKey,
  headerLabel,
  sourceType: 'FORM_DATA_PATH',
  sourceRef: `residence.formData.${ref}`,
  dataType: 'TEXT',
});
const OUTCOME: ReportLayoutColumnInput = {
  columnKey: 'outcome',
  headerLabel: 'Verification Outcome',
  sourceType: 'FORM_DATA_PATH',
  sourceRef: 'residence.verificationOutcome',
  dataType: 'TEXT',
};
const APP = (columnKey: string, headerLabel: string, ref: string): ReportLayoutColumnInput => ({
  columnKey,
  headerLabel,
  sourceType: 'APPLICANT_FIELD',
  sourceRef: ref,
  dataType: 'TEXT',
});
const TASK = (columnKey: string, headerLabel: string, ref: string): ReportLayoutColumnInput => ({
  columnKey,
  headerLabel,
  sourceType: 'TASK_FIELD',
  sourceRef: ref,
  dataType: 'TEXT',
});
/** slug-parametrized FORM_DATA_PATH column (the per-type form slug differs: office/business/etc). */
const FD = (slug: string, columnKey: string, headerLabel: string, ref: string): ReportLayoutColumnInput => ({
  columnKey,
  headerLabel,
  sourceType: 'FORM_DATA_PATH',
  sourceRef: `${slug}.formData.${ref}`,
  dataType: 'TEXT',
});
const OUT = (slug: string): ReportLayoutColumnInput => ({
  columnKey: 'outcome',
  headerLabel: 'Verification Outcome',
  sourceType: 'FORM_DATA_PATH',
  sourceRef: `${slug}.verificationOutcome`,
  dataType: 'TEXT',
});

// ── RESIDENCE ── (v1 RESIDENCE_TEMPLATES, 8 outcomes; prod field keys for the residence form)
const RESIDENCE_COLUMNS: ReportLayoutColumnInput[] = [
  OUTCOME,
  TASK('customer_address', 'Customer Address', 'address'),
  APP('customer_name', 'Customer Name', 'name'),
  APP('applicant_type', 'Applicant Type', 'applicant_type'),
  F('address_rating', 'Address Rating', 'addressRating'),
  F('met_person_name', 'Met Person Name', 'metPersonName'),
  F('met_person_relation', 'Met Person Relation', 'metPersonRelation'),
  F('met_person_status', 'Met Person Status', 'metPersonStatus'),
  F('met_person_type', 'Met Person Type', 'metPersonType'),
  F('met_person_confirmation', 'Met Person Confirmation', 'metPersonConfirmation'),
  F('house_status', 'House Status', 'houseStatus'),
  F('staying_period', 'Staying Period', 'stayingPeriod'),
  F('staying_status', 'Staying Status', 'stayingStatus'),
  F('staying_person_name', 'Current Occupant', 'stayingPersonName'),
  F('shifted_period', 'Shifted Period', 'shiftedPeriod'),
  F('approx_area', 'Approx Area', 'approxArea'),
  F('total_family_members', 'Total Family Members', 'totalFamilyMembers'),
  F('total_earning_members', 'Total Earning Members', 'totalEarningMember'),
  F('working_status', 'Working Status', 'workingStatus'),
  F('company_name', 'Company Name', 'companyName'),
  F('locality', 'Locality', 'locality'),
  F('address_structure', 'Address Structure (G+)', 'addressStructure'),
  F('applicant_staying_floor', 'Applicant Staying Floor', 'applicantStayingFloor'),
  F('applicant_staying_status', 'Applicant Staying Status', 'applicantStayingStatus'),
  F('address_structure_color', 'Structure Color', 'addressStructureColor'),
  F('door_color', 'Door Color', 'doorColor'),
  F('door_nameplate_status', 'Door Nameplate Status', 'doorNamePlateStatus'),
  F('name_on_door_plate', 'Name on Door Plate', 'nameOnDoorPlate'),
  F('society_nameplate_status', 'Society Board Status', 'societyNamePlateStatus'),
  F('name_on_society_board', 'Name on Society Board', 'nameOnSocietyBoard'),
  F('document_shown', 'Document Shown', 'documentShown'),
  F('document_type', 'Document Type', 'documentType'),
  F('call_remark', 'Call Remark', 'callRemark'),
  F('call_confirmation', 'Call Confirmation', 'callConfirmation'),
  F('tpc_name_1', 'TPC 1 Name', 'tpcName1'),
  F('tpc_met_person_1', 'TPC 1 Relation', 'tpcMetPerson1'),
  F('tpc_confirmation_1', 'TPC 1 Confirmation', 'tpcConfirmation1'),
  F('tpc_name_2', 'TPC 2 Name', 'tpcName2'),
  F('tpc_met_person_2', 'TPC 2 Relation', 'tpcMetPerson2'),
  F('tpc_confirmation_2', 'TPC 2 Confirmation', 'tpcConfirmation2'),
  F('landmark_1', 'Landmark 1', 'landmark1'),
  F('landmark_2', 'Landmark 2', 'landmark2'),
  F('landmark_3', 'Landmark 3', 'landmark3'),
  F('landmark_4', 'Landmark 4', 'landmark4'),
  F('dominated_area', 'Dominated Area', 'dominatedArea'),
  F('feedback_from_neighbour', 'Neighbour Feedback', 'feedbackFromNeighbour'),
  F('political_connection', 'Political Connection', 'politicalConnection'),
  F('contact_person', 'Contact Person', 'contactPerson'),
  F('other_observation', 'Field Observation', 'otherObservation'),
  F('final_status', 'Final Status', 'finalStatus'),
];

// Shared sub-clauses reused across the positive/locked branches.
const RESI_TPC = `TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} {{customer_name}}'s name and stay. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} {{customer_name}}'s residence.`;
const RESI_AREA = `Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{capFirst feedback_from_neighbour}} feedback was received from neighbours. {{politicalConnection political_connection}}.`;
const RESI_CONCLUSION = `CONCLUSION:\nField Executive Observation: {{other_observation}}\nHence the profile is marked as {{default final_status outcome}}.`;
const RESI_PLATES = `The door nameplate {{nameplate door_nameplate_status name_on_door_plate}}. Society board {{nameplate society_nameplate_status name_on_society_board "displays"}}.`;
const RESI_LOCALITY = `The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}} and door color is {{door_color}}.`;

const RESIDENCE_BODY = `{{#eq outcome "Positive & Door Open"}}Residence Remark: POSITIVE & DOOR OPEN.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, met with {{met_person_name}} ({{met_person_relation}}), who confirmed {{customer_name}}'s stay and provided the details. {{customer_name}} has been staying at the given address for the last {{pluralize staying_period}} {{lc staying_status}}.

PROPERTY & PERSONAL DETAILS:
The approximate area of the premises is {{area approx_area}}. Total family members are {{total_family_members}} and earning members are {{total_earning_members}}. {{workingProfile customer_name working_status company_name}} ${RESI_PLATES}

LOCALITY INFORMATION:
${RESI_LOCALITY} {{customer_name}} is staying on the {{ordinal applicant_staying_floor}} floor. {{documentShownSentence document_shown document_type}}

THIRD PARTY CONFIRMATION:
${RESI_TPC}

AREA ASSESSMENT:
${RESI_AREA} {{customer_name}}'s stay is confirmed by the field executive's observation as well as from TPC.

${RESI_CONCLUSION}{{/eq}}{{#eq outcome "Positive & Door Locked"}}Residence Remark: POSITIVE & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the door was locked. A telephonic attempt was also made and {{callRemark call_remark call_confirmation}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} {{customer_name}}'s name and stay at the given address. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} {{customer_name}}'s residence. It is confirmed that {{customer_name}} has been staying at the given address for the last {{pluralize staying_period}} {{lc staying_status}}.

PROPERTY DETAILS:
${RESI_PLATES}

LOCALITY INFORMATION:
${RESI_LOCALITY}

AREA ASSESSMENT:
${RESI_AREA} {{customer_name}}'s stay is confirmed by the field executive's observation as well as from TPC.

${RESI_CONCLUSION}{{/eq}}{{#eq outcome "Shifted & Door Open"}}Residence Remark: SHIFTED & DOOR OPEN.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the door was {{lc house_status}}. Met with {{met_person_name}} ({{met_person_status}}), who informed that {{customer_name}} has shifted to another address for the last {{pluralize shifted_period}}.

PROPERTY DETAILS:
${RESI_PLATES}

LOCALITY INFORMATION:
${RESI_LOCALITY} {{addressFloor applicant_staying_floor}}

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} {{customer_name}}'s shift from the given address. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.

AREA ASSESSMENT:
${RESI_AREA}

${RESI_CONCLUSION}{{/eq}}{{#eq outcome "Shifted & Door Locked"}}Residence Remark: SHIFTED & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the door was locked. A telephonic attempt was also made and {{callRemark call_remark call_confirmation}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} {{customer_name}}'s shift from the given address for the last {{pluralize shifted_period}}. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.

PROPERTY DETAILS:
${RESI_PLATES}

LOCALITY INFORMATION:
${RESI_LOCALITY} {{addressFloor applicant_staying_floor}}

AREA ASSESSMENT:
${RESI_AREA}

${RESI_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Open"}}Residence Remark: NSP & DOOR OPEN (No Such Person).

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the door was {{lc house_status}}. Met with {{met_person_name}} ({{met_person_status}}), who informed that there is no such person staying at the given address.

CURRENT RESIDENT INFORMATION:
The met person has been staying at the given address for the last {{pluralize staying_period}}. As per the current resident, {{customer_name}} has never stayed at this address.

PROPERTY DETAILS:
${RESI_PLATES}

LOCALITY INFORMATION:
${RESI_LOCALITY} {{addressFloor applicant_staying_floor}}

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}} and {{tpcLabel tpc_name_2 tpc_met_person_2}}, who confirmed that no such person is staying at the given address.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s presence at this address is not confirmed by the field executive's observation or from TPC.

${RESI_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Locked"}}Residence Remark: NSP & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the door was locked. A telephonic attempt was also made and {{callRemark call_remark call_confirmation}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}} and {{tpcLabel tpc_name_2 tpc_met_person_2}}, who informed that no such person ({{customer_name}}) is staying at the given address. The current occupant at the given address is {{staying_person_name}}.

PROPERTY DETAILS:
${RESI_PLATES}

LOCALITY INFORMATION:
${RESI_LOCALITY} {{addressFloor applicant_staying_floor}}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s presence at this address is not confirmed by the field executive's observation or from TPC.

${RESI_CONCLUSION}{{/eq}}{{#eq outcome "ERT"}}Residence Remark: ENTRY RESTRICTED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, met with {{met_person_name}} ({{met_person_type}}), who informed that entry to the given premises is not allowed. A telephonic attempt was also made and {{callRemark call_remark call_confirmation}}.

ENTRY RESTRICTION DETAILS:
{{met_person_name}} {{metPersonConfirmation met_person_confirmation}} {{customer_name}}'s stay at the given address. Society board {{nameplate society_nameplate_status name_on_society_board "displays"}}.

LOCALITY INFORMATION:
The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}}.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}.{{sentenceClause feedback_from_neighbour " " " feedback was received from neighbours."}}

${RESI_CONCLUSION}{{/eq}}{{#eq outcome "Untraceable"}}Residence Remark: UNTRACEABLE.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is incorrect and untraceable.

CONTACT ATTEMPT:
We called {{customer_name}}, but {{callRemark call_remark call_confirmation}}. At the given location, inquired with {{contact_person}}, who could not provide guidance to the address.

LOCALITY INFORMATION:
The locality type is {{locality}}. Field executive surveyed the following landmarks during the search: {{landmark_1}}, {{landmark_2}}, {{landmark_3}}, {{landmark_4}}. {{dominatedArea dominated_area}}.

${RESI_CONCLUSION}{{/eq}}`;

// ── OFFICE ── (v1 OFFICE_TEMPLATES, 8 outcomes; prod field keys for the office form)
const OFFICE_COLUMNS: ReportLayoutColumnInput[] = [
  OUT('office'),
  TASK('customer_address', 'Customer Address', 'address'),
  APP('customer_name', 'Customer Name', 'name'),
  APP('applicant_type', 'Applicant Type', 'applicant_type'),
  FD('office', 'address_rating', 'Address Rating', 'addressRating'),
  FD('office', 'office_status', 'Office Status', 'officeStatus'),
  FD('office', 'met_person_name', 'Met Person Name', 'metPersonName'),
  FD('office', 'designation', 'Met Person Designation', 'metPersonDesignation'),
  FD('office', 'working_period', 'Working Period', 'workingPeriod'),
  FD('office', 'applicant_designation', 'Applicant Designation', 'applicantDesignation'),
  FD('office', 'applicant_working_premises', 'Applicant Working Premises', 'applicantWorkingPremises'),
  FD('office', 'sitting_location', 'Sitting Location', 'sittingLocation'),
  FD('office', 'office_type', 'Office Type', 'officeType'),
  FD('office', 'company_nature_of_business', 'Nature of Business', 'companyNatureOfBusiness'),
  FD('office', 'establishment_period', 'Establishment Period', 'establishmentPeriod'),
  FD('office', 'staff_strength', 'Staff Strength', 'staffStrength'),
  FD('office', 'staff_seen', 'Staff Seen', 'staffSeen'),
  FD('office', 'office_approx_area', 'Office Approx Area', 'officeApproxArea'),
  FD('office', 'company_name_plate_status', 'Company Nameplate Status', 'companyNamePlateStatus'),
  FD('office', 'name_on_board', 'Name on Board', 'nameOnBoard'),
  FD('office', 'document_shown', 'Document Shown', 'documentShown'),
  FD('office', 'locality', 'Locality', 'locality'),
  FD('office', 'address_structure', 'Address Structure (G+)', 'addressStructure'),
  FD('office', 'address_structure_color', 'Structure Color', 'addressStructureColor'),
  FD('office', 'door_color', 'Door Color', 'doorColor'),
  FD('office', 'address_floor', 'Address Floor', 'addressFloor'),
  FD('office', 'old_office_shifted_period', 'Old Office Shifted Period', 'oldOfficeShiftedPeriod'),
  FD('office', 'current_company_name', 'Current Company Name', 'currentCompanyName'),
  FD('office', 'current_company_period', 'Current Company Period', 'currentCompanyPeriod'),
  FD('office', 'name_of_met_person', 'Name of Met Person (ERT)', 'metPersonName'),
  FD('office', 'met_person_type', 'Met Person Type', 'metPersonType'),
  FD('office', 'met_person_confirmation', 'Met Person Confirmation', 'metPersonConfirmation'),
  FD('office', 'office_exists_status', 'Office Exists Status', 'officeExistsStatus'),
  FD('office', 'applicant_working_status', 'Applicant Working Status', 'applicantWorkingStatus'),
  FD('office', 'call_remark', 'Call Remark', 'callRemark'),
  FD('office', 'contact_person', 'Contact Person', 'contactPerson'),
  FD('office', 'tpc_name_1', 'TPC 1 Name', 'tpcName1'),
  FD('office', 'tpc_met_person_1', 'TPC 1 Relation', 'tpcMetPerson1'),
  FD('office', 'tpc_confirmation_1', 'TPC 1 Confirmation', 'tpcConfirmation1'),
  FD('office', 'tpc_name_2', 'TPC 2 Name', 'tpcName2'),
  FD('office', 'tpc_met_person_2', 'TPC 2 Relation', 'tpcMetPerson2'),
  FD('office', 'tpc_confirmation_2', 'TPC 2 Confirmation', 'tpcConfirmation2'),
  FD('office', 'landmark_1', 'Landmark 1', 'landmark1'),
  FD('office', 'landmark_2', 'Landmark 2', 'landmark2'),
  FD('office', 'landmark_3', 'Landmark 3', 'landmark3'),
  FD('office', 'landmark_4', 'Landmark 4', 'landmark4'),
  FD('office', 'dominated_area', 'Dominated Area', 'dominatedArea'),
  FD('office', 'feedback_from_neighbour', 'Neighbour Feedback', 'feedbackFromNeighbour'),
  FD('office', 'political_connection', 'Political Connection', 'politicalConnection'),
  FD('office', 'other_observation', 'Field Observation', 'otherObservation'),
  FD('office', 'final_status', 'Final Status', 'finalStatus'),
];

const OFFICE_LOCALITY = `The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}} and door color is {{door_color}}. {{addressFloor address_floor}}`;
const OFFICE_TPC_EMPLOY = `TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} {{customer_name}}'s employment and office existence. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.`;
const OFFICE_TPC_SHIFTED = `TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} that the company has shifted from the given address {{pluralize old_office_shifted_period}} ago. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.`;
const OFFICE_CONCLUSION = `CONCLUSION:\nField Executive Observation: {{other_observation}}\nHence the profile is marked as {{default final_status outcome}}.`;

const OFFICE_BODY = `{{#eq outcome "Positive & Door Open"}}Office Remark: POSITIVE & DOOR OPEN.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the office was {{lc office_status}}. Met with {{met_person_name}} ({{designation}}), who confirmed that {{customer_name}} has been working at the given office for the last {{pluralize working_period}} as {{applicant_designation}}.

EMPLOYMENT & OFFICE DETAILS:
{{customer_name}} works as {{applicant_designation}} and {{sittingLocation applicant_working_premises sitting_location}}. The office is a {{office_type}} engaged in {{company_nature_of_business}}. It has been established at the given address for the last {{pluralize establishment_period}}. Total staff strength is {{staff_strength}}, of which {{staff_seen}} were seen during the visit. The office area is approximately {{area office_approx_area}}. Company nameplate {{nameplate company_name_plate_status name_on_board "displays"}}. {{documentShownSentence document_shown ""}}

LOCALITY INFORMATION:
${OFFICE_LOCALITY}

THIRD PARTY CONFIRMATION:
${OFFICE_TPC_EMPLOY}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{capFirst feedback_from_neighbour}} feedback was received regarding {{customer_name}} and the firm. {{politicalConnection political_connection}}. {{customer_name}}'s employment is confirmed by the field executive's observation as well as from TPC.

${OFFICE_CONCLUSION}{{/eq}}{{#eq outcome "Positive & Door Locked"}}Office Remark: POSITIVE & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the office was {{lc office_status}}. A telephonic attempt was also made and {{callRemark call_remark}}.

THIRD PARTY CONFIRMATION:
${OFFICE_TPC_EMPLOY}

OFFICE DETAILS:
Company nameplate {{nameplate company_name_plate_status name_on_board "displays"}}. The office has been established at the given address for the last {{pluralize establishment_period}}.

LOCALITY INFORMATION:
${OFFICE_LOCALITY}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{capFirst feedback_from_neighbour}} feedback was received from neighbours. {{politicalConnection political_connection}}.

${OFFICE_CONCLUSION}{{/eq}}{{#eq outcome "Shifted & Door Open"}}Office Remark: SHIFTED & DOOR OPEN.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the office was {{lc office_status}}. Met with {{met_person_name}} ({{designation}}), who confirmed that the company has shifted from the given address {{pluralize old_office_shifted_period}} ago.

CURRENT OFFICE STATUS:
{{current_company_name}} is currently operating at the given address for the last {{pluralize current_company_period}}. Company nameplate {{nameplate company_name_plate_status name_on_board "displays"}}.

LOCALITY INFORMATION:
${OFFICE_LOCALITY}

THIRD PARTY CONFIRMATION:
${OFFICE_TPC_SHIFTED}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{capFirst feedback_from_neighbour}} feedback was received from neighbours. {{politicalConnection political_connection}}.

${OFFICE_CONCLUSION}{{/eq}}{{#eq outcome "Shifted & Door Locked"}}Office Remark: SHIFTED & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the office was closed. A telephonic attempt was also made and {{callRemark call_remark}}.

THIRD PARTY CONFIRMATION:
${OFFICE_TPC_SHIFTED}

CURRENT OFFICE STATUS:
{{current_company_name}} is currently operating at the given address for the last {{pluralize current_company_period}}. Company nameplate {{nameplate company_name_plate_status name_on_board "displays"}}.

LOCALITY INFORMATION:
${OFFICE_LOCALITY}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{capFirst feedback_from_neighbour}} feedback was received from neighbours. {{politicalConnection political_connection}}.

${OFFICE_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Open"}}Office Remark: NSP & DOOR OPEN (No Such Person).

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the office was {{lc office_status}}. Met with {{met_person_name}} ({{designation}}).

EMPLOYMENT VERIFICATION:
The met person informed that no such person is working at the given address. As per the current office staff, {{customer_name}} has never worked at this office.

OFFICE DETAILS:
Company nameplate {{nameplate company_name_plate_status name_on_board "displays"}}. {{current_company_name}} is currently operating at the given address.

LOCALITY INFORMATION:
${OFFICE_LOCALITY}

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}} and {{tpcLabel tpc_name_2 tpc_met_person_2}}, who confirmed that no such person is working at the given address.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s employment is not confirmed by the field executive's observation or from TPC.

${OFFICE_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Locked"}}Office Remark: NSP & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the office was closed. A telephonic attempt was also made and {{callRemark call_remark}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}} and {{tpcLabel tpc_name_2 tpc_met_person_2}}, who confirmed that the office exists at the given address but no such person ({{customer_name}}) is working there.

CURRENT OFFICE STATUS:
{{currentCompanyOperating current_company_name (pluralize current_company_period)}}Company nameplate {{nameplate company_name_plate_status name_on_board "displays"}}.

LOCALITY INFORMATION:
${OFFICE_LOCALITY}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s employment is not confirmed by the field executive's observation or from TPC.

${OFFICE_CONCLUSION}{{/eq}}{{#eq outcome "ERT"}}Office Remark: ENTRY RESTRICTED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, met with {{name_of_met_person}} ({{met_person_type}}), who informed that entry to the given premises is not allowed. A telephonic attempt was also made and {{callRemark call_remark}}.

ENTRY RESTRICTION DETAILS:
{{name_of_met_person}} {{metPersonConfirmation met_person_confirmation}} the office existence at the given address{{existsClause office_exists_status}}.{{sentenceClause (workingStatus applicant_working_status) " The met person also informed that " "."}} Entry is restricted due to security protocols or company policies.

LOCALITY INFORMATION:
The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}}.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}.{{sentenceClause (capFirst feedback_from_neighbour) " " " feedback was received from the met person."}}{{sentenceClause political_connection " " "."}}

${OFFICE_CONCLUSION}{{/eq}}{{#eq outcome "Untraceable"}}Office Remark: UNTRACEABLE.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is incorrect and untraceable.

CONTACT ATTEMPT:
We called {{customer_name}}, but {{callRemark call_remark}}. At the given location, inquired with {{contact_person}}, who could not provide guidance to the address.

SEARCH EFFORTS:
The locality type is {{locality}}. Field executive surveyed the following landmarks during the search: {{landmark_1}}, {{landmark_2}}, {{landmark_3}}, {{landmark_4}}. {{dominatedArea dominated_area}}.

${OFFICE_CONCLUSION}{{/eq}}`;

// ── BUSINESS ── (v1 BUSINESS_TEMPLATES, 8 outcomes; prod field keys for the business form)
const BUSINESS_COLUMNS: ReportLayoutColumnInput[] = [
  OUT('business'),
  TASK('customer_address', 'Customer Address', 'address'),
  APP('customer_name', 'Customer Name', 'name'),
  APP('applicant_type', 'Applicant Type', 'applicant_type'),
  FD('business', 'address_rating', 'Address Rating', 'addressRating'),
  FD('business', 'business_status', 'Business Status', 'businessStatus'),
  FD('business', 'met_person_name', 'Met Person Name', 'metPersonName'),
  FD('business', 'designation', 'Met Person Designation', 'metPersonDesignation'),
  FD('business', 'business_period', 'Business Period', 'businessPeriod'),
  FD('business', 'business_type', 'Business Type', 'businessType'),
  FD('business', 'ownership_type', 'Ownership Type', 'ownershipType'),
  FD('business', 'company_nature_of_business', 'Nature of Business', 'companyNatureOfBusiness'),
  FD('business', 'business_approx_area', 'Business Approx Area', 'approxArea'),
  FD('business', 'business_owner_name', 'Business Owner Name', 'nameOfCompanyOwners'),
  FD('business', 'company_name_plate_status', 'Company Nameplate Status', 'companyNamePlateStatus'),
  FD('business', 'name_on_board', 'Name on Board', 'nameOnBoard'),
  FD('business', 'staff_strength', 'Staff Strength', 'staffStrength'),
  FD('business', 'staff_seen', 'Staff Seen', 'staffSeen'),
  FD('business', 'document_shown', 'Document Shown', 'documentShown'),
  FD('business', 'premises_status', 'Premises Status', 'premisesStatus'),
  FD('business', 'current_company_name', 'Current Company Name', 'currentCompanyName'),
  FD('business', 'current_company_period', 'Current Company Period', 'currentCompanyPeriod'),
  FD('business', 'old_business_shifted_period', 'Old Business Shifted Period', 'oldOfficeShiftedPeriod'),
  FD('business', 'locality', 'Locality', 'locality'),
  FD('business', 'address_structure', 'Address Structure (G+)', 'addressStructure'),
  FD('business', 'address_structure_color', 'Structure Color', 'addressStructureColor'),
  FD('business', 'door_color', 'Door Color', 'doorColor'),
  FD('business', 'address_floor', 'Address Floor', 'addressFloor'),
  FD('business', 'call_remark', 'Call Remark', 'callRemark'),
  FD('business', 'tpc_name_1', 'TPC 1 Name', 'tpcName1'),
  FD('business', 'tpc_met_person_1', 'TPC 1 Relation', 'tpcMetPerson1'),
  FD('business', 'tpc_confirmation_1', 'TPC 1 Confirmation', 'tpcConfirmation1'),
  FD('business', 'tpc_name_2', 'TPC 2 Name', 'tpcName2'),
  FD('business', 'tpc_met_person_2', 'TPC 2 Relation', 'tpcMetPerson2'),
  FD('business', 'tpc_confirmation_2', 'TPC 2 Confirmation', 'tpcConfirmation2'),
  FD('business', 'landmark_1', 'Landmark 1', 'landmark1'),
  FD('business', 'landmark_2', 'Landmark 2', 'landmark2'),
  FD('business', 'landmark_3', 'Landmark 3', 'landmark3'),
  FD('business', 'landmark_4', 'Landmark 4', 'landmark4'),
  FD('business', 'dominated_area', 'Dominated Area', 'dominatedArea'),
  FD('business', 'feedback_from_neighbour', 'Neighbour Feedback', 'feedbackFromNeighbour'),
  FD('business', 'political_connection', 'Political Connection', 'politicalConnection'),
  FD('business', 'contact_person', 'Contact Person', 'contactPerson'),
  FD('business', 'name_of_met_person', 'Name of Met Person (ERT)', 'metPersonName'),
  FD('business', 'met_person_type', 'Met Person Type (ERT)', 'metPersonType'),
  FD('business', 'met_person_confirmation', 'Met Person Confirmation (ERT)', 'metPersonConfirmation'),
  FD('business', 'business_exists_status', 'Business Exists Status (ERT)', 'businessExistsStatus'),
  FD('business', 'applicant_working_status', 'Applicant Working Status (ERT)', 'applicantWorkingStatus'),
  FD('business', 'other_observation', 'Field Observation', 'otherObservation'),
  FD('business', 'final_status', 'Final Status', 'finalStatus'),
];

const BIZ_TPC = `TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} {{customer_name}}'s business existence. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.`;
const BIZ_TPC_SHIFTED = `TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} that the business has shifted from the given address {{pluralize old_business_shifted_period}} ago. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.`;
const BIZ_LOCALITY = `The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}} and door color is {{door_color}}. {{addressFloor address_floor}}`;
const BIZ_NAMEPLATE = `Company nameplate {{nameplate company_name_plate_status name_on_board "displays"}}.`;
const BIZ_AREA_NEIGHBOUR = `Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{capFirst feedback_from_neighbour}} feedback was received from neighbours. {{politicalConnection political_connection}}.`;
const BIZ_CONCLUSION = `CONCLUSION:\nField Executive Observation: {{other_observation}}\nHence the profile is marked as {{default final_status outcome}}.`;

const BUSINESS_BODY = `{{#eq outcome "Positive & Door Open"}}Business Remark: POSITIVE & DOOR OPEN.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the business was {{lc business_status}}. Met with {{met_person_name}} ({{designation}}), who confirmed that {{customer_name}} has been running the business at the given address for the last {{pluralize business_period}}.

BUSINESS DETAILS:
Business type is {{business_type}} ({{ownershipType ownership_type}}) and the nature of business is {{company_nature_of_business}}. The business area is approximately {{area business_approx_area}}. Business owner: {{business_owner_name}}. ${BIZ_NAMEPLATE} Total staff strength is {{staff_strength}} and {{staff_seen}} were seen during the visit. {{documentShownSentence document_shown ""}}

LOCALITY INFORMATION:
${BIZ_LOCALITY}

THIRD PARTY CONFIRMATION:
${BIZ_TPC}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{capFirst feedback_from_neighbour}} feedback was received regarding {{customer_name}} and the business. {{politicalConnection political_connection}}. {{customer_name}}'s business stability is confirmed by the field executive's observation as well as from TPC.

${BIZ_CONCLUSION}{{/eq}}{{#eq outcome "Positive & Door Locked"}}Business Remark: POSITIVE & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the business was {{lc business_status}}. A telephonic attempt was also made and {{callRemark call_remark}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} {{customer_name}}'s business existence. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same. They informed that the business has been operating at the given address for the last {{pluralize business_period}}.

BUSINESS DETAILS:
The nature of business is {{company_nature_of_business}}. ${BIZ_NAMEPLATE}

LOCALITY INFORMATION:
${BIZ_LOCALITY}

AREA ASSESSMENT:
${BIZ_AREA_NEIGHBOUR}

${BIZ_CONCLUSION}{{/eq}}{{#eq outcome "Shifted & Door Open"}}Business Remark: SHIFTED & DOOR OPEN.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the business was {{lc business_status}}. Met with {{met_person_name}} ({{designation}}), who confirmed that the business has shifted from the given address {{pluralize old_business_shifted_period}} ago.

CURRENT BUSINESS STATUS:
{{currentCompanyOperating current_company_name (pluralize current_company_period)}}${BIZ_NAMEPLATE}

LOCALITY INFORMATION:
${BIZ_LOCALITY}

THIRD PARTY CONFIRMATION:
${BIZ_TPC_SHIFTED}

AREA ASSESSMENT:
${BIZ_AREA_NEIGHBOUR}

${BIZ_CONCLUSION}{{/eq}}{{#eq outcome "Shifted & Door Locked"}}Business Remark: SHIFTED & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the business was closed. A telephonic attempt was also made and {{callRemark call_remark}}.

THIRD PARTY CONFIRMATION:
${BIZ_TPC_SHIFTED}

CURRENT BUSINESS STATUS:
{{currentCompanyOperating current_company_name (pluralize current_company_period)}}${BIZ_NAMEPLATE}

LOCALITY INFORMATION:
${BIZ_LOCALITY}

AREA ASSESSMENT:
${BIZ_AREA_NEIGHBOUR}

${BIZ_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Open"}}Business Remark: NSP & DOOR OPEN (No Such Person).

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the business was {{lc business_status}}. Met with {{met_person_name}} ({{designation}}).

BUSINESS VERIFICATION:
The met person informed that no such person is running a business at the given address. As per the current business owner, {{customer_name}} has never operated a business at this address.

CURRENT BUSINESS DETAILS:
At present, the given premises is {{lc premises_status}}. ${BIZ_NAMEPLATE}

LOCALITY INFORMATION:
${BIZ_LOCALITY}

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}} and {{tpcLabel tpc_name_2 tpc_met_person_2}}, who confirmed that no such person is running a business at the given address.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s business presence is not confirmed by the field executive's observation or from TPC.

${BIZ_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Locked"}}Business Remark: NSP & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the business was closed. A telephonic attempt was also made and {{callRemark call_remark}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}} and {{tpcLabel tpc_name_2 tpc_met_person_2}}, who confirmed that the business exists at the given address but no such person ({{customer_name}}) is running it.

CURRENT BUSINESS STATUS:
{{currentCompanyOperating current_company_name (pluralize current_company_period)}}${BIZ_NAMEPLATE}

LOCALITY INFORMATION:
${BIZ_LOCALITY}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s business presence is not confirmed by the field executive's observation or from TPC.

${BIZ_CONCLUSION}{{/eq}}{{#eq outcome "ERT"}}Business Remark: ENTRY RESTRICTED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, met with {{name_of_met_person}} ({{met_person_type}}), who informed that entry to the given premises is not allowed. A telephonic attempt was also made and {{callRemark call_remark}}.

ENTRY RESTRICTION DETAILS:
{{name_of_met_person}} {{metPersonConfirmation met_person_confirmation}} the business existence at the given address{{existsClause business_exists_status}}.{{sentenceClause (workingStatus applicant_working_status) " The met person also informed that " "."}} Entry is restricted due to security protocols or business policies.

LOCALITY INFORMATION:
The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}}.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}.{{sentenceClause (capFirst feedback_from_neighbour) " " " feedback was received from the met person."}}{{sentenceClause political_connection " " "."}}

${BIZ_CONCLUSION}{{/eq}}{{#eq outcome "Untraceable"}}Business Remark: UNTRACEABLE.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is incorrect and untraceable.

CONTACT ATTEMPT:
We called {{customer_name}}, but {{callRemark call_remark}}. At the given location, inquired with {{contact_person}}, who could not provide guidance to the address.

SEARCH EFFORTS:
The locality type is {{locality}}. Field executive surveyed the following landmarks during the search: {{landmark_1}}, {{landmark_2}}, {{landmark_3}}, {{landmark_4}}. {{dominatedArea dominated_area}}.

${BIZ_CONCLUSION}{{/eq}}`;

// ── RESIDENCE_CUM_OFFICE ── (v1 RESIDENCE_CUM_OFFICE_TEMPLATES, 8 outcomes; prod RCO field keys)
const RCO_COLUMNS: ReportLayoutColumnInput[] = [
  OUT('residence-cum-office'),
  TASK('customer_address', 'Customer Address', 'address'),
  APP('customer_name', 'Customer Name', 'name'),
  APP('applicant_type', 'Applicant Type', 'applicant_type'),
  FD('residence-cum-office', 'address_rating', 'Address Rating', 'addressRating'),
  FD('residence-cum-office', 'address_traceable', 'Address Traceable', 'addressTraceable'),
  FD('residence-cum-office', 'house_status', 'Residence-cum-Office Status', 'resiCumOfficeStatus'),
  FD('residence-cum-office', 'met_person_name', 'Met Person Name', 'metPersonName'),
  FD('residence-cum-office', 'met_person_relation', 'Met Person Relation', 'relation'),
  FD('residence-cum-office', 'met_person_status', 'Met Person Status', 'metPersonStatus'),
  FD('residence-cum-office', 'met_person_type', 'Met Person Type', 'metPersonType'),
  FD('residence-cum-office', 'met_person_confirmation', 'Met Person Confirmation', 'metPersonConfirmation'),
  FD('residence-cum-office', 'staying_period', 'Staying Period', 'stayingPeriod'),
  FD('residence-cum-office', 'staying_status', 'Staying Status', 'stayingStatus'),
  FD('residence-cum-office', 'staying_person_name', 'Current Occupant', 'stayingPersonName'),
  FD('residence-cum-office', 'shifted_period', 'Shifted Period', 'shiftedPeriod'),
  FD('residence-cum-office', 'applicant_staying_floor', 'Applicant Staying Floor', 'applicantStayingFloor'),
  FD(
    'residence-cum-office',
    'applicant_staying_status',
    'Applicant Staying Status',
    'applicantStayingStatus',
  ),
  FD(
    'residence-cum-office',
    'applicant_working_status',
    'Applicant Working Status',
    'applicantWorkingStatus',
  ),
  FD('residence-cum-office', 'residence_setup', 'Residence Setup', 'residenceSetup'),
  FD('residence-cum-office', 'business_status', 'Business Status', 'businessStatus'),
  FD('residence-cum-office', 'business_period', 'Business Period', 'businessPeriod'),
  FD('residence-cum-office', 'business_setup', 'Business Setup', 'businessSetup'),
  FD('residence-cum-office', 'business_location_value', 'Business Location', 'businessLocation'),
  FD(
    'residence-cum-office',
    'business_operating_address',
    'Business Operating Address',
    'businessOperatingAddress',
  ),
  FD('residence-cum-office', 'business_exists_status', 'Business Exists Status', 'businessExistsStatus'),
  FD('residence-cum-office', 'company_nature_of_business', 'Nature of Business', 'companyNatureOfBusiness'),
  FD('residence-cum-office', 'approx_area', 'Approx Area', 'approxArea'),
  FD('residence-cum-office', 'locality', 'Locality', 'locality'),
  FD('residence-cum-office', 'address_structure', 'Address Structure (G+)', 'addressStructure'),
  FD('residence-cum-office', 'address_structure_color', 'Structure Color', 'addressStructureColor'),
  FD('residence-cum-office', 'door_color', 'Door Color', 'doorColor'),
  FD('residence-cum-office', 'door_nameplate_status', 'Door Nameplate Status', 'doorNamePlateStatus'),
  FD('residence-cum-office', 'name_on_door_plate', 'Name on Door Plate', 'nameOnDoorPlate'),
  FD('residence-cum-office', 'society_nameplate_status', 'Society Board Status', 'societyNamePlateStatus'),
  FD('residence-cum-office', 'name_on_society_board', 'Name on Society Board', 'nameOnSocietyBoard'),
  FD('residence-cum-office', 'company_name_plate_status', 'Company Board Status', 'companyNamePlateStatus'),
  FD('residence-cum-office', 'name_on_board', 'Name on Company Board', 'nameOnBoard'),
  FD('residence-cum-office', 'document_shown', 'Document Shown', 'documentShown'),
  FD('residence-cum-office', 'call_remark', 'Call Remark', 'callRemark'),
  FD('residence-cum-office', 'tpc_name_1', 'TPC 1 Name', 'tpcName1'),
  FD('residence-cum-office', 'tpc_met_person_1', 'TPC 1 Relation', 'tpcMetPerson1'),
  FD('residence-cum-office', 'tpc_confirmation_1', 'TPC 1 Confirmation', 'tpcConfirmation1'),
  FD('residence-cum-office', 'tpc_name_2', 'TPC 2 Name', 'tpcName2'),
  FD('residence-cum-office', 'tpc_met_person_2', 'TPC 2 Relation', 'tpcMetPerson2'),
  FD('residence-cum-office', 'tpc_confirmation_2', 'TPC 2 Confirmation', 'tpcConfirmation2'),
  FD('residence-cum-office', 'landmark_1', 'Landmark 1', 'landmark1'),
  FD('residence-cum-office', 'landmark_2', 'Landmark 2', 'landmark2'),
  FD('residence-cum-office', 'landmark_3', 'Landmark 3', 'landmark3'),
  FD('residence-cum-office', 'landmark_4', 'Landmark 4', 'landmark4'),
  FD('residence-cum-office', 'dominated_area', 'Dominated Area', 'dominatedArea'),
  FD('residence-cum-office', 'feedback_from_neighbour', 'Neighbour Feedback', 'feedbackFromNeighbour'),
  FD('residence-cum-office', 'political_connection', 'Political Connection', 'politicalConnection'),
  FD('residence-cum-office', 'contact_person', 'Contact Person', 'contactPerson'),
  FD('residence-cum-office', 'other_observation', 'Field Observation', 'otherObservation'),
  FD('residence-cum-office', 'final_status', 'Final Status', 'finalStatus'),
];

const RCO_PLATES_DOOR_SOC = `Door nameplate {{nameplate door_nameplate_status name_on_door_plate}}. Society board {{nameplate society_nameplate_status name_on_society_board "displays"}}.`;
const RCO_PLATES_FULL = `${RCO_PLATES_DOOR_SOC} Company nameplate {{nameplate company_name_plate_status name_on_board "displays"}}.`;
const RCO_LOCALITY = `The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}} and door color is {{door_color}}.`;
const RCO_AREA = `Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{capFirst feedback_from_neighbour}} feedback was received from neighbours. {{politicalConnection political_connection}}.`;
const RCO_CONCLUSION = `CONCLUSION:\nField Executive Observation: {{other_observation}}\nHence the profile is marked as {{default final_status outcome}}.`;

const RCO_BODY = `{{#eq outcome "Positive & Door Open"}}Residence-cum-Office Remark: POSITIVE & DOOR OPEN.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the residence-cum-office was {{lc house_status}}. Met with {{met_person_name}} ({{met_person_relation}}), who confirmed {{customer_name}}'s stay and business at the given address for the last {{pluralize staying_period}}.

RESIDENCE VERIFICATION:
{{customer_name}} has been staying at the given address for the last {{pluralize staying_period}} {{lc staying_status}}, on the {{ordinal applicant_staying_floor}} floor. Residence setup was {{setup residence_setup}}.

BUSINESS VERIFICATION:
{{customer_name}} has been operating the business at the given address for the last {{pluralize business_period}}. The nature of business is {{company_nature_of_business}}. The business is operated as {{business_status}} {{businessLocation business_location_value business_operating_address}}. Business setup was {{setup business_setup}}. The approximate area of the premises is {{approx_area}} sq. feet.

PROPERTY DETAILS:
${RCO_PLATES_FULL} {{documentShownSentence document_shown ""}}

LOCALITY INFORMATION:
${RCO_LOCALITY}

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} {{customer_name}}'s residence and business existence. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.

AREA ASSESSMENT:
${RCO_AREA} {{customer_name}}'s residence and business stability is confirmed by the field executive's observation as well as from TPC.

${RCO_CONCLUSION}{{/eq}}{{#eq outcome "Positive & Door Locked"}}Residence-cum-Office Remark: POSITIVE & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the residence-cum-office was closed. A telephonic attempt was also made and {{callRemark call_remark}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} {{customer_name}}'s residence and business existence. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same. They informed that {{customer_name}} has been staying at the given address for the last {{pluralize staying_period}} and operating the business for the last {{pluralize business_period}}.

PROPERTY DETAILS:
${RCO_PLATES_FULL}

VERIFICATION EVIDENCE:
Applicant is staying on the {{ordinal applicant_staying_floor}} floor. The business is operated as {{business_status}} {{businessLocation business_location_value business_operating_address}}.

LOCALITY INFORMATION:
${RCO_LOCALITY}

AREA ASSESSMENT:
${RCO_AREA}

${RCO_CONCLUSION}{{/eq}}{{#eq outcome "Shifted & Door Open"}}Residence-cum-Office Remark: SHIFTED & DOOR OPEN.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the residence-cum-office was {{lc house_status}}. Met with {{met_person_name}} ({{met_person_status}}), who confirmed that {{customer_name}} has shifted from the given address {{pluralize shifted_period}} ago.

PROPERTY DETAILS:
${RCO_PLATES_DOOR_SOC}

LOCALITY INFORMATION:
${RCO_LOCALITY} {{addressFloor applicant_staying_floor}}

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} that {{customer_name}} has shifted from the given address {{pluralize shifted_period}} ago. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.

AREA ASSESSMENT:
${RCO_AREA}

${RCO_CONCLUSION}{{/eq}}{{#eq outcome "Shifted & Door Locked"}}Residence-cum-Office Remark: SHIFTED & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the residence-cum-office was closed. A telephonic attempt was also made and {{callRemark call_remark}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} that {{customer_name}} has shifted from the given address {{pluralize shifted_period}} ago. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.

PROPERTY DETAILS:
${RCO_PLATES_DOOR_SOC}

LOCALITY INFORMATION:
${RCO_LOCALITY} {{addressFloor applicant_staying_floor}}

AREA ASSESSMENT:
${RCO_AREA}

${RCO_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Open"}}Residence-cum-Office Remark: NSP & DOOR OPEN (No Such Person).

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is {{address_traceable}} and rated as {{address_rating}}. At the time of visit, the residence-cum-office was {{lc house_status}}. Met with {{met_person_name}} ({{met_person_status}}).

RESIDENCE & OFFICE VERIFICATION:
The met person informed that no such person is staying or working at the given address. As per current residents and office staff, {{customer_name}} has never stayed or worked at this address.

LOCALITY INFORMATION:
${RCO_LOCALITY} {{addressFloor applicant_staying_floor}}

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}} and {{tpcLabel tpc_name_2 tpc_met_person_2}}, who confirmed that no such person is staying or working at the given address.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s residence and office presence is not confirmed by the field executive's observation or from TPC.

${RCO_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Locked"}}Residence-cum-Office Remark: NSP & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is {{address_traceable}} and rated as {{address_rating}}. At the time of visit, the residence-cum-office was closed. A telephonic attempt was also made and {{callRemark call_remark}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}} and {{tpcLabel tpc_name_2 tpc_met_person_2}}, who confirmed that the residence and office exist at the given address but no such person ({{customer_name}}) is staying or working there. The current occupant at the given address is {{staying_person_name}}.

LOCALITY INFORMATION:
${RCO_LOCALITY} {{addressFloor applicant_staying_floor}}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s residence and office presence is not confirmed by the field executive's observation or from TPC.

${RCO_CONCLUSION}{{/eq}}{{#eq outcome "ERT"}}Residence-cum-Office Remark: ENTRY RESTRICTED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, met with {{met_person_name}} ({{met_person_type}}), who informed that entry to the given premises is not allowed. A telephonic attempt was also made and {{callRemark call_remark}}.

ENTRY RESTRICTION DETAILS:
{{met_person_name}} {{metPersonConfirmation met_person_confirmation}} the residence and office existence at the given address{{existsClause business_exists_status}}.{{sentenceClause (stayingStatus applicant_staying_status) " The met person also informed that " "."}}{{sentenceClause (workingStatus applicant_working_status) " The met person also informed that " "."}} Entry is restricted due to security protocols or building policies.

LOCALITY INFORMATION:
The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}}.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}.{{sentenceClause (capFirst feedback_from_neighbour) " " " feedback was received from the met person."}}{{sentenceClause political_connection " " "."}}

${RCO_CONCLUSION}{{/eq}}{{#eq outcome "Untraceable"}}Residence-cum-Office Remark: UNTRACEABLE.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is incorrect and untraceable.

CONTACT ATTEMPT:
We called {{customer_name}}, but {{callRemark call_remark}}. At the given location, inquired with {{contact_person}}, who could not provide guidance to the address.

SEARCH EFFORTS:
The locality type is {{locality}}. Field executive surveyed the following landmarks during the search: {{landmark_1}}, {{landmark_2}}, {{landmark_3}}, {{landmark_4}}. {{dominatedArea dominated_area}}.

${RCO_CONCLUSION}{{/eq}}`;

// ── PROPERTY_INDIVIDUAL ── (v1 PROPERTY_INDIVIDUAL_TEMPLATES, 6 outcomes — NO Shifted)
const PI_COLUMNS: ReportLayoutColumnInput[] = [
  OUT('property-individual'),
  TASK('customer_address', 'Customer Address', 'address'),
  APP('customer_name', 'Customer Name', 'name'),
  APP('applicant_type', 'Applicant Type', 'applicant_type'),
  FD('property-individual', 'address_rating', 'Address Rating', 'addressRating'),
  FD('property-individual', 'building_status', 'Building Status', 'buildingStatus'),
  FD('property-individual', 'met_person_name', 'Met Person Name', 'metPersonName'),
  FD('property-individual', 'met_person_relation', 'Met Person Relation', 'relationship'),
  FD('property-individual', 'met_person_type', 'Met Person Type', 'metPersonType'),
  FD('property-individual', 'met_person_confirmation', 'Met Person Confirmation', 'metPersonConfirmation'),
  FD('property-individual', 'name_of_met_person', 'Name of Met Person (ERT)', 'metPersonName'),
  FD('property-individual', 'property_owner_name', 'Property Owner Name', 'propertyOwnerName'),
  FD('property-individual', 'approx_area', 'Approx Area', 'approxArea'),
  FD('property-individual', 'door_nameplate_status', 'Door Nameplate Status', 'doorNamePlateStatus'),
  FD('property-individual', 'name_on_door_plate', 'Name on Door Plate', 'nameOnDoorPlate'),
  FD('property-individual', 'society_nameplate_status', 'Society Board Status', 'societyNamePlateStatus'),
  FD('property-individual', 'name_on_society_board', 'Name on Society Board', 'nameOnSocietyBoard'),
  FD('property-individual', 'locality', 'Locality', 'locality'),
  FD('property-individual', 'address_structure', 'Address Structure (G+)', 'addressStructure'),
  FD('property-individual', 'address_structure_color', 'Structure Color', 'addressStructureColor'),
  FD('property-individual', 'door_color', 'Door Color', 'doorColor'),
  FD('property-individual', 'address_floor', 'Address Floor', 'addressFloor'),
  FD('property-individual', 'call_remark', 'Call Remark', 'callRemark'),
  FD('property-individual', 'contact_person', 'Contact Person', 'contactPerson'),
  FD('property-individual', 'tpc_name_1', 'TPC 1 Name', 'tpcName1'),
  FD('property-individual', 'tpc_met_person_1', 'TPC 1 Relation', 'tpcMetPerson1'),
  FD('property-individual', 'tpc_confirmation_1', 'TPC 1 Confirmation', 'tpcConfirmation1'),
  FD('property-individual', 'tpc_name_2', 'TPC 2 Name', 'tpcName2'),
  FD('property-individual', 'tpc_met_person_2', 'TPC 2 Relation', 'tpcMetPerson2'),
  FD('property-individual', 'tpc_confirmation_2', 'TPC 2 Confirmation', 'tpcConfirmation2'),
  FD('property-individual', 'landmark_1', 'Landmark 1', 'landmark1'),
  FD('property-individual', 'landmark_2', 'Landmark 2', 'landmark2'),
  FD('property-individual', 'landmark_3', 'Landmark 3', 'landmark3'),
  FD('property-individual', 'landmark_4', 'Landmark 4', 'landmark4'),
  FD('property-individual', 'dominated_area', 'Dominated Area', 'dominatedArea'),
  FD('property-individual', 'feedback_from_neighbour', 'Neighbour Feedback', 'feedbackFromNeighbour'),
  FD('property-individual', 'political_connection', 'Political Connection', 'politicalConnection'),
  FD('property-individual', 'other_observation', 'Field Observation', 'otherObservation'),
  FD('property-individual', 'final_status', 'Final Status', 'finalStatus'),
];

const PI_PLATES = `Door nameplate {{nameplate door_nameplate_status name_on_door_plate}}. Society board {{nameplate society_nameplate_status name_on_society_board "displays"}}.`;
const PI_LOCALITY = `The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}} and door color is {{door_color}}. {{addressFloor address_floor}}`;
const PI_AREA = `Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{capFirst feedback_from_neighbour}} feedback was received from neighbours. {{politicalConnection political_connection}}.`;
const PI_CONCLUSION = `CONCLUSION:\nField Executive Observation: {{other_observation}}\nHence the profile is marked as {{default final_status outcome}}.`;

const PI_BODY = `{{#eq outcome "Positive & Door Open"}}Property Individual Remark: POSITIVE & DOOR OPEN.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. The building status is {{lc building_status}}. At the time of visit, the flat was open. Met with {{met_person_name}} ({{met_person_relation}}), who confirmed {{customer_name}}'s property ownership at the given address.

PROPERTY DETAILS:
Property owner: {{property_owner_name}}. Approximate area is {{area approx_area}}. ${PI_PLATES}

LOCALITY INFORMATION:
${PI_LOCALITY}

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} {{customer_name}}'s property ownership. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.

AREA ASSESSMENT:
${PI_AREA} {{customer_name}}'s property ownership is confirmed by the field executive's observation as well as from TPC.

${PI_CONCLUSION}{{/eq}}{{#eq outcome "Positive & Door Locked"}}Property Individual Remark: POSITIVE & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. The building status is {{lc building_status}}. At the time of visit, the flat was closed. A telephonic attempt was also made and {{callRemark call_remark}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} {{customer_name}}'s property ownership. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.

PROPERTY DETAILS:
${PI_PLATES}

LOCALITY INFORMATION:
${PI_LOCALITY}

AREA ASSESSMENT:
${PI_AREA}

${PI_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Open"}}Property Individual Remark: NSP & DOOR OPEN (No Such Person).

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. The building status is {{lc building_status}}. At the time of visit, the flat was open. Met with {{met_person_name}} ({{met_person_relation}}), who informed that there is no such person ({{customer_name}}) owning property at the given address.

PROPERTY DETAILS:
As per the met person, the current property owner is {{property_owner_name}}. ${PI_PLATES}

LOCALITY INFORMATION:
${PI_LOCALITY}

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} that {{customer_name}} has never owned property at this address. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s property ownership is not confirmed by the field executive's observation or from TPC.

${PI_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Locked"}}Property Individual Remark: NSP & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. The building status is {{lc building_status}}. At the time of visit, the flat was closed. A telephonic attempt was also made and {{callRemark call_remark}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} that {{customer_name}} has never owned property at this address. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.

PROPERTY DETAILS:
${PI_PLATES}

LOCALITY INFORMATION:
${PI_LOCALITY}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s property ownership is not confirmed by the field executive's observation or from TPC.

${PI_CONCLUSION}{{/eq}}{{#eq outcome "ERT"}}Property Individual Remark: ENTRY RESTRICTED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, met with {{name_of_met_person}} ({{met_person_type}}), who informed that entry to the given premises is not allowed. A telephonic attempt was also made and {{callRemark call_remark}}.

ENTRY RESTRICTION DETAILS:
{{name_of_met_person}} {{metPersonConfirmation met_person_confirmation}} the property existence at the given address. The property owner is {{property_owner_name}}. Society board {{nameplate society_nameplate_status name_on_society_board "displays"}}.

LOCALITY INFORMATION:
The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}}. The building status is {{lc building_status}}.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}.{{sentenceClause (capFirst feedback_from_neighbour) " " " feedback was received from the met person."}}{{sentenceClause political_connection " " "."}}

${PI_CONCLUSION}{{/eq}}{{#eq outcome "Untraceable"}}Property Individual Remark: UNTRACEABLE.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is incorrect and untraceable.

CONTACT ATTEMPT:
We called {{customer_name}}, but {{callRemark call_remark}}. At the given location, inquired with {{contact_person}}, who could not provide guidance to the address.

SEARCH EFFORTS:
The locality type is {{locality}}. Field executive surveyed the following landmarks during the search: {{landmark_1}}, {{landmark_2}}, {{landmark_3}}, {{landmark_4}}. {{dominatedArea dominated_area}}.

${PI_CONCLUSION}{{/eq}}`;

// ── PROPERTY_APF ── (v1 PROPERTY_APF_TEMPLATES, 4 outcomes: Positive/Negative/ERT/Untraceable;
// the v1 NEGATIVE STOP/VACANT split [constructionActivity.includes('VACANT')] is reproduced
// in-branch via {{#if (apfVacant construction_activity)}}).
const APF_COLUMNS: ReportLayoutColumnInput[] = [
  OUT('property-apf'),
  TASK('customer_address', 'Customer Address', 'address'),
  APP('customer_name', 'Customer Name', 'name'),
  APP('applicant_type', 'Applicant Type', 'applicant_type'),
  FD('property-apf', 'address_rating', 'Address Rating', 'addressRating'),
  FD('property-apf', 'construction_activity', 'Construction Activity', 'constructionActivity'),
  FD('property-apf', 'activity_stop_reason', 'Activity Stop Reason', 'activityStopReason'),
  FD('property-apf', 'building_status', 'Building Status', 'buildingStatus'),
  FD('property-apf', 'project_name', 'Project Name', 'projectName'),
  FD('property-apf', 'project_started_date', 'Project Started Date', 'projectStartedDate'),
  FD('property-apf', 'project_completion_date', 'Project Completion Date', 'projectCompletionDate'),
  FD('property-apf', 'total_wing', 'Total Wings', 'totalWing'),
  FD('property-apf', 'total_flats', 'Total Flats', 'totalFlats'),
  FD('property-apf', 'project_completion_percent', 'Project Completion %', 'projectCompletionPercent'),
  FD('property-apf', 'staff_strength', 'Staff Strength', 'staffStrength'),
  FD('property-apf', 'staff_seen', 'Staff Seen', 'staffSeen'),
  FD('property-apf', 'met_person_name', 'Met Person Name', 'metPersonName'),
  FD('property-apf', 'met_person_designation', 'Met Person Designation', 'metPersonDesignation'),
  FD('property-apf', 'name_of_met_person', 'Name of Met Person (ERT)', 'metPersonName'),
  FD('property-apf', 'met_person_type', 'Met Person Type (ERT)', 'metPersonType'),
  FD('property-apf', 'met_person_confirmation', 'Met Person Confirmation (ERT)', 'metPersonConfirmation'),
  FD('property-apf', 'company_name_plate_status', 'Company Board Status', 'companyNamePlateStatus'),
  FD('property-apf', 'name_on_board', 'Name on Board', 'nameOnBoard'),
  FD('property-apf', 'call_remark', 'Call Remark', 'callRemark'),
  FD('property-apf', 'contact_person', 'Contact Person', 'contactPerson'),
  FD('property-apf', 'tpc_name_1', 'TPC 1 Name', 'tpcName1'),
  FD('property-apf', 'tpc_met_person_1', 'TPC 1 Relation', 'tpcMetPerson1'),
  FD('property-apf', 'tpc_name_2', 'TPC 2 Name', 'tpcName2'),
  FD('property-apf', 'tpc_met_person_2', 'TPC 2 Relation', 'tpcMetPerson2'),
  FD('property-apf', 'locality', 'Locality', 'locality'),
  FD('property-apf', 'landmark_1', 'Landmark 1', 'landmark1'),
  FD('property-apf', 'landmark_2', 'Landmark 2', 'landmark2'),
  FD('property-apf', 'landmark_3', 'Landmark 3', 'landmark3'),
  FD('property-apf', 'landmark_4', 'Landmark 4', 'landmark4'),
  FD('property-apf', 'dominated_area', 'Dominated Area', 'dominatedArea'),
  FD('property-apf', 'feedback_from_neighbour', 'Neighbour Feedback', 'feedbackFromNeighbour'),
  FD('property-apf', 'political_connection', 'Political Connection', 'politicalConnection'),
  FD('property-apf', 'other_observation', 'Field Observation', 'otherObservation'),
  FD('property-apf', 'final_status', 'Final Status', 'finalStatus'),
];

const APF_NAMEPLATE = `Company nameplate {{nameplate company_name_plate_status name_on_board "displays"}}.`;
const APF_AREA = `Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{capFirst feedback_from_neighbour}} feedback was received from neighbours. {{politicalConnection political_connection}}.`;
const APF_CONCLUSION = `CONCLUSION:\nField Executive Observation: {{other_observation}}\nHence the profile is marked as {{default final_status outcome}}.`;

const APF_BODY = `{{#eq outcome "Positive"}}Property APF Remark: POSITIVE.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. Construction activity: {{construction_activity}}. {{activityVerdict construction_activity final_status met_person_name met_person_designation other_observation}}

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcPair tpc_met_person_1 tpc_name_1 tpc_met_person_2 tpc_name_2}}, who confirmed the project existence at the given address.

LOCALITY INFORMATION:
The locality is {{locality}}. ${APF_NAMEPLATE}

AREA ASSESSMENT:
${APF_AREA}

${APF_CONCLUSION}{{/eq}}{{#eq outcome "Negative"}}Property APF Remark: NEGATIVE.

VERIFICATION DETAILS:
{{#if (apfVacant construction_activity)}}Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. Construction activity: {{construction_activity}}. The plot at the given address is currently vacant — no construction or project activity was observed.{{verdictOverride construction_activity final_status other_observation}}

LOCALITY INFORMATION:
The locality is {{locality}}.{{else}}Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. Construction activity: {{construction_activity}}. Reason for stop: {{activity_stop_reason}}.{{verdictOverride construction_activity final_status other_observation}}

PROJECT DETAILS:
Project name: {{project_name}}. Building status: {{lc building_status}}. Project started on {{date project_started_date}}, expected completion on {{date project_completion_date}}. Total wings: {{total_wing}}. Total flats: {{total_flats}}. Project completion: {{project_completion_percent}}%. Staff strength is {{staff_strength}} and {{staff_seen}} were seen during the visit.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcPair tpc_met_person_1 tpc_name_1 tpc_met_person_2 tpc_name_2}}.

LOCALITY INFORMATION:
The locality is {{locality}}. ${APF_NAMEPLATE}{{/if}}

AREA ASSESSMENT:
${APF_AREA}

${APF_CONCLUSION}{{/eq}}{{#eq outcome "ERT"}}Property APF Remark: ENTRY RESTRICTED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. Building status: {{lc building_status}}. At the time of visit, met with {{name_of_met_person}} ({{met_person_type}}), who informed that entry to the given premises is not allowed. A telephonic attempt was also made and {{callRemark call_remark}}.

ENTRY RESTRICTION DETAILS:
{{name_of_met_person}} {{metPersonConfirmation met_person_confirmation}} the property existence at the given address.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcPair tpc_met_person_1 tpc_name_1 tpc_met_person_2 tpc_name_2}}.

LOCALITY INFORMATION:
The locality is {{locality}}. ${APF_NAMEPLATE}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}.{{sentenceClause (capFirst feedback_from_neighbour) " " " feedback was received from the met person."}}{{sentenceClause political_connection " " "."}}

${APF_CONCLUSION}{{/eq}}{{#eq outcome "Untraceable"}}Property APF Remark: UNTRACEABLE.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is incorrect and untraceable.

CONTACT ATTEMPT:
We called {{customer_name}}, but {{callRemark call_remark}}. At the given location, inquired with {{contact_person}}, who could not provide guidance to the address.

SEARCH EFFORTS:
The locality type is {{locality}}. Field executive surveyed the following landmarks during the search: {{landmark_1}}, {{landmark_2}}, {{landmark_3}}, {{landmark_4}}. {{dominatedArea dominated_area}}.

${APF_CONCLUSION}{{/eq}}`;

// ── BUILDER ── (v1 BUILDER_TEMPLATES, 8 outcomes; office+business spine)
const BUILDER_COLUMNS: ReportLayoutColumnInput[] = [
  OUT('builder'),
  TASK('customer_address', 'Customer Address', 'address'),
  APP('customer_name', 'Customer Name', 'name'),
  APP('applicant_type', 'Applicant Type', 'applicant_type'),
  FD('builder', 'address_rating', 'Address Rating', 'addressRating'),
  FD('builder', 'office_status', 'Office Status', 'officeStatus'),
  FD('builder', 'met_person_name', 'Met Person Name', 'metPersonName'),
  FD('builder', 'designation', 'Met Person Designation', 'metPersonDesignation'),
  FD('builder', 'business_period', 'Business Period', 'businessPeriod'),
  FD('builder', 'builder_type', 'Builder Type', 'businessType'),
  FD('builder', 'ownership_type', 'Ownership Type', 'ownershipType'),
  FD('builder', 'company_nature_of_business', 'Nature of Business', 'companyNatureOfBusiness'),
  FD('builder', 'office_approx_area', 'Office Approx Area', 'officeApproxArea'),
  FD('builder', 'address_status', 'Premises Held Status', 'addressStatus'),
  FD('builder', 'builder_name', 'Builder Name', 'nameOfCompanyOwners'),
  FD('builder', 'staff_strength', 'Staff Strength', 'staffStrength'),
  FD('builder', 'staff_seen', 'Staff Seen', 'staffSeen'),
  FD('builder', 'company_name_plate_status', 'Company Nameplate Status', 'companyNamePlateStatus'),
  FD('builder', 'name_on_board', 'Name on Board', 'nameOnBoard'),
  FD('builder', 'document_shown', 'Document Shown', 'documentShown'),
  FD('builder', 'locality', 'Locality', 'locality'),
  FD('builder', 'address_structure', 'Address Structure (G+)', 'addressStructure'),
  FD('builder', 'address_structure_color', 'Structure Color', 'addressStructureColor'),
  FD('builder', 'door_color', 'Door Color', 'doorColor'),
  FD('builder', 'address_floor', 'Address Floor', 'addressFloor'),
  FD('builder', 'call_remark', 'Call Remark', 'callRemark'),
  FD('builder', 'call_confirmation', 'Call Confirmation', 'callConfirmation'),
  FD('builder', 'old_office_shifted_period', 'Old Office Shifted Period', 'oldOfficeShiftedPeriod'),
  FD('builder', 'premises_status', 'Premises Status', 'premisesStatus'),
  FD('builder', 'current_company_name', 'Current Company Name', 'currentCompanyName'),
  FD('builder', 'current_company_period', 'Current Company Period', 'currentCompanyPeriod'),
  FD('builder', 'name_of_met_person', 'Name of Met Person (ERT)', 'metPersonName'),
  FD('builder', 'met_person_type', 'Met Person Type (ERT)', 'metPersonType'),
  FD('builder', 'met_person_confirmation', 'Met Person Confirmation (ERT)', 'metPersonConfirmation'),
  FD('builder', 'business_exists_status', 'Business Exists Status (ERT)', 'businessExistsStatus'),
  FD('builder', 'applicant_working_status', 'Applicant Working Status (ERT)', 'applicantWorkingStatus'),
  FD('builder', 'contact_person', 'Contact Person', 'contactPerson'),
  FD('builder', 'tpc_name_1', 'TPC 1 Name', 'tpcName1'),
  FD('builder', 'tpc_met_person_1', 'TPC 1 Relation', 'tpcMetPerson1'),
  FD('builder', 'tpc_confirmation_1', 'TPC 1 Confirmation', 'tpcConfirmation1'),
  FD('builder', 'tpc_name_2', 'TPC 2 Name', 'tpcName2'),
  FD('builder', 'tpc_met_person_2', 'TPC 2 Relation', 'tpcMetPerson2'),
  FD('builder', 'tpc_confirmation_2', 'TPC 2 Confirmation', 'tpcConfirmation2'),
  FD('builder', 'landmark_1', 'Landmark 1', 'landmark1'),
  FD('builder', 'landmark_2', 'Landmark 2', 'landmark2'),
  FD('builder', 'landmark_3', 'Landmark 3', 'landmark3'),
  FD('builder', 'landmark_4', 'Landmark 4', 'landmark4'),
  FD('builder', 'dominated_area', 'Dominated Area', 'dominatedArea'),
  FD('builder', 'feedback_from_neighbour', 'Neighbour Feedback', 'feedbackFromNeighbour'),
  FD('builder', 'political_connection', 'Political Connection', 'politicalConnection'),
  FD('builder', 'other_observation', 'Field Observation', 'otherObservation'),
  FD('builder', 'final_status', 'Final Status', 'finalStatus'),
];

const BLD_TPC = `TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} {{customer_name}}'s builder office existence. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.`;
const BLD_TPC_SHIFTED = `TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} that the builder office has shifted from the given address {{pluralize old_office_shifted_period}} ago. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.`;
const BLD_LOCALITY = `The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}} and door color is {{door_color}}. {{addressFloor address_floor}}`;
const BLD_NAMEPLATE = `Company nameplate {{nameplate company_name_plate_status name_on_board "displays"}}.`;
const BLD_AREA = `Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{capFirst feedback_from_neighbour}} feedback was received from neighbours. {{politicalConnection political_connection}}.`;
const BLD_CONCLUSION = `CONCLUSION:\nField Executive Observation: {{other_observation}}\nHence the profile is marked as {{default final_status outcome}}.`;

const BUILDER_BODY = `{{#eq outcome "Positive & Door Open"}}Builder Remark: POSITIVE & DOOR OPEN.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the builder office was {{lc office_status}}. Met with {{met_person_name}} ({{designation}}), who confirmed that {{customer_name}} has been running the builder firm at the given address for the last {{pluralize business_period}}.

BUILDER & OFFICE DETAILS:
Builder type is {{builder_type}} ({{ownershipType ownership_type}}) and the nature of business is {{company_nature_of_business}}. Office area is approximately {{area office_approx_area}}. The office premises are held {{lc address_status}}. Builder name: {{builder_name}}. Total staff strength is {{staff_strength}} and {{staff_seen}} were seen. ${BLD_NAMEPLATE} {{documentShownSentence document_shown ""}}

LOCALITY INFORMATION:
${BLD_LOCALITY}

THIRD PARTY CONFIRMATION:
${BLD_TPC}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{capFirst feedback_from_neighbour}} feedback was received regarding {{customer_name}} and the builder firm. {{politicalConnection political_connection}}. {{customer_name}}'s builder office stability is confirmed by the field executive's observation as well as from TPC.

${BLD_CONCLUSION}{{/eq}}{{#eq outcome "Positive & Door Locked"}}Builder Remark: POSITIVE & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the builder office was {{lc office_status}}. A telephonic attempt was also made and {{callRemark call_remark call_confirmation}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} {{customer_name}}'s builder office existence. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same. They informed that the builder has been operating at the given address for the last {{pluralize business_period}}.

BUILDER & OFFICE DETAILS:
The nature of business is {{company_nature_of_business}}. ${BLD_NAMEPLATE}

LOCALITY INFORMATION:
${BLD_LOCALITY}

AREA ASSESSMENT:
${BLD_AREA}

${BLD_CONCLUSION}{{/eq}}{{#eq outcome "Shifted & Door Open"}}Builder Remark: SHIFTED & DOOR OPEN.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the builder office was {{lc office_status}}. Met with {{met_person_name}} ({{designation}}), who confirmed that the builder office has shifted from the given address {{pluralize old_office_shifted_period}} ago.

CURRENT OFFICE STATUS:
At present, the given premises is {{lc premises_status}}. {{currentCompanyOperating current_company_name (pluralize current_company_period)}}${BLD_NAMEPLATE}

LOCALITY INFORMATION:
${BLD_LOCALITY}

THIRD PARTY CONFIRMATION:
${BLD_TPC_SHIFTED}

AREA ASSESSMENT:
${BLD_AREA}

${BLD_CONCLUSION}{{/eq}}{{#eq outcome "Shifted & Door Locked"}}Builder Remark: SHIFTED & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the builder office was closed. A telephonic attempt was also made and {{callRemark call_remark call_confirmation}}.

THIRD PARTY CONFIRMATION:
${BLD_TPC_SHIFTED}

CURRENT OFFICE STATUS:
{{currentCompanyOperating current_company_name (pluralize current_company_period)}}${BLD_NAMEPLATE}

LOCALITY INFORMATION:
${BLD_LOCALITY}

AREA ASSESSMENT:
${BLD_AREA}

${BLD_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Open"}}Builder Remark: NSP & DOOR OPEN (No Such Person).

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the builder office was {{lc office_status}}. Met with {{met_person_name}} ({{designation}}).

BUILDER VERIFICATION:
The met person informed that no such person is working as a builder at the given address. As per the current office staff, {{customer_name}} has never worked as a builder at this office.

CURRENT OFFICE DETAILS:
At present, the given premises is {{lc premises_status}}. ${BLD_NAMEPLATE}

LOCALITY INFORMATION:
${BLD_LOCALITY}

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}} and {{tpcLabel tpc_name_2 tpc_met_person_2}}, who confirmed that no such person is working as a builder at the given address.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s builder presence is not confirmed by the field executive's observation or from TPC.

${BLD_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Locked"}}Builder Remark: NSP & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the builder office was closed. A telephonic attempt was also made and {{callRemark call_remark call_confirmation}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}} and {{tpcLabel tpc_name_2 tpc_met_person_2}}, who confirmed that the builder office exists at the given address but no such person ({{customer_name}}) is working there as a builder.

CURRENT OFFICE STATUS:
{{currentCompanyOperating current_company_name (pluralize current_company_period)}}${BLD_NAMEPLATE}

LOCALITY INFORMATION:
${BLD_LOCALITY}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s builder presence is not confirmed by the field executive's observation or from TPC.

${BLD_CONCLUSION}{{/eq}}{{#eq outcome "ERT"}}Builder Remark: ENTRY RESTRICTED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, met with {{name_of_met_person}} ({{met_person_type}}), who informed that entry to the given premises is not allowed. A telephonic attempt was also made and {{callRemark call_remark call_confirmation}}.

ENTRY RESTRICTION DETAILS:
{{name_of_met_person}} {{metPersonConfirmation met_person_confirmation}} the builder office existence at the given address{{existsClause business_exists_status}}.{{sentenceClause (workingStatus applicant_working_status) " The met person also informed that " "."}} Entry is restricted due to security protocols or office policies.

LOCALITY INFORMATION:
The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}}.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}.{{sentenceClause (capFirst feedback_from_neighbour) " " " feedback was received from the met person."}}{{sentenceClause political_connection " " "."}}

${BLD_CONCLUSION}{{/eq}}{{#eq outcome "Untraceable"}}Builder Remark: UNTRACEABLE.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is incorrect and untraceable.

CONTACT ATTEMPT:
We called {{customer_name}}, but {{callRemark call_remark call_confirmation}}. At the given location, inquired with {{contact_person}}, who could not provide guidance to the address.

SEARCH EFFORTS:
The locality type is {{locality}}. Field executive surveyed the following landmarks during the search: {{landmark_1}}, {{landmark_2}}, {{landmark_3}}, {{landmark_4}}. {{dominatedArea dominated_area}}.

${BLD_CONCLUSION}{{/eq}}`;

// ── DSA_CONNECTOR ── (v1 DSA_CONNECTOR_TEMPLATES, 8 outcomes; business spine + active clients)
const DSA_COLUMNS: ReportLayoutColumnInput[] = [
  OUT('dsa-connector'),
  TASK('customer_address', 'Customer Address', 'address'),
  APP('customer_name', 'Customer Name', 'name'),
  APP('applicant_type', 'Applicant Type', 'applicant_type'),
  FD('dsa-connector', 'address_rating', 'Address Rating', 'addressRating'),
  FD('dsa-connector', 'office_status', 'Office Status', 'officeStatus'),
  FD('dsa-connector', 'met_person_name', 'Met Person Name', 'metPersonName'),
  FD('dsa-connector', 'designation', 'Met Person Designation', 'metPersonDesignation'),
  FD('dsa-connector', 'business_period', 'Business Period', 'businessPeriod'),
  FD('dsa-connector', 'business_type', 'Business Type', 'businessType'),
  FD('dsa-connector', 'ownership_type', 'Ownership Type', 'ownershipType'),
  FD('dsa-connector', 'company_nature_of_business', 'Nature of Business', 'companyNatureOfBusiness'),
  FD('dsa-connector', 'business_owner_name', 'Company Owners', 'nameOfCompanyOwners'),
  FD('dsa-connector', 'address_status', 'Premises Held Status', 'addressStatus'),
  FD('dsa-connector', 'office_approx_area', 'Office Approx Area', 'officeApproxArea'),
  FD('dsa-connector', 'staff_strength', 'Staff Strength', 'staffStrength'),
  FD('dsa-connector', 'staff_seen', 'Staff Seen', 'staffSeen'),
  FD('dsa-connector', 'active_client', 'Active Clients', 'activeClient'),
  FD('dsa-connector', 'company_name_plate_status', 'Company Nameplate Status', 'companyNamePlateStatus'),
  FD('dsa-connector', 'name_on_board', 'Name on Board', 'nameOnBoard'),
  FD('dsa-connector', 'locality', 'Locality', 'locality'),
  FD('dsa-connector', 'address_structure', 'Address Structure (G+)', 'addressStructure'),
  FD('dsa-connector', 'address_structure_color', 'Structure Color', 'addressStructureColor'),
  FD('dsa-connector', 'door_color', 'Door Color', 'doorColor'),
  FD('dsa-connector', 'address_floor', 'Address Floor', 'addressFloor'),
  FD('dsa-connector', 'call_remark', 'Call Remark', 'callRemark'),
  FD('dsa-connector', 'old_office_shifted_period', 'Old Office Shifted Period', 'oldOfficeShiftedPeriod'),
  FD('dsa-connector', 'premises_status', 'Premises Status', 'premisesStatus'),
  FD('dsa-connector', 'current_company_name', 'Current Company Name', 'currentCompanyName'),
  FD('dsa-connector', 'current_company_period', 'Current Company Period', 'currentCompanyPeriod'),
  FD('dsa-connector', 'name_of_met_person', 'Name of Met Person (ERT)', 'metPersonName'),
  FD('dsa-connector', 'met_person_type', 'Met Person Type (ERT)', 'metPersonType'),
  FD('dsa-connector', 'met_person_confirmation', 'Met Person Confirmation (ERT)', 'metPersonConfirmation'),
  FD('dsa-connector', 'business_exists_status', 'Business Exists Status (ERT)', 'businessExistsStatus'),
  FD('dsa-connector', 'contact_person', 'Contact Person', 'contactPerson'),
  FD('dsa-connector', 'tpc_name_1', 'TPC 1 Name', 'tpcName1'),
  FD('dsa-connector', 'tpc_met_person_1', 'TPC 1 Relation', 'tpcMetPerson1'),
  FD('dsa-connector', 'tpc_confirmation_1', 'TPC 1 Confirmation', 'tpcConfirmation1'),
  FD('dsa-connector', 'tpc_name_2', 'TPC 2 Name', 'tpcName2'),
  FD('dsa-connector', 'tpc_met_person_2', 'TPC 2 Relation', 'tpcMetPerson2'),
  FD('dsa-connector', 'tpc_confirmation_2', 'TPC 2 Confirmation', 'tpcConfirmation2'),
  FD('dsa-connector', 'landmark_1', 'Landmark 1', 'landmark1'),
  FD('dsa-connector', 'landmark_2', 'Landmark 2', 'landmark2'),
  FD('dsa-connector', 'landmark_3', 'Landmark 3', 'landmark3'),
  FD('dsa-connector', 'landmark_4', 'Landmark 4', 'landmark4'),
  FD('dsa-connector', 'dominated_area', 'Dominated Area', 'dominatedArea'),
  FD('dsa-connector', 'feedback_from_neighbour', 'Neighbour Feedback', 'feedbackFromNeighbour'),
  FD('dsa-connector', 'political_connection', 'Political Connection', 'politicalConnection'),
  FD('dsa-connector', 'other_observation', 'Field Observation', 'otherObservation'),
  FD('dsa-connector', 'final_status', 'Final Status', 'finalStatus'),
];

const DSA_TPC = `TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} {{customer_name}}'s DSA/Connector office existence. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.`;
const DSA_TPC_SHIFTED = `TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} that the DSA/Connector office has shifted from the given address {{pluralize old_office_shifted_period}} ago. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.`;
const DSA_LOCALITY = `The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}} and door color is {{door_color}}. {{addressFloor address_floor}}`;
const DSA_NAMEPLATE = `Company nameplate {{nameplate company_name_plate_status name_on_board "displays"}}.`;
const DSA_AREA = `Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{capFirst feedback_from_neighbour}} feedback was received from neighbours. {{politicalConnection political_connection}}.`;
const DSA_CONCLUSION = `CONCLUSION:\nField Executive Observation: {{other_observation}}\nHence the profile is marked as {{default final_status outcome}}.`;

const DSA_BODY = `{{#eq outcome "Positive & Door Open"}}DSA/Connector Remark: POSITIVE & DOOR OPEN.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the office was {{lc office_status}}. Met with {{met_person_name}} ({{designation}}), who confirmed that {{customer_name}} has been operating at the given address for the last {{pluralize business_period}}.

BUSINESS DETAILS:
Business type is {{business_type}} ({{ownershipType ownership_type}}) and the nature of business is {{company_nature_of_business}}. Company owners: {{business_owner_name}}. The premises are held {{lc address_status}}. Office area is approximately {{area office_approx_area}}. Total staff strength is {{staff_strength}} and {{staff_seen}} were seen during the visit. Active clients: {{active_client}}. ${DSA_NAMEPLATE}

THIRD PARTY CONFIRMATION:
${DSA_TPC}

LOCALITY INFORMATION:
${DSA_LOCALITY}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{capFirst feedback_from_neighbour}} feedback was received from neighbours. {{politicalConnection political_connection}}. {{customer_name}}'s DSA/Connector office stability is confirmed by the field executive's observation as well as from TPC.

${DSA_CONCLUSION}{{/eq}}{{#eq outcome "Positive & Door Locked"}}DSA/Connector Remark: POSITIVE & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the office was closed. A telephonic attempt was also made and {{callRemark call_remark}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} {{customer_name}}'s DSA/Connector office existence. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same. They informed that the office has been operating at the given address for the last {{pluralize business_period}}.

BUSINESS DETAILS:
The nature of business is {{company_nature_of_business}}. ${DSA_NAMEPLATE}

LOCALITY INFORMATION:
${DSA_LOCALITY}

AREA ASSESSMENT:
${DSA_AREA}

${DSA_CONCLUSION}{{/eq}}{{#eq outcome "Shifted & Door Open"}}DSA/Connector Remark: SHIFTED & DOOR OPEN.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the office was {{lc office_status}}. Met with {{met_person_name}} ({{designation}}), who informed that {{customer_name}}'s DSA/Connector office has shifted from the given address {{pluralize old_office_shifted_period}} ago.

CURRENT STATUS:
{{currentCompanyOperating current_company_name (pluralize current_company_period)}}The premises status is {{lc premises_status}}. ${DSA_NAMEPLATE}

LOCALITY INFORMATION:
${DSA_LOCALITY}

THIRD PARTY CONFIRMATION:
${DSA_TPC_SHIFTED}

AREA ASSESSMENT:
${DSA_AREA}

${DSA_CONCLUSION}{{/eq}}{{#eq outcome "Shifted & Door Locked"}}DSA/Connector Remark: SHIFTED & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the office was closed. A telephonic attempt was also made and {{callRemark call_remark}}.

THIRD PARTY CONFIRMATION:
${DSA_TPC_SHIFTED}

CURRENT STATUS:
{{currentCompanyOperating current_company_name (pluralize current_company_period)}}${DSA_NAMEPLATE}

LOCALITY INFORMATION:
${DSA_LOCALITY}

AREA ASSESSMENT:
${DSA_AREA}

${DSA_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Open"}}DSA/Connector Remark: NSP & DOOR OPEN (No Such Person).

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. Met with {{met_person_name}} ({{designation}}).

DSA/CONNECTOR VERIFICATION:
The met person informed that no such person is operating as a DSA/Connector at the given address. As per the current office staff, {{customer_name}} has never worked as a DSA/Connector at this location. At present, the given premises is {{lc premises_status}}. ${DSA_NAMEPLATE}

LOCALITY INFORMATION:
${DSA_LOCALITY}

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}} and {{tpcLabel tpc_name_2 tpc_met_person_2}}, who confirmed that no such person is operating as a DSA/Connector at the given address.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s DSA/Connector presence is not confirmed by the field executive's observation or from TPC.

${DSA_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Locked"}}DSA/Connector Remark: NSP & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the DSA/Connector office was closed. A telephonic attempt was also made and {{callRemark call_remark}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}} and {{tpcLabel tpc_name_2 tpc_met_person_2}}, who confirmed that the DSA/Connector office exists at the given address but no such person ({{customer_name}}) is operating there.

CURRENT OFFICE STATUS:
{{currentCompanyOperating current_company_name (pluralize current_company_period)}}${DSA_NAMEPLATE}

LOCALITY INFORMATION:
${DSA_LOCALITY}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s DSA/Connector presence is not confirmed by the field executive's observation or from TPC.

${DSA_CONCLUSION}{{/eq}}{{#eq outcome "ERT"}}DSA/Connector Remark: ENTRY RESTRICTED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, met with {{name_of_met_person}} ({{met_person_type}}), who informed that entry to the given premises is not allowed. A telephonic attempt was also made and {{callRemark call_remark}}.

ENTRY RESTRICTION DETAILS:
{{name_of_met_person}} {{metPersonConfirmation met_person_confirmation}} the DSA/Connector office existence at the given address{{existsClause business_exists_status}}. Entry is restricted due to security protocols or office policies.

LOCALITY INFORMATION:
The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}}.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}.{{sentenceClause (capFirst feedback_from_neighbour) " " " feedback was received from the met person."}}{{sentenceClause political_connection " " "."}}

${DSA_CONCLUSION}{{/eq}}{{#eq outcome "Untraceable"}}DSA/Connector Remark: UNTRACEABLE.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is incorrect and untraceable.

CONTACT ATTEMPT:
We called {{customer_name}}, but {{callRemark call_remark}}. At the given location, inquired with {{contact_person}}, who could not provide guidance to the address.

SEARCH EFFORTS:
The locality type is {{locality}}. Field executive surveyed the following landmarks during the search: {{landmark_1}}, {{landmark_2}}, {{landmark_3}}, {{landmark_4}}. {{dominatedArea dominated_area}}.

${DSA_CONCLUSION}{{/eq}}`;

// ── NOC ── (v1 NOC_TEMPLATES, 8 outcomes; NOC issuance + office spine)
const NOC_COLUMNS: ReportLayoutColumnInput[] = [
  OUT('noc'),
  TASK('customer_address', 'Customer Address', 'address'),
  APP('customer_name', 'Customer Name', 'name'),
  APP('applicant_type', 'Applicant Type', 'applicant_type'),
  FD('noc', 'address_rating', 'Address Rating', 'addressRating'),
  FD('noc', 'office_status', 'Office Status', 'officeStatus'),
  FD('noc', 'met_person_name', 'Met Person Name', 'metPersonName'),
  FD('noc', 'designation', 'Met Person Designation', 'metPersonDesignation'),
  FD('noc', 'name_on_noc', 'Name on NOC', 'nameOnNoc'),
  FD('noc', 'flat_no', 'Flat/Shop/Office No.', 'flatNo'),
  FD('noc', 'authorised_signature', 'Authorised Signatory', 'authorisedSignature'),
  FD('noc', 'locality', 'Locality', 'locality'),
  FD('noc', 'address_structure', 'Address Structure (G+)', 'addressStructure'),
  FD('noc', 'address_structure_color', 'Structure Color', 'addressStructureColor'),
  FD('noc', 'door_color', 'Door Color', 'doorColor'),
  FD('noc', 'address_floor', 'Address Floor', 'addressFloor'),
  FD('noc', 'call_remark', 'Call Remark', 'callRemark'),
  FD('noc', 'call_confirmation', 'Call Confirmation', 'callConfirmation'),
  FD('noc', 'old_office_shifted_period', 'Old Office Shifted Period', 'oldOfficeShiftedPeriod'),
  FD('noc', 'current_company_name', 'Current Company Name', 'currentCompanyName'),
  FD('noc', 'current_company_period', 'Current Company Period', 'currentCompanyPeriod'),
  FD('noc', 'company_name_plate_status', 'Company Nameplate Status', 'companyNamePlateStatus'),
  FD('noc', 'name_on_board', 'Name on Board', 'nameOnBoard'),
  FD('noc', 'premises_status', 'Premises Status', 'premisesStatus'),
  FD('noc', 'name_of_met_person', 'Name of Met Person (ERT)', 'metPersonName'),
  FD('noc', 'met_person_type', 'Met Person Type (ERT)', 'metPersonType'),
  FD('noc', 'met_person_confirmation', 'Met Person Confirmation (ERT)', 'metPersonConfirmation'),
  FD('noc', 'office_exists_status', 'Office Exists Status (ERT)', 'officeExistsStatus'),
  FD('noc', 'contact_person', 'Contact Person', 'contactPerson'),
  FD('noc', 'tpc_name_1', 'TPC 1 Name', 'tpcName1'),
  FD('noc', 'tpc_met_person_1', 'TPC 1 Relation', 'tpcMetPerson1'),
  FD('noc', 'tpc_confirmation_1', 'TPC 1 Confirmation', 'tpcConfirmation1'),
  FD('noc', 'tpc_name_2', 'TPC 2 Name', 'tpcName2'),
  FD('noc', 'tpc_met_person_2', 'TPC 2 Relation', 'tpcMetPerson2'),
  FD('noc', 'tpc_confirmation_2', 'TPC 2 Confirmation', 'tpcConfirmation2'),
  FD('noc', 'landmark_1', 'Landmark 1', 'landmark1'),
  FD('noc', 'landmark_2', 'Landmark 2', 'landmark2'),
  FD('noc', 'landmark_3', 'Landmark 3', 'landmark3'),
  FD('noc', 'landmark_4', 'Landmark 4', 'landmark4'),
  FD('noc', 'dominated_area', 'Dominated Area', 'dominatedArea'),
  FD('noc', 'feedback_from_neighbour', 'Neighbour Feedback', 'feedbackFromNeighbour'),
  FD('noc', 'political_connection', 'Political Connection', 'politicalConnection'),
  FD('noc', 'other_observation', 'Field Observation', 'otherObservation'),
  FD('noc', 'final_status', 'Final Status', 'finalStatus'),
];

const NOC_LOCALITY_NODOOR = `The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}}. {{addressFloor address_floor}}`;
const NOC_LOCALITY = `The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}} and door color is {{door_color}}. {{addressFloor address_floor}}`;
const NOC_NAMEPLATE = `Company nameplate {{nameplate company_name_plate_status name_on_board "displays"}}.`;
const NOC_AREA = `Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{capFirst feedback_from_neighbour}} feedback was received from neighbours. {{politicalConnection political_connection}}.`;
const NOC_CONCLUSION = `CONCLUSION:\nField Executive Observation: {{other_observation}}\nHence the profile is marked as {{default final_status outcome}}.`;

const NOC_BODY = `{{#eq outcome "Positive & Door Open"}}NOC Remark: POSITIVE & DOOR OPEN.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the NOC office was {{lc office_status}}. Met with {{met_person_name}} ({{designation}}), who confirmed that NOC has been issued in the name of {{name_on_noc}} for flat/shop/office no. {{flat_no}}. The authorised signatory is {{authorised_signature}}.

LOCALITY INFORMATION:
${NOC_LOCALITY_NODOOR}

AREA ASSESSMENT:
${NOC_AREA}

${NOC_CONCLUSION}{{/eq}}{{#eq outcome "Positive & Door Locked"}}NOC Remark: POSITIVE & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the NOC office was closed. A telephonic attempt was also made and {{callRemark call_remark call_confirmation}}.

LOCALITY INFORMATION:
${NOC_LOCALITY_NODOOR}

AREA ASSESSMENT:
${NOC_AREA}

${NOC_CONCLUSION}{{/eq}}{{#eq outcome "Shifted & Door Open"}}NOC Remark: SHIFTED & DOOR OPEN.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. Met with {{met_person_name}} ({{designation}}), who informed that the NOC office has shifted from the given address {{pluralize old_office_shifted_period}} ago.

CURRENT OFFICE STATUS:
{{current_company_name}} is currently operating at the given address for the last {{pluralize current_company_period}}. ${NOC_NAMEPLATE}

LOCALITY INFORMATION:
${NOC_LOCALITY}

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} that the NOC office has shifted from the given address {{pluralize old_office_shifted_period}} ago. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.

AREA ASSESSMENT:
${NOC_AREA}

${NOC_CONCLUSION}{{/eq}}{{#eq outcome "Shifted & Door Locked"}}NOC Remark: SHIFTED & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the premises were closed. A telephonic attempt was also made and {{callRemark call_remark call_confirmation}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}}, who {{lc tpc_confirmation_1}} that the NOC office has shifted from the given address. Second TPC was done with {{tpcLabel tpc_name_2 tpc_met_person_2}}, who also {{lc tpc_confirmation_2}} the same.

CURRENT OFFICE STATUS:
{{currentCompanyOperating current_company_name (pluralize current_company_period)}}${NOC_NAMEPLATE}

LOCALITY INFORMATION:
${NOC_LOCALITY}

AREA ASSESSMENT:
${NOC_AREA}

${NOC_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Open"}}NOC Remark: NSP & DOOR OPEN (No Such Person).

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. Met with {{met_person_name}} ({{designation}}), who informed that no such person is associated with the NOC at the given address.

NOC VERIFICATION:
As per the met person, {{customer_name}} has no connection with the NOC or the project at this address. At present, the given premises is {{lc premises_status}}. Current company nameplate {{nameplate company_name_plate_status name_on_board "displays"}}.

LOCALITY INFORMATION:
${NOC_LOCALITY}

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}} and {{tpcLabel tpc_name_2 tpc_met_person_2}}, who confirmed that no such person ({{customer_name}}) is associated with the NOC at the given address.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s association with the NOC is not confirmed by the field executive's observation or from TPC.

${NOC_CONCLUSION}{{/eq}}{{#eq outcome "NSP & Door Locked"}}NOC Remark: NSP & DOOR LOCKED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, the premises were closed. A telephonic attempt was also made and {{callRemark call_remark call_confirmation}}.

THIRD PARTY CONFIRMATION:
TPC was conducted with {{tpcLabel tpc_name_1 tpc_met_person_1}} and {{tpcLabel tpc_name_2 tpc_met_person_2}}, who confirmed that the NOC office exists at the given address but no such person ({{customer_name}}) is associated with it.

CURRENT OFFICE STATUS:
{{currentCompanyOperating current_company_name (pluralize current_company_period)}}${NOC_NAMEPLATE}

LOCALITY INFORMATION:
${NOC_LOCALITY}

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}. {{customer_name}}'s association with the NOC is not confirmed by the field executive's observation or from TPC.

${NOC_CONCLUSION}{{/eq}}{{#eq outcome "ERT"}}NOC Remark: ENTRY RESTRICTED.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is locatable and rated as {{address_rating}}. At the time of visit, met with {{name_of_met_person}} ({{met_person_type}}), who informed that entry to the given premises is not allowed. A telephonic attempt was also made and {{callRemark call_remark call_confirmation}}.

ENTRY RESTRICTION DETAILS:
{{name_of_met_person}} {{metPersonConfirmation met_person_confirmation}} the NOC office existence at the given address{{existsClause office_exists_status}}. Entry is restricted due to security protocols or office policies.

LOCALITY INFORMATION:
The locality is {{locality}} with an address structure of G+{{address_structure}}. The Structure color is {{address_structure_color}}.

AREA ASSESSMENT:
Landmarks nearby: {{landmark_1}} and {{landmark_2}}. {{dominatedArea dominated_area}}.{{sentenceClause (capFirst feedback_from_neighbour) " " " feedback was received from the met person."}}{{sentenceClause political_connection " " "."}}

${NOC_CONCLUSION}{{/eq}}{{#eq outcome "Untraceable"}}NOC Remark: UNTRACEABLE.

VERIFICATION DETAILS:
Visited at the given address ({{customer_address}}) for {{customer_name}} ({{applicant_type}}). The given address is incorrect and untraceable.

CONTACT ATTEMPT:
We called {{customer_name}}, but {{callRemark call_remark call_confirmation}}. At the given location, inquired with {{contact_person}}, who could not provide guidance to the address.

SEARCH EFFORTS:
The locality type is {{locality}}. Field executive surveyed the following landmarks during the search: {{landmark_1}}, {{landmark_2}}, {{landmark_3}}, {{landmark_4}}. {{dominatedArea dominated_area}}.

${NOC_CONCLUSION}{{/eq}}`;

export const FIELD_REPORT_DEFAULTS: Record<string, FieldReportDefault> = {
  RESIDENCE: { templateBody: RESIDENCE_BODY, columns: RESIDENCE_COLUMNS },
  OFFICE: { templateBody: OFFICE_BODY, columns: OFFICE_COLUMNS },
  BUSINESS: { templateBody: BUSINESS_BODY, columns: BUSINESS_COLUMNS },
  RESIDENCE_CUM_OFFICE: { templateBody: RCO_BODY, columns: RCO_COLUMNS },
  PROPERTY_INDIVIDUAL: { templateBody: PI_BODY, columns: PI_COLUMNS },
  PROPERTY_APF: { templateBody: APF_BODY, columns: APF_COLUMNS },
  BUILDER: { templateBody: BUILDER_BODY, columns: BUILDER_COLUMNS },
  DSA_CONNECTOR: { templateBody: DSA_BODY, columns: DSA_COLUMNS },
  NOC: { templateBody: NOC_BODY, columns: NOC_COLUMNS },
};
