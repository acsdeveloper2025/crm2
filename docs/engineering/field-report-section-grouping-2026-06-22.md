# Field Report — Per-Type Section Grouping Spec

_Generated 2026-06-22. READ-ONLY research artifact (no source code changed)._

**Grounding.** Section names + ordering follow v1's `createComprehensiveFormSections` (`CRM-BACKEND/src/utils/comprehensiveFormFieldMapping.ts:4558`) — its prefix→section taxonomy (Address/Premises/Person/Personal&Work/Document/TPC/Shifting/Entry/Contact/Area/Final) and its fixed `sectionOrder` — reconciled with the v1 narrative template-body section headers (VERIFICATION DETAILS → EMPLOYMENT/BUSINESS/PROPERTY/PROJECT DETAILS → LOCALITY → THIRD PARTY CONFIRMATION → AREA ASSESSMENT → CONCLUSION). Every `ref`/`label`/`columnKey` is taken verbatim from the v2 catalog in `packages/sdk/src/fieldReportDefaults.ts` (the audited ~100%-match field set). No field keys were invented.

**Identifier note.** `columnKey` is the catalog's unique per-slug id; `ref` is the camelCase device key (final segment of `sourceRef = <slug>.formData.<ref>`). Within a slug the **same `ref` can repeat under different `columnKey`s** (e.g. `metPersonName` is reused by `met_person_name` and `name_of_met_person` for the ERT branch), so coverage is keyed on `columnKey`. `outcome`→`<slug>.verificationOutcome`, `customer_address`→TASK_FIELD `address`, `customer_name`/`applicant_type`→APPLICANT_FIELD; all other refs are `<slug>.formData.<ref>`.

**Coverage rule.** For each slug, every catalog `columnKey` appears exactly once: in a named section or in the trailing **Additional Details** bucket. Named ∪ Additional = full catalog, 0 duplicates, 0 invented.

---

## slug: residence

_50 catalog refs (columnKeys)._

sections (in display order):

- title: "Verification Outcome & Status"
  fields (in order):
    - { ref: "verificationOutcome", label: "Verification Outcome", columnKey: "outcome" }
    - { ref: "name", label: "Customer Name", columnKey: "customer_name" }
    - { ref: "applicant_type", label: "Applicant Type", columnKey: "applicant_type" }
    - { ref: "address", label: "Customer Address", columnKey: "customer_address" }
    - { ref: "addressRating", label: "Address Rating", columnKey: "address_rating" }
    - { ref: "houseStatus", label: "House Status", columnKey: "house_status" }
    - { ref: "finalStatus", label: "Final Status", columnKey: "final_status" }
- title: "Met Person & Occupancy"
  fields (in order):
    - { ref: "metPersonName", label: "Met Person Name", columnKey: "met_person_name" }
    - { ref: "metPersonRelation", label: "Met Person Relation", columnKey: "met_person_relation" }
    - { ref: "metPersonStatus", label: "Met Person Status", columnKey: "met_person_status" }
    - { ref: "metPersonType", label: "Met Person Type", columnKey: "met_person_type" }
    - { ref: "metPersonConfirmation", label: "Met Person Confirmation", columnKey: "met_person_confirmation" }
    - { ref: "stayingPeriod", label: "Staying Period", columnKey: "staying_period" }
    - { ref: "stayingStatus", label: "Staying Status", columnKey: "staying_status" }
    - { ref: "stayingPersonName", label: "Current Occupant", columnKey: "staying_person_name" }
    - { ref: "shiftedPeriod", label: "Shifted Period", columnKey: "shifted_period" }
    - { ref: "applicantStayingFloor", label: "Applicant Staying Floor", columnKey: "applicant_staying_floor" }
    - { ref: "applicantStayingStatus", label: "Applicant Staying Status", columnKey: "applicant_staying_status" }
- title: "Household & Premises Details"
  fields (in order):
    - { ref: "approxArea", label: "Approx Area", columnKey: "approx_area" }
    - { ref: "totalFamilyMembers", label: "Total Family Members", columnKey: "total_family_members" }
    - { ref: "totalEarningMember", label: "Total Earning Members", columnKey: "total_earning_members" }
    - { ref: "workingStatus", label: "Working Status", columnKey: "working_status" }
    - { ref: "companyName", label: "Company Name", columnKey: "company_name" }
- title: "Property / Nameplate & Documents"
  fields (in order):
    - { ref: "addressStructure", label: "Address Structure (G+)", columnKey: "address_structure" }
    - { ref: "addressStructureColor", label: "Structure Color", columnKey: "address_structure_color" }
    - { ref: "doorColor", label: "Door Color", columnKey: "door_color" }
    - { ref: "doorNamePlateStatus", label: "Door Nameplate Status", columnKey: "door_nameplate_status" }
    - { ref: "nameOnDoorPlate", label: "Name on Door Plate", columnKey: "name_on_door_plate" }
    - { ref: "societyNamePlateStatus", label: "Society Board Status", columnKey: "society_nameplate_status" }
    - { ref: "nameOnSocietyBoard", label: "Name on Society Board", columnKey: "name_on_society_board" }
    - { ref: "documentShown", label: "Document Shown", columnKey: "document_shown" }
    - { ref: "documentType", label: "Document Type", columnKey: "document_type" }
- title: "Telephonic Confirmation"
  fields (in order):
    - { ref: "callRemark", label: "Call Remark", columnKey: "call_remark" }
    - { ref: "callConfirmation", label: "Call Confirmation", columnKey: "call_confirmation" }
    - { ref: "contactPerson", label: "Contact Person", columnKey: "contact_person" }
- title: "TPC (Third-Party Confirmation)"
  fields (in order):
    - { ref: "tpcName1", label: "TPC 1 Name", columnKey: "tpc_name_1" }
    - { ref: "tpcMetPerson1", label: "TPC 1 Relation", columnKey: "tpc_met_person_1" }
    - { ref: "tpcConfirmation1", label: "TPC 1 Confirmation", columnKey: "tpc_confirmation_1" }
    - { ref: "tpcName2", label: "TPC 2 Name", columnKey: "tpc_name_2" }
    - { ref: "tpcMetPerson2", label: "TPC 2 Relation", columnKey: "tpc_met_person_2" }
    - { ref: "tpcConfirmation2", label: "TPC 2 Confirmation", columnKey: "tpc_confirmation_2" }
