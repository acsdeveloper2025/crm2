/**
 * Per-verification-type section grouping for the FIELD_REPORT raw-field view (ADR-0039 R1, v1
 * `createComprehensiveFormSections` parity). Transcribed verbatim from the research artifact
 * `docs/engineering/field-report-section-grouping-2026-06-22.md` — section titles, order, refs and
 * labels are the spec's source of truth. Consumed ONLY by `buildSections` in `sections.ts`; not part
 * of the `@crm2/sdk` contract (the FE render is unchanged).
 *
 * `ref` is the camelCase DEVICE key under `<slug>.formData.<ref>`. Non-formData spec lines (the
 * `outcome`/`customer_name`/`applicant_type`/`customer_address` rows, which map to
 * `verificationOutcome` + TASK/APPLICANT fields) are EXCLUDED here: `sections.ts` appends the raw
 * `verificationOutcome` row itself, and the others are not in the submitted `formData`.
 *
 * ERT-only duplicates share a base `ref` under distinct catalog columnKeys (e.g. `metPersonName`
 * twice in `office`). They are transcribed in spec order; `buildSections` dedupes by `ref` (first
 * wins), so the primary (non-ERT) occurrence — always listed first by the spec — is the one rendered.
 */

export interface SectionFieldDef {
  ref: string;
  label: string;
}

export interface SectionDef {
  title: string;
  fields: SectionFieldDef[];
}