- title: "Locality & Area Assessment"
  fields (in order):
    - { ref: "locality", label: "Locality", columnKey: "locality" }
    - { ref: "landmark1", label: "Landmark 1", columnKey: "landmark_1" }
    - { ref: "landmark2", label: "Landmark 2", columnKey: "landmark_2" }
    - { ref: "landmark3", label: "Landmark 3", columnKey: "landmark_3" }
    - { ref: "landmark4", label: "Landmark 4", columnKey: "landmark_4" }
    - { ref: "dominatedArea", label: "Dominated Area", columnKey: "dominated_area" }
    - { ref: "feedbackFromNeighbour", label: "Neighbour Feedback", columnKey: "feedback_from_neighbour" }
    - { ref: "politicalConnection", label: "Political Connection", columnKey: "political_connection" }
- title: "Conclusion / Remarks"
  fields (in order):
    - { ref: "otherObservation", label: "Field Observation", columnKey: "other_observation" }

**Coverage check:** 50 catalog refs, 50 in named sections + 0 in Additional Details = 50 placed, 0 duplicates, 0 invented.  ✅ all placed, 0 invented, 0 dup

---

## slug: office

_51 catalog refs (columnKeys)._

sections (in display order):

- title: "Verification Outcome & Status"
  fields (in order):
    - { ref: "verificationOutcome", label: "Verification Outcome", columnKey: "outcome" }
    - { ref: "name", label: "Customer Name", columnKey: "customer_name" }
    - { ref: "applicant_type", label: "Applicant Type", columnKey: "applicant_type" }
    - { ref: "address", label: "Customer Address", columnKey: "customer_address" }
    - { ref: "addressRating", label: "Address Rating", columnKey: "address_rating" }
    - { ref: "officeStatus", label: "Office Status", columnKey: "office_status" }
    - { ref: "officeExistsStatus", label: "Office Exists Status", columnKey: "office_exists_status" }
    - { ref: "finalStatus", label: "Final Status", columnKey: "final_status" }
- title: "Met Person Details"
  fields (in order):
    - { ref: "metPersonName", label: "Met Person Name", columnKey: "met_person_name" }
    - { ref: "metPersonDesignation", label: "Met Person Designation", columnKey: "designation" }
    - { ref: "metPersonName", label: "Name of Met Person (ERT)", columnKey: "name_of_met_person" }
    - { ref: "metPersonType", label: "Met Person Type", columnKey: "met_person_type" }
    - { ref: "metPersonConfirmation", label: "Met Person Confirmation", columnKey: "met_person_confirmation" }
- title: "Employment & Office Details"
  fields (in order):
    - { ref: "workingPeriod", label: "Working Period", columnKey: "working_period" }
    - { ref: "applicantDesignation", label: "Applicant Designation", columnKey: "applicant_designation" }
    - { ref: "applicantWorkingPremises", label: "Applicant Working Premises", columnKey: "applicant_working_premises" }
    - { ref: "applicantWorkingStatus", label: "Applicant Working Status", columnKey: "applicant_working_status" }
    - { ref: "sittingLocation", label: "Sitting Location", columnKey: "sitting_location" }
    - { ref: "officeType", label: "Office Type", columnKey: "office_type" }
    - { ref: "companyNatureOfBusiness", label: "Nature of Business", columnKey: "company_nature_of_business" }
    - { ref: "establishmentPeriod", label: "Establishment Period", columnKey: "establishment_period" }
    - { ref: "staffStrength", label: "Staff Strength", columnKey: "staff_strength" }
    - { ref: "staffSeen", label: "Staff Seen", columnKey: "staff_seen" }
    - { ref: "officeApproxArea", label: "Office Approx Area", columnKey: "office_approx_area" }
- title: "Shifting Details"
  fields (in order):
    - { ref: "oldOfficeShiftedPeriod", label: "Old Office Shifted Period", columnKey: "old_office_shifted_period" }
    - { ref: "currentCompanyName", label: "Current Company Name", columnKey: "current_company_name" }
    - { ref: "currentCompanyPeriod", label: "Current Company Period", columnKey: "current_company_period" }
- title: "Property / Nameplate & Documents"
  fields (in order):
    - { ref: "companyNamePlateStatus", label: "Company Nameplate Status", columnKey: "company_name_plate_status" }
    - { ref: "nameOnBoard", label: "Name on Board", columnKey: "name_on_board" }
    - { ref: "documentShown", label: "Document Shown", columnKey: "document_shown" }
- title: "Telephonic Confirmation"
  fields (in order):
    - { ref: "callRemark", label: "Call Remark", columnKey: "call_remark" }
    - { ref: "contactPerson", label: "Contact Person", columnKey: "contact_person" }
- title: "TPC (Third-Party Confirmation)"
  fields (in order):
    - { ref: "tpcName1", label: "TPC 1 Name", columnKey: "tpc_name_1" }
    - { ref: "tpcMetPerson1", label: "TPC 1 Relation", columnKey: "tpc_met_person_1" }
    - { ref: "tpcConfirmation1", label: "TPC 1 Confirmation", columnKey: "tpc_confirmation_1" }
    - { ref: "tpcName2", label: "TPC 2 Name", columnKey: "tpc_name_2" }
    - { ref: "tpcMetPerson2", label: "TPC 2 Relation", columnKey: "tpc_met_person_2" }
    - { ref: "tpcConfirmation2", label: "TPC 2 Confirmation", columnKey: "tpc_confirmation_2" }
- title: "Locality & Area Assessment"
  fields (in order):
    - { ref: "locality", label: "Locality", columnKey: "locality" }
    - { ref: "addressStructure", label: "Address Structure (G+)", columnKey: "address_structure" }
    - { ref: "addressStructureColor", label: "Structure Color", columnKey: "address_structure_color" }
    - { ref: "doorColor", label: "Door Color", columnKey: "door_color" }
    - { ref: "addressFloor", label: "Address Floor", columnKey: "address_floor" }
    - { ref: "landmark1", label: "Landmark 1", columnKey: "landmark_1" }
    - { ref: "landmark2", label: "Landmark 2", columnKey: "landmark_2" }
    - { ref: "landmark3", label: "Landmark 3", columnKey: "landmark_3" }
    - { ref: "landmark4", label: "Landmark 4", columnKey: "landmark_4" }
    - { ref: "dominatedArea", label: "Dominated Area", columnKey: "dominated_area" }
    - { ref: "feedbackFromNeighbour", label: "Neighbour Feedback", columnKey: "feedback_from_neighbour" }
    - { ref: "politicalConnection", label: "Political Connection", columnKey: "political_connection" }
- title: "Conclusion / Remarks"
  fields (in order):
    - { ref: "otherObservation", label: "Field Observation", columnKey: "other_observation" }

**Coverage check:** 51 catalog refs, 51 in named sections + 0 in Additional Details = 51 placed, 0 duplicates, 0 invented.  ✅ all placed, 0 invented, 0 dup

---

## slug: business

_50 catalog refs (columnKeys)._

sections (in display order):

- title: "Verification Outcome & Status"
  fields (in order):
    - { ref: "verificationOutcome", label: "Verification Outcome", columnKey: "outcome" }
    - { ref: "name", label: "Customer Name", columnKey: "customer_name" }
    - { ref: "applicant_type", label: "Applicant Type", columnKey: "applicant_type" }
    - { ref: "address", label: "Customer Address", columnKey: "customer_address" }
    - { ref: "addressRating", label: "Address Rating", columnKey: "address_rating" }
    - { ref: "businessStatus", label: "Business Status", columnKey: "business_status" }
    - { ref: "businessExistsStatus", label: "Business Exists Status (ERT)", columnKey: "business_exists_status" }
    - { ref: "premisesStatus", label: "Premises Status", columnKey: "premises_status" }
    - { ref: "finalStatus", label: "Final Status", columnKey: "final_status" }
- title: "Met Person Details"
  fields (in order):
    - { ref: "metPersonName", label: "Met Person Name", columnKey: "met_person_name" }
    - { ref: "metPersonDesignation", label: "Met Person Designation", columnKey: "designation" }
    - { ref: "metPersonName", label: "Name of Met Person (ERT)", columnKey: "name_of_met_person" }
    - { ref: "metPersonType", label: "Met Person Type (ERT)", columnKey: "met_person_type" }
    - { ref: "metPersonConfirmation", label: "Met Person Confirmation (ERT)", columnKey: "met_person_confirmation" }
    - { ref: "applicantWorkingStatus", label: "Applicant Working Status (ERT)", columnKey: "applicant_working_status" }
- title: "Business Details"
  fields (in order):
    - { ref: "businessPeriod", label: "Business Period", columnKey: "business_period" }
    - { ref: "businessType", label: "Business Type", columnKey: "business_type" }
    - { ref: "ownershipType", label: "Ownership Type", columnKey: "ownership_type" }
    - { ref: "companyNatureOfBusiness", label: "Nature of Business", columnKey: "company_nature_of_business" }
    - { ref: "approxArea", label: "Business Approx Area", columnKey: "business_approx_area" }
    - { ref: "nameOfCompanyOwners", label: "Business Owner Name", columnKey: "business_owner_name" }
    - { ref: "staffStrength", label: "Staff Strength", columnKey: "staff_strength" }
    - { ref: "staffSeen", label: "Staff Seen", columnKey: "staff_seen" }
- title: "Shifting Details"
  fields (in order):
    - { ref: "oldOfficeShiftedPeriod", label: "Old Business Shifted Period", columnKey: "old_business_shifted_period" }
    - { ref: "currentCompanyName", label: "Current Company Name", columnKey: "current_company_name" }
    - { ref: "currentCompanyPeriod", label: "Current Company Period", columnKey: "current_company_period" }
- title: "Property / Nameplate & Documents"
  fields (in order):
    - { ref: "companyNamePlateStatus", label: "Company Nameplate Status", columnKey: "company_name_plate_status" }
    - { ref: "nameOnBoard", label: "Name on Board", columnKey: "name_on_board" }
    - { ref: "documentShown", label: "Document Shown", columnKey: "document_shown" }
- title: "Telephonic Confirmation"
  fields (in order):
    - { ref: "callRemark", label: "Call Remark", columnKey: "call_remark" }
    - { ref: "contactPerson", label: "Contact Person", columnKey: "contact_person" }
- title: "TPC (Third-Party Confirmation)"
  fields (in order):
    - { ref: "tpcName1", label: "TPC 1 Name", columnKey: "tpc_name_1" }
    - { ref: "tpcMetPerson1", label: "TPC 1 Relation", columnKey: "tpc_met_person_1" }
    - { ref: "tpcConfirmation1", label: "TPC 1 Confirmation", columnKey: "tpc_confirmation_1" }
    - { ref: "tpcName2", label: "TPC 2 Name", columnKey: "tpc_name_2" }
    - { ref: "tpcMetPerson2", label: "TPC 2 Relation", columnKey: "tpc_met_person_2" }
    - { ref: "tpcConfirmation2", label: "TPC 2 Confirmation", columnKey: "tpc_confirmation_2" }
- title: "Locality & Area Assessment"
  fields (in order):
    - { ref: "locality", label: "Locality", columnKey: "locality" }
    - { ref: "addressStructure", label: "Address Structure (G+)", columnKey: "address_structure" }
    - { ref: "addressStructureColor", label: "Structure Color", columnKey: "address_structure_color" }
    - { ref: "doorColor", label: "Door Color", columnKey: "door_color" }
    - { ref: "addressFloor", label: "Address Floor", columnKey: "address_floor" }
    - { ref: "landmark1", label: "Landmark 1", columnKey: "landmark_1" }
    - { ref: "landmark2", label: "Landmark 2", columnKey: "landmark_2" }
    - { ref: "landmark3", label: "Landmark 3", columnKey: "landmark_3" }
    - { ref: "landmark4", label: "Landmark 4", columnKey: "landmark_4" }
    - { ref: "dominatedArea", label: "Dominated Area", columnKey: "dominated_area" }
    - { ref: "feedbackFromNeighbour", label: "Neighbour Feedback", columnKey: "feedback_from_neighbour" }
    - { ref: "politicalConnection", label: "Political Connection", columnKey: "political_connection" }
- title: "Conclusion / Remarks"
  fields (in order):
    - { ref: "otherObservation", label: "Field Observation", columnKey: "other_observation" }

**Coverage check:** 50 catalog refs, 50 in named sections + 0 in Additional Details = 50 placed, 0 duplicates, 0 invented.  ✅ all placed, 0 invented, 0 dup

---

## slug: residence-cum-office

_56 catalog refs (columnKeys)._

sections (in display order):

- title: "Verification Outcome & Status"
  fields (in order):
    - { ref: "verificationOutcome", label: "Verification Outcome", columnKey: "outcome" }
    - { ref: "name", label: "Customer Name", columnKey: "customer_name" }
    - { ref: "applicant_type", label: "Applicant Type", columnKey: "applicant_type" }
    - { ref: "address", label: "Customer Address", columnKey: "customer_address" }
    - { ref: "addressRating", label: "Address Rating", columnKey: "address_rating" }
    - { ref: "addressTraceable", label: "Address Traceable", columnKey: "address_traceable" }
    - { ref: "resiCumOfficeStatus", label: "Residence-cum-Office Status", columnKey: "house_status" }
    - { ref: "finalStatus", label: "Final Status", columnKey: "final_status" }