export const SECTION_MAP: Record<string, SectionDef[]> = {
  residence: [
    {
      title: 'Verification Outcome & Status',
      fields: [
        { ref: 'addressRating', label: 'Address Rating' },
        { ref: 'houseStatus', label: 'House Status' },
        { ref: 'finalStatus', label: 'Final Status' },
      ],
    },
    {
      title: 'Met Person & Occupancy',
      fields: [
        { ref: 'metPersonName', label: 'Met Person Name' },
        { ref: 'metPersonRelation', label: 'Met Person Relation' },
        { ref: 'metPersonStatus', label: 'Met Person Status' },
        { ref: 'metPersonType', label: 'Met Person Type' },
        { ref: 'metPersonConfirmation', label: 'Met Person Confirmation' },
        { ref: 'stayingPeriod', label: 'Staying Period' },
        { ref: 'stayingStatus', label: 'Staying Status' },
        { ref: 'stayingPersonName', label: 'Current Occupant' },
        { ref: 'shiftedPeriod', label: 'Shifted Period' },
        { ref: 'applicantStayingFloor', label: 'Applicant Staying Floor' },
        { ref: 'applicantStayingStatus', label: 'Applicant Staying Status' },
      ],
    },
    {
      title: 'Household & Premises Details',
      fields: [
        { ref: 'approxArea', label: 'Approx Area' },
        { ref: 'totalFamilyMembers', label: 'Total Family Members' },
        { ref: 'totalEarningMember', label: 'Total Earning Members' },
        { ref: 'workingStatus', label: 'Working Status' },
        { ref: 'companyName', label: 'Company Name' },
      ],
    },
    {
      title: 'Property / Nameplate & Documents',
      fields: [
        { ref: 'addressStructure', label: 'Address Structure (G+)' },
        { ref: 'addressStructureColor', label: 'Structure Color' },
        { ref: 'doorColor', label: 'Door Color' },
        { ref: 'doorNamePlateStatus', label: 'Door Nameplate Status' },
        { ref: 'nameOnDoorPlate', label: 'Name on Door Plate' },
        { ref: 'societyNamePlateStatus', label: 'Society Board Status' },
        { ref: 'nameOnSocietyBoard', label: 'Name on Society Board' },
        { ref: 'documentShown', label: 'Document Shown' },
        { ref: 'documentType', label: 'Document Type' },
      ],
    },
    {
      title: 'Telephonic Confirmation',
      fields: [
        { ref: 'callRemark', label: 'Call Remark' },
        { ref: 'callConfirmation', label: 'Call Confirmation' },
        { ref: 'contactPerson', label: 'Contact Person' },
      ],
    },
    {
      title: 'TPC (Third-Party Confirmation)',
      fields: [
        { ref: 'tpcName1', label: 'TPC 1 Name' },
        { ref: 'tpcMetPerson1', label: 'TPC 1 Relation' },
        { ref: 'tpcConfirmation1', label: 'TPC 1 Confirmation' },
        { ref: 'tpcName2', label: 'TPC 2 Name' },
        { ref: 'tpcMetPerson2', label: 'TPC 2 Relation' },
        { ref: 'tpcConfirmation2', label: 'TPC 2 Confirmation' },
      ],
    },
    {
      title: 'Locality & Area Assessment',
      fields: [
        { ref: 'locality', label: 'Locality' },
        { ref: 'landmark1', label: 'Landmark 1' },
        { ref: 'landmark2', label: 'Landmark 2' },
        { ref: 'landmark3', label: 'Landmark 3' },
        { ref: 'landmark4', label: 'Landmark 4' },
        { ref: 'dominatedArea', label: 'Dominated Area' },
        { ref: 'feedbackFromNeighbour', label: 'Neighbour Feedback' },
        { ref: 'politicalConnection', label: 'Political Connection' },
      ],
    },
    {
      title: 'Conclusion / Remarks',
      fields: [{ ref: 'otherObservation', label: 'Field Observation' }],
    },
  ],

  office: [
    {
      title: 'Verification Outcome & Status',
      fields: [
        { ref: 'addressRating', label: 'Address Rating' },
        { ref: 'officeStatus', label: 'Office Status' },
        { ref: 'officeExistsStatus', label: 'Office Exists Status' },
        { ref: 'finalStatus', label: 'Final Status' },
      ],
    },
    {
      title: 'Met Person Details',
      fields: [
        { ref: 'metPersonName', label: 'Met Person Name' },
        { ref: 'metPersonDesignation', label: 'Met Person Designation' },
        { ref: 'metPersonName', label: 'Name of Met Person (ERT)' },
        { ref: 'metPersonType', label: 'Met Person Type' },
        { ref: 'metPersonConfirmation', label: 'Met Person Confirmation' },
      ],
    },
    {
      title: 'Employment & Office Details',
      fields: [
        { ref: 'workingPeriod', label: 'Working Period' },
        { ref: 'applicantDesignation', label: 'Applicant Designation' },
        { ref: 'applicantWorkingPremises', label: 'Applicant Working Premises' },
        { ref: 'applicantWorkingStatus', label: 'Applicant Working Status' },
        { ref: 'sittingLocation', label: 'Sitting Location' },
        { ref: 'officeType', label: 'Office Type' },
        { ref: 'companyNatureOfBusiness', label: 'Nature of Business' },
        { ref: 'establishmentPeriod', label: 'Establishment Period' },
        { ref: 'staffStrength', label: 'Staff Strength' },
        { ref: 'staffSeen', label: 'Staff Seen' },
        { ref: 'officeApproxArea', label: 'Office Approx Area' },
      ],
    },
    {
      title: 'Shifting Details',
      fields: [
        { ref: 'oldOfficeShiftedPeriod', label: 'Old Office Shifted Period' },
        { ref: 'currentCompanyName', label: 'Current Company Name' },
        { ref: 'currentCompanyPeriod', label: 'Current Company Period' },
      ],
    },
    {
      title: 'Property / Nameplate & Documents',
      fields: [
        { ref: 'companyNamePlateStatus', label: 'Company Nameplate Status' },
        { ref: 'nameOnBoard', label: 'Name on Board' },
        { ref: 'documentShown', label: 'Document Shown' },
      ],
    },
    {
      title: 'Telephonic Confirmation',
      fields: [
        { ref: 'callRemark', label: 'Call Remark' },
        { ref: 'contactPerson', label: 'Contact Person' },
      ],
    },
    {
      title: 'TPC (Third-Party Confirmation)',
      fields: [
        { ref: 'tpcName1', label: 'TPC 1 Name' },
        { ref: 'tpcMetPerson1', label: 'TPC 1 Relation' },
        { ref: 'tpcConfirmation1', label: 'TPC 1 Confirmation' },
        { ref: 'tpcName2', label: 'TPC 2 Name' },
        { ref: 'tpcMetPerson2', label: 'TPC 2 Relation' },
        { ref: 'tpcConfirmation2', label: 'TPC 2 Confirmation' },
      ],
    },
    {
      title: 'Locality & Area Assessment',
      fields: [
        { ref: 'locality', label: 'Locality' },
        { ref: 'addressStructure', label: 'Address Structure (G+)' },
        { ref: 'addressStructureColor', label: 'Structure Color' },
        { ref: 'doorColor', label: 'Door Color' },
        { ref: 'addressFloor', label: 'Address Floor' },
        { ref: 'landmark1', label: 'Landmark 1' },
        { ref: 'landmark2', label: 'Landmark 2' },
        { ref: 'landmark3', label: 'Landmark 3' },
        { ref: 'landmark4', label: 'Landmark 4' },
        { ref: 'dominatedArea', label: 'Dominated Area' },
        { ref: 'feedbackFromNeighbour', label: 'Neighbour Feedback' },
        { ref: 'politicalConnection', label: 'Political Connection' },
      ],
    },
    {
      title: 'Conclusion / Remarks',
      fields: [{ ref: 'otherObservation', label: 'Field Observation' }],
    },
  ],

  business: [
    {
      title: 'Verification Outcome & Status',
      fields: [
        { ref: 'addressRating', label: 'Address Rating' },
        { ref: 'businessStatus', label: 'Business Status' },
        { ref: 'businessExistsStatus', label: 'Business Exists Status (ERT)' },
        { ref: 'premisesStatus', label: 'Premises Status' },
        { ref: 'finalStatus', label: 'Final Status' },
      ],
    },
    {
      title: 'Met Person Details',
      fields: [
        { ref: 'metPersonName', label: 'Met Person Name' },
        { ref: 'metPersonDesignation', label: 'Met Person Designation' },
        { ref: 'metPersonName', label: 'Name of Met Person (ERT)' },
        { ref: 'metPersonType', label: 'Met Person Type (ERT)' },
        { ref: 'metPersonConfirmation', label: 'Met Person Confirmation (ERT)' },
        { ref: 'applicantWorkingStatus', label: 'Applicant Working Status (ERT)' },
      ],
    },
    {
      title: 'Business Details',
      fields: [
        { ref: 'businessPeriod', label: 'Business Period' },
        { ref: 'businessType', label: 'Business Type' },
        { ref: 'ownershipType', label: 'Ownership Type' },
        { ref: 'companyNatureOfBusiness', label: 'Nature of Business' },
        { ref: 'approxArea', label: 'Business Approx Area' },
        { ref: 'nameOfCompanyOwners', label: 'Business Owner Name' },
        { ref: 'staffStrength', label: 'Staff Strength' },
        { ref: 'staffSeen', label: 'Staff Seen' },
      ],
    },
    {
      title: 'Shifting Details',
      fields: [
        { ref: 'oldOfficeShiftedPeriod', label: 'Old Business Shifted Period' },
        { ref: 'currentCompanyName', label: 'Current Company Name' },
        { ref: 'currentCompanyPeriod', label: 'Current Company Period' },
      ],
    },
    {
      title: 'Property / Nameplate & Documents',
      fields: [
        { ref: 'companyNamePlateStatus', label: 'Company Nameplate Status' },
        { ref: 'nameOnBoard', label: 'Name on Board' },
        { ref: 'documentShown', label: 'Document Shown' },
      ],
    },
    {
      title: 'Telephonic Confirmation',
      fields: [
        { ref: 'callRemark', label: 'Call Remark' },
        { ref: 'contactPerson', label: 'Contact Person' },
      ],
    },
    {
      title: 'TPC (Third-Party Confirmation)',
      fields: [
        { ref: 'tpcName1', label: 'TPC 1 Name' },
        { ref: 'tpcMetPerson1', label: 'TPC 1 Relation' },
        { ref: 'tpcConfirmation1', label: 'TPC 1 Confirmation' },
        { ref: 'tpcName2', label: 'TPC 2 Name' },
        { ref: 'tpcMetPerson2', label: 'TPC 2 Relation' },
        { ref: 'tpcConfirmation2', label: 'TPC 2 Confirmation' },
      ],
    },
    {
      title: 'Locality & Area Assessment',
      fields: [
        { ref: 'locality', label: 'Locality' },
        { ref: 'addressStructure', label: 'Address Structure (G+)' },
        { ref: 'addressStructureColor', label: 'Structure Color' },
        { ref: 'doorColor', label: 'Door Color' },
        { ref: 'addressFloor', label: 'Address Floor' },
        { ref: 'landmark1', label: 'Landmark 1' },
        { ref: 'landmark2', label: 'Landmark 2' },
        { ref: 'landmark3', label: 'Landmark 3' },
        { ref: 'landmark4', label: 'Landmark 4' },
        { ref: 'dominatedArea', label: 'Dominated Area' },
        { ref: 'feedbackFromNeighbour', label: 'Neighbour Feedback' },
        { ref: 'politicalConnection', label: 'Political Connection' },
      ],
    },
    {
      title: 'Conclusion / Remarks',
      fields: [{ ref: 'otherObservation', label: 'Field Observation' }],
    },
  ],

  'residence-cum-office': [
    {
      title: 'Verification Outcome & Status',
      fields: [
        { ref: 'addressRating', label: 'Address Rating' },
        { ref: 'addressTraceable', label: 'Address Traceable' },
        { ref: 'resiCumOfficeStatus', label: 'Residence-cum-Office Status' },
        { ref: 'finalStatus', label: 'Final Status' },
      ],
    },
    {
      title: 'Met Person & Occupancy',
      fields: [
        { ref: 'metPersonName', label: 'Met Person Name' },
        { ref: 'relation', label: 'Met Person Relation' },
        { ref: 'metPersonStatus', label: 'Met Person Status' },
        { ref: 'metPersonType', label: 'Met Person Type' },
        { ref: 'metPersonConfirmation', label: 'Met Person Confirmation' },
        { ref: 'stayingPeriod', label: 'Staying Period' },
        { ref: 'stayingStatus', label: 'Staying Status' },
        { ref: 'stayingPersonName', label: 'Current Occupant' },
        { ref: 'shiftedPeriod', label: 'Shifted Period' },
        { ref: 'applicantStayingFloor', label: 'Applicant Staying Floor' },
        { ref: 'applicantStayingStatus', label: 'Applicant Staying Status' },
        { ref: 'applicantWorkingStatus', label: 'Applicant Working Status' },
        { ref: 'residenceSetup', label: 'Residence Setup' },
      ],
    },
    {
      title: 'Business Details',
      fields: [
        { ref: 'businessStatus', label: 'Business Status' },
        { ref: 'businessPeriod', label: 'Business Period' },
        { ref: 'businessSetup', label: 'Business Setup' },
        { ref: 'businessLocation', label: 'Business Location' },
        { ref: 'businessOperatingAddress', label: 'Business Operating Address' },
        { ref: 'businessExistsStatus', label: 'Business Exists Status' },
        { ref: 'companyNatureOfBusiness', label: 'Nature of Business' },
        { ref: 'approxArea', label: 'Approx Area' },
      ],
    },
    {
      title: 'Property / Nameplate & Documents',
      fields: [
        { ref: 'addressStructure', label: 'Address Structure (G+)' },
        { ref: 'addressStructureColor', label: 'Structure Color' },
        { ref: 'doorColor', label: 'Door Color' },
        { ref: 'doorNamePlateStatus', label: 'Door Nameplate Status' },
        { ref: 'nameOnDoorPlate', label: 'Name on Door Plate' },
        { ref: 'societyNamePlateStatus', label: 'Society Board Status' },
        { ref: 'nameOnSocietyBoard', label: 'Name on Society Board' },
        { ref: 'companyNamePlateStatus', label: 'Company Board Status' },
        { ref: 'nameOnBoard', label: 'Name on Company Board' },
        { ref: 'documentShown', label: 'Document Shown' },
      ],
    },
    {
      title: 'Telephonic Confirmation',
      fields: [
        { ref: 'callRemark', label: 'Call Remark' },
        { ref: 'contactPerson', label: 'Contact Person' },
      ],
    },
    {
      title: 'TPC (Third-Party Confirmation)',
      fields: [
        { ref: 'tpcName1', label: 'TPC 1 Name' },
        { ref: 'tpcMetPerson1', label: 'TPC 1 Relation' },
        { ref: 'tpcConfirmation1', label: 'TPC 1 Confirmation' },
        { ref: 'tpcName2', label: 'TPC 2 Name' },
        { ref: 'tpcMetPerson2', label: 'TPC 2 Relation' },
        { ref: 'tpcConfirmation2', label: 'TPC 2 Confirmation' },
      ],
    },
    {
      title: 'Locality & Area Assessment',
      fields: [
        { ref: 'locality', label: 'Locality' },
        { ref: 'landmark1', label: 'Landmark 1' },
        { ref: 'landmark2', label: 'Landmark 2' },
        { ref: 'landmark3', label: 'Landmark 3' },
        { ref: 'landmark4', label: 'Landmark 4' },
        { ref: 'dominatedArea', label: 'Dominated Area' },
        { ref: 'feedbackFromNeighbour', label: 'Neighbour Feedback' },
        { ref: 'politicalConnection', label: 'Political Connection' },
      ],
    },
    {
      title: 'Conclusion / Remarks',
      fields: [{ ref: 'otherObservation', label: 'Field Observation' }],
    },
  ],

  'property-individual': [
    {
      title: 'Verification Outcome & Status',
      fields: [
        { ref: 'addressRating', label: 'Address Rating' },
        { ref: 'buildingStatus', label: 'Building Status' },
        { ref: 'finalStatus', label: 'Final Status' },
      ],
    },
    {
      title: 'Met Person Details',
      fields: [
        { ref: 'metPersonName', label: 'Met Person Name' },
        { ref: 'relationship', label: 'Met Person Relation' },
        { ref: 'metPersonType', label: 'Met Person Type' },
        { ref: 'metPersonConfirmation', label: 'Met Person Confirmation' },
        { ref: 'metPersonName', label: 'Name of Met Person (ERT)' },
      ],
    },
    {
      title: 'Property Details',
      fields: [
        { ref: 'propertyOwnerName', label: 'Property Owner Name' },
        { ref: 'approxArea', label: 'Approx Area' },
        { ref: 'doorNamePlateStatus', label: 'Door Nameplate Status' },
        { ref: 'nameOnDoorPlate', label: 'Name on Door Plate' },
        { ref: 'societyNamePlateStatus', label: 'Society Board Status' },
        { ref: 'nameOnSocietyBoard', label: 'Name on Society Board' },
      ],
    },
    {
      title: 'Telephonic Confirmation',
      fields: [
        { ref: 'callRemark', label: 'Call Remark' },
        { ref: 'contactPerson', label: 'Contact Person' },
      ],
    },
    {
      title: 'TPC (Third-Party Confirmation)',
      fields: [
        { ref: 'tpcName1', label: 'TPC 1 Name' },
        { ref: 'tpcMetPerson1', label: 'TPC 1 Relation' },
        { ref: 'tpcConfirmation1', label: 'TPC 1 Confirmation' },
        { ref: 'tpcName2', label: 'TPC 2 Name' },
        { ref: 'tpcMetPerson2', label: 'TPC 2 Relation' },
        { ref: 'tpcConfirmation2', label: 'TPC 2 Confirmation' },
      ],
    },
    {
      title: 'Locality & Area Assessment',
      fields: [
        { ref: 'locality', label: 'Locality' },
        { ref: 'addressStructure', label: 'Address Structure (G+)' },
        { ref: 'addressStructureColor', label: 'Structure Color' },
        { ref: 'doorColor', label: 'Door Color' },
        { ref: 'addressFloor', label: 'Address Floor' },
        { ref: 'landmark1', label: 'Landmark 1' },
        { ref: 'landmark2', label: 'Landmark 2' },
        { ref: 'landmark3', label: 'Landmark 3' },
        { ref: 'landmark4', label: 'Landmark 4' },
        { ref: 'dominatedArea', label: 'Dominated Area' },
        { ref: 'feedbackFromNeighbour', label: 'Neighbour Feedback' },
        { ref: 'politicalConnection', label: 'Political Connection' },
      ],
    },
    {
      title: 'Conclusion / Remarks',
      fields: [{ ref: 'otherObservation', label: 'Field Observation' }],
    },
  ],

  'property-apf': [
    {
      title: 'Verification Outcome & Status',
      fields: [
        { ref: 'addressRating', label: 'Address Rating' },
        { ref: 'constructionActivity', label: 'Construction Activity' },
        { ref: 'activityStopReason', label: 'Activity Stop Reason' },
        { ref: 'buildingStatus', label: 'Building Status' },
        { ref: 'finalStatus', label: 'Final Status' },
      ],
    },
    {
      title: 'Project Details',
      fields: [
        { ref: 'projectName', label: 'Project Name' },
        { ref: 'projectStartedDate', label: 'Project Started Date' },
        { ref: 'projectCompletionDate', label: 'Project Completion Date' },
        { ref: 'totalWing', label: 'Total Wings' },
        { ref: 'totalFlats', label: 'Total Flats' },
        { ref: 'projectCompletionPercent', label: 'Project Completion %' },
        { ref: 'staffStrength', label: 'Staff Strength' },
        { ref: 'staffSeen', label: 'Staff Seen' },
      ],
    },
    {
      title: 'Met Person Details',
      fields: [
        { ref: 'metPersonName', label: 'Met Person Name' },
        { ref: 'metPersonDesignation', label: 'Met Person Designation' },
        { ref: 'metPersonName', label: 'Name of Met Person (ERT)' },
        { ref: 'metPersonType', label: 'Met Person Type (ERT)' },
        { ref: 'metPersonConfirmation', label: 'Met Person Confirmation (ERT)' },
      ],
    },
    {
      title: 'Property / Nameplate',
      fields: [
        { ref: 'companyNamePlateStatus', label: 'Company Board Status' },
        { ref: 'nameOnBoard', label: 'Name on Board' },
      ],
    },
    {
      title: 'Telephonic Confirmation',
      fields: [
        { ref: 'callRemark', label: 'Call Remark' },
        { ref: 'contactPerson', label: 'Contact Person' },
      ],
    },
    {
      title: 'TPC (Third-Party Confirmation)',
      fields: [
        { ref: 'tpcName1', label: 'TPC 1 Name' },
        { ref: 'tpcMetPerson1', label: 'TPC 1 Relation' },
        { ref: 'tpcName2', label: 'TPC 2 Name' },
        { ref: 'tpcMetPerson2', label: 'TPC 2 Relation' },
      ],
    },
    {
      title: 'Locality & Area Assessment',
      fields: [
        { ref: 'locality', label: 'Locality' },
        { ref: 'landmark1', label: 'Landmark 1' },
        { ref: 'landmark2', label: 'Landmark 2' },
        { ref: 'landmark3', label: 'Landmark 3' },
        { ref: 'landmark4', label: 'Landmark 4' },
        { ref: 'dominatedArea', label: 'Dominated Area' },
        { ref: 'feedbackFromNeighbour', label: 'Neighbour Feedback' },
        { ref: 'politicalConnection', label: 'Political Connection' },
      ],
    },
    {
      title: 'Conclusion / Remarks',
      fields: [{ ref: 'otherObservation', label: 'Field Observation' }],
    },
  ],

  builder: [
    {
      title: 'Verification Outcome & Status',
      fields: [
        { ref: 'addressRating', label: 'Address Rating' },
        { ref: 'officeStatus', label: 'Office Status' },
        { ref: 'businessExistsStatus', label: 'Business Exists Status (ERT)' },
        { ref: 'premisesStatus', label: 'Premises Status' },
        { ref: 'finalStatus', label: 'Final Status' },
      ],
    },
    {
      title: 'Met Person Details',
      fields: [
        { ref: 'metPersonName', label: 'Met Person Name' },
        { ref: 'metPersonDesignation', label: 'Met Person Designation' },
        { ref: 'metPersonName', label: 'Name of Met Person (ERT)' },
        { ref: 'metPersonType', label: 'Met Person Type (ERT)' },
        { ref: 'metPersonConfirmation', label: 'Met Person Confirmation (ERT)' },
        { ref: 'applicantWorkingStatus', label: 'Applicant Working Status (ERT)' },
      ],
    },
    {
      title: 'Builder / Business Details',
      fields: [
        { ref: 'businessPeriod', label: 'Business Period' },
        { ref: 'businessType', label: 'Builder Type' },
        { ref: 'ownershipType', label: 'Ownership Type' },
        { ref: 'companyNatureOfBusiness', label: 'Nature of Business' },
        { ref: 'officeApproxArea', label: 'Office Approx Area' },
        { ref: 'addressStatus', label: 'Premises Held Status' },
        { ref: 'nameOfCompanyOwners', label: 'Builder Name' },
        { ref: 'staffStrength', label: 'Staff Strength' },
        { ref: 'staffSeen', label: 'Staff Seen' },
      ],
    },
    {
      title: 'Shifting Details',
      fields: [
        { ref: 'oldOfficeShiftedPeriod', label: 'Old Office Shifted Period' },
        { ref: 'currentCompanyName', label: 'Current Company Name' },
        { ref: 'currentCompanyPeriod', label: 'Current Company Period' },
      ],
    },
    {
      title: 'Property / Nameplate & Documents',
      fields: [
        { ref: 'companyNamePlateStatus', label: 'Company Nameplate Status' },
        { ref: 'nameOnBoard', label: 'Name on Board' },
        { ref: 'documentShown', label: 'Document Shown' },
      ],
    },
    {
      title: 'Telephonic Confirmation',
      fields: [
        { ref: 'callRemark', label: 'Call Remark' },
        { ref: 'callConfirmation', label: 'Call Confirmation' },
        { ref: 'contactPerson', label: 'Contact Person' },
      ],
    },
    {
      title: 'TPC (Third-Party Confirmation)',
      fields: [
        { ref: 'tpcName1', label: 'TPC 1 Name' },
        { ref: 'tpcMetPerson1', label: 'TPC 1 Relation' },
        { ref: 'tpcConfirmation1', label: 'TPC 1 Confirmation' },
        { ref: 'tpcName2', label: 'TPC 2 Name' },
        { ref: 'tpcMetPerson2', label: 'TPC 2 Relation' },
        { ref: 'tpcConfirmation2', label: 'TPC 2 Confirmation' },
      ],
    },
    {
      title: 'Locality & Area Assessment',
      fields: [
        { ref: 'locality', label: 'Locality' },
        { ref: 'addressStructure', label: 'Address Structure (G+)' },
        { ref: 'addressStructureColor', label: 'Structure Color' },
        { ref: 'doorColor', label: 'Door Color' },
        { ref: 'addressFloor', label: 'Address Floor' },
        { ref: 'landmark1', label: 'Landmark 1' },
        { ref: 'landmark2', label: 'Landmark 2' },
        { ref: 'landmark3', label: 'Landmark 3' },
        { ref: 'landmark4', label: 'Landmark 4' },
        { ref: 'dominatedArea', label: 'Dominated Area' },
        { ref: 'feedbackFromNeighbour', label: 'Neighbour Feedback' },
        { ref: 'politicalConnection', label: 'Political Connection' },
      ],
    },
    {
      title: 'Conclusion / Remarks',
      fields: [{ ref: 'otherObservation', label: 'Field Observation' }],
    },
  ],

  'dsa-connector': [
    {
      title: 'Verification Outcome & Status',
      fields: [
        { ref: 'addressRating', label: 'Address Rating' },
        { ref: 'officeStatus', label: 'Office Status' },
        { ref: 'businessExistsStatus', label: 'Business Exists Status (ERT)' },
        { ref: 'premisesStatus', label: 'Premises Status' },
        { ref: 'finalStatus', label: 'Final Status' },
      ],
    },
    {
      title: 'Met Person Details',
      fields: [
        { ref: 'metPersonName', label: 'Met Person Name' },
        { ref: 'metPersonDesignation', label: 'Met Person Designation' },
        { ref: 'metPersonName', label: 'Name of Met Person (ERT)' },
        { ref: 'metPersonType', label: 'Met Person Type (ERT)' },
        { ref: 'metPersonConfirmation', label: 'Met Person Confirmation (ERT)' },
      ],
    },
    {
      title: 'Business / Connector Details',
      fields: [
        { ref: 'businessPeriod', label: 'Business Period' },
        { ref: 'businessType', label: 'Business Type' },
        { ref: 'ownershipType', label: 'Ownership Type' },
        { ref: 'companyNatureOfBusiness', label: 'Nature of Business' },
        { ref: 'nameOfCompanyOwners', label: 'Company Owners' },
        { ref: 'addressStatus', label: 'Premises Held Status' },
        { ref: 'officeApproxArea', label: 'Office Approx Area' },
        { ref: 'staffStrength', label: 'Staff Strength' },
        { ref: 'staffSeen', label: 'Staff Seen' },
        { ref: 'activeClient', label: 'Active Clients' },
      ],
    },
    {
      title: 'Shifting Details',
      fields: [
        { ref: 'oldOfficeShiftedPeriod', label: 'Old Office Shifted Period' },
        { ref: 'currentCompanyName', label: 'Current Company Name' },
        { ref: 'currentCompanyPeriod', label: 'Current Company Period' },
      ],
    },
    {
      title: 'Property / Nameplate',
      fields: [
        { ref: 'companyNamePlateStatus', label: 'Company Nameplate Status' },
        { ref: 'nameOnBoard', label: 'Name on Board' },
      ],
    },
    {
      title: 'Telephonic Confirmation',
      fields: [
        { ref: 'callRemark', label: 'Call Remark' },
        { ref: 'contactPerson', label: 'Contact Person' },
      ],
    },
    {
      title: 'TPC (Third-Party Confirmation)',
      fields: [
        { ref: 'tpcName1', label: 'TPC 1 Name' },
        { ref: 'tpcMetPerson1', label: 'TPC 1 Relation' },
        { ref: 'tpcConfirmation1', label: 'TPC 1 Confirmation' },
        { ref: 'tpcName2', label: 'TPC 2 Name' },
        { ref: 'tpcMetPerson2', label: 'TPC 2 Relation' },
        { ref: 'tpcConfirmation2', label: 'TPC 2 Confirmation' },
      ],
    },
    {
      title: 'Locality & Area Assessment',
      fields: [
        { ref: 'locality', label: 'Locality' },
        { ref: 'addressStructure', label: 'Address Structure (G+)' },
        { ref: 'addressStructureColor', label: 'Structure Color' },
        { ref: 'doorColor', label: 'Door Color' },
        { ref: 'addressFloor', label: 'Address Floor' },
        { ref: 'landmark1', label: 'Landmark 1' },
        { ref: 'landmark2', label: 'Landmark 2' },
        { ref: 'landmark3', label: 'Landmark 3' },
        { ref: 'landmark4', label: 'Landmark 4' },
        { ref: 'dominatedArea', label: 'Dominated Area' },
        { ref: 'feedbackFromNeighbour', label: 'Neighbour Feedback' },
        { ref: 'politicalConnection', label: 'Political Connection' },
      ],
    },
    {
      title: 'Conclusion / Remarks',
      fields: [{ ref: 'otherObservation', label: 'Field Observation' }],
    },
  ],

  noc: [
    {
      title: 'Verification Outcome & Status',
      fields: [
        { ref: 'addressRating', label: 'Address Rating' },
        { ref: 'officeStatus', label: 'Office Status' },
        { ref: 'officeExistsStatus', label: 'Office Exists Status (ERT)' },
        { ref: 'premisesStatus', label: 'Premises Status' },
        { ref: 'finalStatus', label: 'Final Status' },
      ],
    },
    {
      title: 'Met Person & NOC Details',
      fields: [
        { ref: 'metPersonName', label: 'Met Person Name' },
        { ref: 'metPersonDesignation', label: 'Met Person Designation' },
        { ref: 'metPersonName', label: 'Name of Met Person (ERT)' },
        { ref: 'metPersonType', label: 'Met Person Type (ERT)' },
        { ref: 'metPersonConfirmation', label: 'Met Person Confirmation (ERT)' },
        { ref: 'nameOnNoc', label: 'Name on NOC' },
        { ref: 'flatNo', label: 'Flat/Shop/Office No.' },
        { ref: 'authorisedSignature', label: 'Authorised Signatory' },
      ],
    },
    {
      title: 'Shifting Details',
      fields: [
        { ref: 'oldOfficeShiftedPeriod', label: 'Old Office Shifted Period' },
        { ref: 'currentCompanyName', label: 'Current Company Name' },
        { ref: 'currentCompanyPeriod', label: 'Current Company Period' },
      ],
    },
    {
      title: 'Property / Nameplate',
      fields: [
        { ref: 'companyNamePlateStatus', label: 'Company Nameplate Status' },
        { ref: 'nameOnBoard', label: 'Name on Board' },
      ],
    },
    {
      title: 'Telephonic Confirmation',
      fields: [
        { ref: 'callRemark', label: 'Call Remark' },
        { ref: 'callConfirmation', label: 'Call Confirmation' },
        { ref: 'contactPerson', label: 'Contact Person' },
      ],
    },
    {
      title: 'TPC (Third-Party Confirmation)',
      fields: [
        { ref: 'tpcName1', label: 'TPC 1 Name' },
        { ref: 'tpcMetPerson1', label: 'TPC 1 Relation' },
        { ref: 'tpcConfirmation1', label: 'TPC 1 Confirmation' },
        { ref: 'tpcName2', label: 'TPC 2 Name' },
        { ref: 'tpcMetPerson2', label: 'TPC 2 Relation' },
        { ref: 'tpcConfirmation2', label: 'TPC 2 Confirmation' },
      ],
    },
    {
      title: 'Locality & Area Assessment',
      fields: [
        { ref: 'locality', label: 'Locality' },
        { ref: 'addressStructure', label: 'Address Structure (G+)' },
        { ref: 'addressStructureColor', label: 'Structure Color' },
        { ref: 'doorColor', label: 'Door Color' },
        { ref: 'addressFloor', label: 'Address Floor' },
        { ref: 'landmark1', label: 'Landmark 1' },
        { ref: 'landmark2', label: 'Landmark 2' },
        { ref: 'landmark3', label: 'Landmark 3' },
        { ref: 'landmark4', label: 'Landmark 4' },
        { ref: 'dominatedArea', label: 'Dominated Area' },
        { ref: 'feedbackFromNeighbour', label: 'Neighbour Feedback' },
        { ref: 'politicalConnection', label: 'Political Connection' },
      ],
    },
    {
      title: 'Conclusion / Remarks',
      fields: [{ ref: 'otherObservation', label: 'Field Observation' }],
    },
  ],
};