- title: "Met Person & Occupancy"
  fields (in order):
    - { ref: "metPersonName", label: "Met Person Name", columnKey: "met_person_name" }
    - { ref: "relation", label: "Met Person Relation", columnKey: "met_person_relation" }
    - { ref: "metPersonStatus", label: "Met Person Status", columnKey: "met_person_status" }
    - { ref: "metPersonType", label: "Met Person Type", columnKey: "met_person_type" }
    - { ref: "metPersonConfirmation", label: "Met Person Confirmation", columnKey: "met_person_confirmation" }
    - { ref: "stayingPeriod", label: "Staying Period", columnKey: "staying_period" }
    - { ref: "stayingStatus", label: "Staying Status", columnKey: "staying_status" }
    - { ref: "stayingPersonName", label: "Current Occupant", columnKey: "staying_person_name" }
    - { ref: "shiftedPeriod", label: "Shifted Period", columnKey: "shifted_period" }
    - { ref: "applicantStayingFloor", label: "Applicant Staying Floor", columnKey: "applicant_staying_floor" }
    - { ref: "applicantStayingStatus", label: "Applicant Staying Status", columnKey: "applicant_staying_status" }
    - { ref: "applicantWorkingStatus", label: "Applicant Working Status", columnKey: "applicant_working_status" }
    - { ref: "residenceSetup", label: "Residence Setup", columnKey: "residence_setup" }
- title: "Business Details"
  fields (in order):
    - { ref: "businessStatus", label: "Business Status", columnKey: "business_status" }
    - { ref: "businessPeriod", label: "Business Period", columnKey: "business_period" }
    - { ref: "businessSetup", label: "Business Setup", columnKey: "business_setup" }
    - { ref: "businessLocation", label: "Business Location", columnKey: "business_location_value" }
    - { ref: "businessOperatingAddress", label: "Business Operating Address", columnKey: "business_operating_address" }
    - { ref: "businessExistsStatus", label: "Business Exists Status", columnKey: "business_exists_status" }
    - { ref: "companyNatureOfBusiness", label: "Nature of Business", columnKey: "company_nature_of_business" }
    - { ref: "approxArea", label: "Approx Area", columnKey: "approx_area" }
- title: "Property / Nameplate & Documents"
  fields (in order):
    - { ref: "addressStructure", label: "Address Structure (G+)", columnKey: "address_structure" }
    - { ref: "addressStructureColor", label: "Structure Color", columnKey: "address_structure_color" }
    - { ref: "doorColor", label: "Door Color", columnKey: "door_color" }
    - { ref: "doorNamePlateStatus", label: "Door Nameplate Status", columnKey: "door_nameplate_status" }
    - { ref: "nameOnDoorPlate", label: "Name on Door Plate", columnKey: "name_on_door_plate" }
    - { ref: "societyNamePlateStatus", label: "Society Board Status", columnKey: "society_nameplate_status" }
    - { ref: "nameOnSocietyBoard", label: "Name on Society Board", columnKey: "name_on_society_board" }
    - { ref: "companyNamePlateStatus", label: "Company Board Status", columnKey: "company_name_plate_status" }
    - { ref: "nameOnBoard", label: "Name on Company Board", columnKey: "name_on_board" }
    - { ref: "documentShown", label: "Document Shown", columnKey: "document_shown" }
- title: "Telephonic Confirmation"
  fields (in order):
    - { ref: "callRemark", label: "Call Remark", columnKey: "call_remark" }
    - { ref: "contactPerson", label: "Contact Person", columnKey: "contact_person" }
- title: "TPC (Third-Party Confirmation)"
  fields (in order):
    - { ref: "tpcName1", label: "TPC 1 Name", columnKey: "tpc_name_1" }
    - { ref: "tpcMetPerson1", label: "TPC 1 Relation", columnKey: "tpc_met_person_1" }
    - { ref: "tpcConfirmation1", label: "TPC 1 Confirmation", columnKey: "tpc_confirmation_1" }
    - { ref: "tpcName2", label: "TPC 2 Name", columnKey: "tpc_name_2" }
    - { ref: "tpcMetPerson2", label: "TPC 2 Relation", columnKey: "tpc_met_person_2" }
    - { ref: "tpcConfirmation2", label: "TPC 2 Confirmation", columnKey: "tpc_confirmation_2" }
- title: "Locality & Area Assessment"
  fields (in order):
    - { ref: "locality", label: "Locality", columnKey: "locality" }
    - { ref: "landmark1", label: "Landmark 1", columnKey: "landmark_1" }
    - { ref: "landmark2", label: "Landmark 2", columnKey: "landmark_2" }
    - { ref: "landmark3", label: "Landmark 3", columnKey: "landmark_3" }
    - { ref: "landmark4", label: "Landmark 4", columnKey: "landmark_4" }
    - { ref: "dominatedArea", label: "Dominated Area", columnKey: "dominated_area" }
    - { ref: "feedbackFromNeighbour", label: "Neighbour Feedback", columnKey: "feedback_from_neighbour" }
    - { ref: "politicalConnection", label: "Political Connection", columnKey: "political_connection" }
- title: "Conclusion / Remarks"
  fields (in order):
    - { ref: "otherObservation", label: "Field Observation", columnKey: "other_observation" }

**Coverage check:** 56 catalog refs, 56 in named sections + 0 in Additional Details = 56 placed, 0 duplicates, 0 invented.  ✅ all placed, 0 invented, 0 dup

---

## slug: property-individual

_39 catalog refs (columnKeys)._

sections (in display order):

- title: "Verification Outcome & Status"
  fields (in order):
    - { ref: "verificationOutcome", label: "Verification Outcome", columnKey: "outcome" }
    - { ref: "name", label: "Customer Name", columnKey: "customer_name" }
    - { ref: "applicant_type", label: "Applicant Type", columnKey: "applicant_type" }
    - { ref: "address", label: "Customer Address", columnKey: "customer_address" }
    - { ref: "addressRating", label: "Address Rating", columnKey: "address_rating" }
    - { ref: "buildingStatus", label: "Building Status", columnKey: "building_status" }
    - { ref: "finalStatus", label: "Final Status", columnKey: "final_status" }
- title: "Met Person Details"
  fields (in order):
    - { ref: "metPersonName", label: "Met Person Name", columnKey: "met_person_name" }
    - { ref: "relationship", label: "Met Person Relation", columnKey: "met_person_relation" }
    - { ref: "metPersonType", label: "Met Person Type", columnKey: "met_person_type" }
    - { ref: "metPersonConfirmation", label: "Met Person Confirmation", columnKey: "met_person_confirmation" }
    - { ref: "metPersonName", label: "Name of Met Person (ERT)", columnKey: "name_of_met_person" }
- title: "Property Details"
  fields (in order):
    - { ref: "propertyOwnerName", label: "Property Owner Name", columnKey: "property_owner_name" }
    - { ref: "approxArea", label: "Approx Area", columnKey: "approx_area" }
    - { ref: "doorNamePlateStatus", label: "Door Nameplate Status", columnKey: "door_nameplate_status" }
    - { ref: "nameOnDoorPlate", label: "Name on Door Plate", columnKey: "name_on_door_plate" }
    - { ref: "societyNamePlateStatus", label: "Society Board Status", columnKey: "society_nameplate_status" }
    - { ref: "nameOnSocietyBoard", label: "Name on Society Board", columnKey: "name_on_society_board" }
- title: "Telephonic Confirmation"
  fields (in order):
    - { ref: "callRemark", label: "Call Remark", columnKey: "call_remark" }
    - { ref: "contactPerson", label: "Contact Person", columnKey: "contact_person" }
- title: "TPC (Third-Party Confirmation)"
  fields (in order):
    - { ref: "tpcName1", label: "TPC 1 Name", columnKey: "tpc_name_1" }
    - { ref: "tpcMetPerson1", label: "TPC 1 Relation", columnKey: "tpc_met_person_1" }
    - { ref: "tpcConfirmation1", label: "TPC 1 Confirmation", columnKey: "tpc_confirmation_1" }
    - { ref: "tpcName2", label: "TPC 2 Name", columnKey: "tpc_name_2" }
    - { ref: "tpcMetPerson2", label: "TPC 2 Relation", columnKey: "tpc_met_person_2" }
    - { ref: "tpcConfirmation2", label: "TPC 2 Confirmation", columnKey: "tpc_confirmation_2" }
- title: "Locality & Area Assessment"
  fields (in order):
    - { ref: "locality", label: "Locality", columnKey: "locality" }
    - { ref: "addressStructure", label: "Address Structure (G+)", columnKey: "address_structure" }
    - { ref: "addressStructureColor", label: "Structure Color", columnKey: "address_structure_color" }
    - { ref: "doorColor", label: "Door Color", columnKey: "door_color" }
    - { ref: "addressFloor", label: "Address Floor", columnKey: "address_floor" }
    - { ref: "landmark1", label: "Landmark 1", columnKey: "landmark_1" }
    - { ref: "landmark2", label: "Landmark 2", columnKey: "landmark_2" }
    - { ref: "landmark3", label: "Landmark 3", columnKey: "landmark_3" }
    - { ref: "landmark4", label: "Landmark 4", columnKey: "landmark_4" }
    - { ref: "dominatedArea", label: "Dominated Area", columnKey: "dominated_area" }
    - { ref: "feedbackFromNeighbour", label: "Neighbour Feedback", columnKey: "feedback_from_neighbour" }
    - { ref: "politicalConnection", label: "Political Connection", columnKey: "political_connection" }
- title: "Conclusion / Remarks"
  fields (in order):
    - { ref: "otherObservation", label: "Field Observation", columnKey: "other_observation" }

**Coverage check:** 39 catalog refs, 39 in named sections + 0 in Additional Details = 39 placed, 0 duplicates, 0 invented.  ✅ all placed, 0 invented, 0 dup

---

## slug: property-apf

_39 catalog refs (columnKeys)._

sections (in display order):

- title: "Verification Outcome & Status"
  fields (in order):
    - { ref: "verificationOutcome", label: "Verification Outcome", columnKey: "outcome" }
    - { ref: "name", label: "Customer Name", columnKey: "customer_name" }
    - { ref: "applicant_type", label: "Applicant Type", columnKey: "applicant_type" }
    - { ref: "address", label: "Customer Address", columnKey: "customer_address" }
    - { ref: "addressRating", label: "Address Rating", columnKey: "address_rating" }
    - { ref: "constructionActivity", label: "Construction Activity", columnKey: "construction_activity" }
    - { ref: "activityStopReason", label: "Activity Stop Reason", columnKey: "activity_stop_reason" }
    - { ref: "buildingStatus", label: "Building Status", columnKey: "building_status" }
    - { ref: "finalStatus", label: "Final Status", columnKey: "final_status" }
- title: "Project Details"
  fields (in order):
    - { ref: "projectName", label: "Project Name", columnKey: "project_name" }
    - { ref: "projectStartedDate", label: "Project Started Date", columnKey: "project_started_date" }
    - { ref: "projectCompletionDate", label: "Project Completion Date", columnKey: "project_completion_date" }
    - { ref: "totalWing", label: "Total Wings", columnKey: "total_wing" }
    - { ref: "totalFlats", label: "Total Flats", columnKey: "total_flats" }
    - { ref: "projectCompletionPercent", label: "Project Completion %", columnKey: "project_completion_percent" }
    - { ref: "staffStrength", label: "Staff Strength", columnKey: "staff_strength" }
    - { ref: "staffSeen", label: "Staff Seen", columnKey: "staff_seen" }
- title: "Met Person Details"
  fields (in order):
    - { ref: "metPersonName", label: "Met Person Name", columnKey: "met_person_name" }
    - { ref: "metPersonDesignation", label: "Met Person Designation", columnKey: "met_person_designation" }
    - { ref: "metPersonName", label: "Name of Met Person (ERT)", columnKey: "name_of_met_person" }
    - { ref: "metPersonType", label: "Met Person Type (ERT)", columnKey: "met_person_type" }
    - { ref: "metPersonConfirmation", label: "Met Person Confirmation (ERT)", columnKey: "met_person_confirmation" }
- title: "Property / Nameplate"
  fields (in order):
    - { ref: "companyNamePlateStatus", label: "Company Board Status", columnKey: "company_name_plate_status" }
    - { ref: "nameOnBoard", label: "Name on Board", columnKey: "name_on_board" }
- title: "Telephonic Confirmation"
  fields (in order):
    - { ref: "callRemark", label: "Call Remark", columnKey: "call_remark" }
    - { ref: "contactPerson", label: "Contact Person", columnKey: "contact_person" }
- title: "TPC (Third-Party Confirmation)"
  fields (in order):
    - { ref: "tpcName1", label: "TPC 1 Name", columnKey: "tpc_name_1" }
    - { ref: "tpcMetPerson1", label: "TPC 1 Relation", columnKey: "tpc_met_person_1" }
    - { ref: "tpcName2", label: "TPC 2 Name", columnKey: "tpc_name_2" }
    - { ref: "tpcMetPerson2", label: "TPC 2 Relation", columnKey: "tpc_met_person_2" }
- title: "Locality & Area Assessment"
  fields (in order):
    - { ref: "locality", label: "Locality", columnKey: "locality" }
    - { ref: "landmark1", label: "Landmark 1", columnKey: "landmark_1" }
    - { ref: "landmark2", label: "Landmark 2", columnKey: "landmark_2" }
    - { ref: "landmark3", label: "Landmark 3", columnKey: "landmark_3" }
    - { ref: "landmark4", label: "Landmark 4", columnKey: "landmark_4" }
    - { ref: "dominatedArea", label: "Dominated Area", columnKey: "dominated_area" }
    - { ref: "feedbackFromNeighbour", label: "Neighbour Feedback", columnKey: "feedback_from_neighbour" }
    - { ref: "politicalConnection", label: "Political Connection", columnKey: "political_connection" }
- title: "Conclusion / Remarks"
  fields (in order):
    - { ref: "otherObservation", label: "Field Observation", columnKey: "other_observation" }

**Coverage check:** 39 catalog refs, 39 in named sections + 0 in Additional Details = 39 placed, 0 duplicates, 0 invented.  ✅ all placed, 0 invented, 0 dup

---

## slug: builder

_52 catalog refs (columnKeys)._

sections (in display order):

- title: "Verification Outcome & Status"
  fields (in order):
    - { ref: "verificationOutcome", label: "Verification Outcome", columnKey: "outcome" }
    - { ref: "name", label: "Customer Name", columnKey: "customer_name" }
    - { ref: "applicant_type", label: "Applicant Type", columnKey: "applicant_type" }
    - { ref: "address", label: "Customer Address", columnKey: "customer_address" }
    - { ref: "addressRating", label: "Address Rating", columnKey: "address_rating" }
    - { ref: "officeStatus", label: "Office Status", columnKey: "office_status" }
    - { ref: "businessExistsStatus", label: "Business Exists Status (ERT)", columnKey: "business_exists_status" }
    - { ref: "premisesStatus", label: "Premises Status", columnKey: "premises_status" }
    - { ref: "finalStatus", label: "Final Status", columnKey: "final_status" }
- title: "Met Person Details"
  fields (in order):
    - { ref: "metPersonName", label: "Met Person Name", columnKey: "met_person_name" }
    - { ref: "metPersonDesignation", label: "Met Person Designation", columnKey: "designation" }
    - { ref: "metPersonName", label: "Name of Met Person (ERT)", columnKey: "name_of_met_person" }
    - { ref: "metPersonType", label: "Met Person Type (ERT)", columnKey: "met_person_type" }
    - { ref: "metPersonConfirmation", label: "Met Person Confirmation (ERT)", columnKey: "met_person_confirmation" }
    - { ref: "applicantWorkingStatus", label: "Applicant Working Status (ERT)", columnKey: "applicant_working_status" }
- title: "Builder / Business Details"
  fields (in order):
    - { ref: "businessPeriod", label: "Business Period", columnKey: "business_period" }
    - { ref: "businessType", label: "Builder Type", columnKey: "builder_type" }
    - { ref: "ownershipType", label: "Ownership Type", columnKey: "ownership_type" }
    - { ref: "companyNatureOfBusiness", label: "Nature of Business", columnKey: "company_nature_of_business" }
    - { ref: "officeApproxArea", label: "Office Approx Area", columnKey: "office_approx_area" }
    - { ref: "addressStatus", label: "Premises Held Status", columnKey: "address_status" }
    - { ref: "nameOfCompanyOwners", label: "Builder Name", columnKey: "builder_name" }
    - { ref: "staffStrength", label: "Staff Strength", columnKey: "staff_strength" }
    - { ref: "staffSeen", label: "Staff Seen", columnKey: "staff_seen" }
- title: "Shifting Details"
  fields (in order):
    - { ref: "oldOfficeShiftedPeriod", label: "Old Office Shifted Period", columnKey: "old_office_shifted_period" }
    - { ref: "currentCompanyName", label: "Current Company Name", columnKey: "current_company_name" }
    - { ref: "currentCompanyPeriod", label: "Current Company Period", columnKey: "current_company_period" }
- title: "Property / Nameplate & Documents"
  fields (in order):
    - { ref: "companyNamePlateStatus", label: "Company Nameplate Status", columnKey: "company_name_plate_status" }
    - { ref: "nameOnBoard", label: "Name on Board", columnKey: "name_on_board" }
    - { ref: "documentShown", label: "Document Shown", columnKey: "document_shown" }
- title: "Telephonic Confirmation"
  fields (in order):
    - { ref: "callRemark", label: "Call Remark", columnKey: "call_remark" }
    - { ref: "callConfirmation", label: "Call Confirmation", columnKey: "call_confirmation" }
    - { ref: "contactPerson", label: "Contact Person", columnKey: "contact_person" }
- title: "TPC (Third-Party Confirmation)"
  fields (in order):
    - { ref: "tpcName1", label: "TPC 1 Name", columnKey: "tpc_name_1" }
    - { ref: "tpcMetPerson1", label: "TPC 1 Relation", columnKey: "tpc_met_person_1" }
    - { ref: "tpcConfirmation1", label: "TPC 1 Confirmation", columnKey: "tpc_confirmation_1" }
    - { ref: "tpcName2", label: "TPC 2 Name", columnKey: "tpc_name_2" }
    - { ref: "tpcMetPerson2", label: "TPC 2 Relation", columnKey: "tpc_met_person_2" }
    - { ref: "tpcConfirmation2", label: "TPC 2 Confirmation", columnKey: "tpc_confirmation_2" }
- title: "Locality & Area Assessment"
  fields (in order):
    - { ref: "locality", label: "Locality", columnKey: "locality" }
    - { ref: "addressStructure", label: "Address Structure (G+)", columnKey: "address_structure" }
    - { ref: "addressStructureColor", label: "Structure Color", columnKey: "address_structure_color" }
    - { ref: "doorColor", label: "Door Color", columnKey: "door_color" }
    - { ref: "addressFloor", label: "Address Floor", columnKey: "address_floor" }
    - { ref: "landmark1", label: "Landmark 1", columnKey: "landmark_1" }
    - { ref: "landmark2", label: "Landmark 2", columnKey: "landmark_2" }
    - { ref: "landmark3", label: "Landmark 3", columnKey: "landmark_3" }
    - { ref: "landmark4", label: "Landmark 4", columnKey: "landmark_4" }
    - { ref: "dominatedArea", label: "Dominated Area", columnKey: "dominated_area" }
    - { ref: "feedbackFromNeighbour", label: "Neighbour Feedback", columnKey: "feedback_from_neighbour" }
    - { ref: "politicalConnection", label: "Political Connection", columnKey: "political_connection" }
- title: "Conclusion / Remarks"
  fields (in order):
    - { ref: "otherObservation", label: "Field Observation", columnKey: "other_observation" }

**Coverage check:** 52 catalog refs, 52 in named sections + 0 in Additional Details = 52 placed, 0 duplicates, 0 invented.  ✅ all placed, 0 invented, 0 dup

---

## slug: dsa-connector

_50 catalog refs (columnKeys)._

sections (in display order):

- title: "Verification Outcome & Status"
  fields (in order):
    - { ref: "verificationOutcome", label: "Verification Outcome", columnKey: "outcome" }
    - { ref: "name", label: "Customer Name", columnKey: "customer_name" }
    - { ref: "applicant_type", label: "Applicant Type", columnKey: "applicant_type" }
    - { ref: "address", label: "Customer Address", columnKey: "customer_address" }
    - { ref: "addressRating", label: "Address Rating", columnKey: "address_rating" }
    - { ref: "officeStatus", label: "Office Status", columnKey: "office_status" }
    - { ref: "businessExistsStatus", label: "Business Exists Status (ERT)", columnKey: "business_exists_status" }
    - { ref: "premisesStatus", label: "Premises Status", columnKey: "premises_status" }
    - { ref: "finalStatus", label: "Final Status", columnKey: "final_status" }
- title: "Met Person Details"
  fields (in order):
    - { ref: "metPersonName", label: "Met Person Name", columnKey: "met_person_name" }
    - { ref: "metPersonDesignation", label: "Met Person Designation", columnKey: "designation" }
    - { ref: "metPersonName", label: "Name of Met Person (ERT)", columnKey: "name_of_met_person" }
    - { ref: "metPersonType", label: "Met Person Type (ERT)", columnKey: "met_person_type" }
    - { ref: "metPersonConfirmation", label: "Met Person Confirmation (ERT)", columnKey: "met_person_confirmation" }
- title: "Business / Connector Details"
  fields (in order):
    - { ref: "businessPeriod", label: "Business Period", columnKey: "business_period" }
    - { ref: "businessType", label: "Business Type", columnKey: "business_type" }
    - { ref: "ownershipType", label: "Ownership Type", columnKey: "ownership_type" }
    - { ref: "companyNatureOfBusiness", label: "Nature of Business", columnKey: "company_nature_of_business" }
    - { ref: "nameOfCompanyOwners", label: "Company Owners", columnKey: "business_owner_name" }
    - { ref: "addressStatus", label: "Premises Held Status", columnKey: "address_status" }
    - { ref: "officeApproxArea", label: "Office Approx Area", columnKey: "office_approx_area" }
    - { ref: "staffStrength", label: "Staff Strength", columnKey: "staff_strength" }
    - { ref: "staffSeen", label: "Staff Seen", columnKey: "staff_seen" }
    - { ref: "activeClient", label: "Active Clients", columnKey: "active_client" }
- title: "Shifting Details"
  fields (in order):
    - { ref: "oldOfficeShiftedPeriod", label: "Old Office Shifted Period", columnKey: "old_office_shifted_period" }
    - { ref: "currentCompanyName", label: "Current Company Name", columnKey: "current_company_name" }
    - { ref: "currentCompanyPeriod", label: "Current Company Period", columnKey: "current_company_period" }
- title: "Property / Nameplate"
  fields (in order):
    - { ref: "companyNamePlateStatus", label: "Company Nameplate Status", columnKey: "company_name_plate_status" }
    - { ref: "nameOnBoard", label: "Name on Board", columnKey: "name_on_board" }
- title: "Telephonic Confirmation"
  fields (in order):
    - { ref: "callRemark", label: "Call Remark", columnKey: "call_remark" }
    - { ref: "contactPerson", label: "Contact Person", columnKey: "contact_person" }
- title: "TPC (Third-Party Confirmation)"
  fields (in order):
    - { ref: "tpcName1", label: "TPC 1 Name", columnKey: "tpc_name_1" }
    - { ref: "tpcMetPerson1", label: "TPC 1 Relation", columnKey: "tpc_met_person_1" }
    - { ref: "tpcConfirmation1", label: "TPC 1 Confirmation", columnKey: "tpc_confirmation_1" }
    - { ref: "tpcName2", label: "TPC 2 Name", columnKey: "tpc_name_2" }
    - { ref: "tpcMetPerson2", label: "TPC 2 Relation", columnKey: "tpc_met_person_2" }
    - { ref: "tpcConfirmation2", label: "TPC 2 Confirmation", columnKey: "tpc_confirmation_2" }
- title: "Locality & Area Assessment"
  fields (in order):
    - { ref: "locality", label: "Locality", columnKey: "locality" }
    - { ref: "addressStructure", label: "Address Structure (G+)", columnKey: "address_structure" }
    - { ref: "addressStructureColor", label: "Structure Color", columnKey: "address_structure_color" }
    - { ref: "doorColor", label: "Door Color", columnKey: "door_color" }
    - { ref: "addressFloor", label: "Address Floor", columnKey: "address_floor" }
    - { ref: "landmark1", label: "Landmark 1", columnKey: "landmark_1" }
    - { ref: "landmark2", label: "Landmark 2", columnKey: "landmark_2" }
    - { ref: "landmark3", label: "Landmark 3", columnKey: "landmark_3" }
    - { ref: "landmark4", label: "Landmark 4", columnKey: "landmark_4" }
    - { ref: "dominatedArea", label: "Dominated Area", columnKey: "dominated_area" }
    - { ref: "feedbackFromNeighbour", label: "Neighbour Feedback", columnKey: "feedback_from_neighbour" }
    - { ref: "politicalConnection", label: "Political Connection", columnKey: "political_connection" }
- title: "Conclusion / Remarks"
  fields (in order):
    - { ref: "otherObservation", label: "Field Observation", columnKey: "other_observation" }

**Coverage check:** 50 catalog refs, 50 in named sections + 0 in Additional Details = 50 placed, 0 duplicates, 0 invented.  ✅ all placed, 0 invented, 0 dup

---

## slug: noc

_44 catalog refs (columnKeys)._

sections (in display order):

- title: "Verification Outcome & Status"
  fields (in order):
    - { ref: "verificationOutcome", label: "Verification Outcome", columnKey: "outcome" }
    - { ref: "name", label: "Customer Name", columnKey: "customer_name" }
    - { ref: "applicant_type", label: "Applicant Type", columnKey: "applicant_type" }
    - { ref: "address", label: "Customer Address", columnKey: "customer_address" }
    - { ref: "addressRating", label: "Address Rating", columnKey: "address_rating" }
    - { ref: "officeStatus", label: "Office Status", columnKey: "office_status" }
    - { ref: "officeExistsStatus", label: "Office Exists Status (ERT)", columnKey: "office_exists_status" }
    - { ref: "premisesStatus", label: "Premises Status", columnKey: "premises_status" }
    - { ref: "finalStatus", label: "Final Status", columnKey: "final_status" }
- title: "Met Person & NOC Details"
  fields (in order):
    - { ref: "metPersonName", label: "Met Person Name", columnKey: "met_person_name" }
    - { ref: "metPersonDesignation", label: "Met Person Designation", columnKey: "designation" }
    - { ref: "metPersonName", label: "Name of Met Person (ERT)", columnKey: "name_of_met_person" }
    - { ref: "metPersonType", label: "Met Person Type (ERT)", columnKey: "met_person_type" }
    - { ref: "metPersonConfirmation", label: "Met Person Confirmation (ERT)", columnKey: "met_person_confirmation" }
    - { ref: "nameOnNoc", label: "Name on NOC", columnKey: "name_on_noc" }
    - { ref: "flatNo", label: "Flat/Shop/Office No.", columnKey: "flat_no" }
    - { ref: "authorisedSignature", label: "Authorised Signatory", columnKey: "authorised_signature" }
- title: "Shifting Details"
  fields (in order):
    - { ref: "oldOfficeShiftedPeriod", label: "Old Office Shifted Period", columnKey: "old_office_shifted_period" }
    - { ref: "currentCompanyName", label: "Current Company Name", columnKey: "current_company_name" }
    - { ref: "currentCompanyPeriod", label: "Current Company Period", columnKey: "current_company_period" }
- title: "Property / Nameplate"
  fields (in order):
    - { ref: "companyNamePlateStatus", label: "Company Nameplate Status", columnKey: "company_name_plate_status" }
    - { ref: "nameOnBoard", label: "Name on Board", columnKey: "name_on_board" }
- title: "Telephonic Confirmation"
  fields (in order):
    - { ref: "callRemark", label: "Call Remark", columnKey: "call_remark" }
    - { ref: "callConfirmation", label: "Call Confirmation", columnKey: "call_confirmation" }
    - { ref: "contactPerson", label: "Contact Person", columnKey: "contact_person" }
- title: "TPC (Third-Party Confirmation)"
  fields (in order):
    - { ref: "tpcName1", label: "TPC 1 Name", columnKey: "tpc_name_1" }
    - { ref: "tpcMetPerson1", label: "TPC 1 Relation", columnKey: "tpc_met_person_1" }
    - { ref: "tpcConfirmation1", label: "TPC 1 Confirmation", columnKey: "tpc_confirmation_1" }
    - { ref: "tpcName2", label: "TPC 2 Name", columnKey: "tpc_name_2" }
    - { ref: "tpcMetPerson2", label: "TPC 2 Relation", columnKey: "tpc_met_person_2" }
    - { ref: "tpcConfirmation2", label: "TPC 2 Confirmation", columnKey: "tpc_confirmation_2" }
- title: "Locality & Area Assessment"
  fields (in order):
    - { ref: "locality", label: "Locality", columnKey: "locality" }
    - { ref: "addressStructure", label: "Address Structure (G+)", columnKey: "address_structure" }
    - { ref: "addressStructureColor", label: "Structure Color", columnKey: "address_structure_color" }
    - { ref: "doorColor", label: "Door Color", columnKey: "door_color" }
    - { ref: "addressFloor", label: "Address Floor", columnKey: "address_floor" }
    - { ref: "landmark1", label: "Landmark 1", columnKey: "landmark_1" }
    - { ref: "landmark2", label: "Landmark 2", columnKey: "landmark_2" }
    - { ref: "landmark3", label: "Landmark 3", columnKey: "landmark_3" }
    - { ref: "landmark4", label: "Landmark 4", columnKey: "landmark_4" }
    - { ref: "dominatedArea", label: "Dominated Area", columnKey: "dominated_area" }
    - { ref: "feedbackFromNeighbour", label: "Neighbour Feedback", columnKey: "feedback_from_neighbour" }
    - { ref: "politicalConnection", label: "Political Connection", columnKey: "political_connection" }
- title: "Conclusion / Remarks"
  fields (in order):
    - { ref: "otherObservation", label: "Field Observation", columnKey: "other_observation" }

**Coverage check:** 44 catalog refs, 44 in named sections + 0 in Additional Details = 44 placed, 0 duplicates, 0 invented.  ✅ all placed, 0 invented, 0 dup

---

## unmatched-v1-fields (across all slugs)

v1's `createComprehensiveFormSections` groups the **same device `formData` camelCase keys** the v2 catalog is built
from (it derives sections by regex on the key prefix), so it introduces **no field key beyond the catalog**. The only
v1 keys without a dedicated v2 catalog `ref` are the controller-set / system fields it special-cases via
`SKIP_FIELDS` + the "Final Assessment" / "Basic Information" buckets:

| v1 key (`SKIP_FIELDS` / assessment) | v1 destination | v2 catalog status |
| --- | --- | --- |
| `outcome` | Basic Information | ✅ present (`outcome` → `<slug>.verificationOutcome`) |
| `customerName` | Basic Information | ✅ present (`customer_name`, APPLICANT_FIELD `name`) |
| `finalStatus` | Final Assessment | ✅ present (`final_status`) |
| `callRemark` | Final Assessment | ✅ present (`call_remark`) |
| `remarks` | Final Assessment | ❌ no separate catalog ref — **do NOT invent.** In v2 the human narrative is the rendered FIELD_REPORT template body (`templateBody`); free-text "remarks" is not a standalone field on the catalog. Closest catalog field is `other_observation` (`otherObservation`, "Field Observation"), already placed in "Conclusion / Remarks". |
| `recommendationStatus` | Final Assessment | ❌ no separate catalog ref — **do NOT invent.** Recommendation/verdict in v2 is carried by `final_status` (`finalStatus`) + the case-level recommendation, not a per-form catalog field. |

No other unmatched v1 fields exist: the v1 regex buckets (Address & Location, Premises, Person, Personal & Work,
Document, TPC, Shifting, Entry Restriction, Contact, Area, Business & Connector, Property & Project, Financial & Market,
Technology & Infrastructure, Utilities & Clearances) all key off the very same `formData` properties that became catalog
`ref`s. The v2 catalogs add no field that v1 lacked and (per the `SKIP_FIELDS` table) only `remarks` /
`recommendationStatus` are v1-only — both intentionally absent from the v2 per-form catalog.

## Notes for implementers

- **Order within each section** follows v1's narrative template-body order where the catalog provides the fields; pure
  display order (the spec above is the source of truth).
- **ERT-only duplicates** (`name_of_met_person`, and the `(ERT)`-labelled met-person/exists fields) are kept as distinct
  catalog `columnKey`s sharing the base `ref` (`metPersonName`, etc.); they are grouped with the primary Met Person
  section. If the renderer dedupes by `ref`, prefer the non-ERT `columnKey` when both have values for the active outcome.
- **`property-apf`** has no Shifting Details and no door/structure-color block (catalog omits them) — its spine is
  Project Details; outcomes are Positive/Negative/ERT/Untraceable. **`property-individual`** has no Shifting Details and
  no NSP-vs-shifted split (no `shifted_period`); its spine is Property Details (flat/premises).
- A field is rendered only when its value is non-empty (v1 skips null/undefined/'' — mirror that so empty sections hide).
