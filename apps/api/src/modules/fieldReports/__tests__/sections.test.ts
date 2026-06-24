import { describe, it, expect } from 'vitest';
import { buildSections, toLabel } from '../sections.js';

describe('field-report sections', () => {
  it('toLabel humanizes camelCase and snake_case', () => {
    expect(toLabel('customerName')).toBe('Customer Name');
    expect(toLabel('met_person_relation')).toBe('Met Person Relation');
    expect(toLabel('tpc1Name')).toBe('Tpc1 Name');
  });

  it('RESIDENCE blob → v1-style ordered, titled sections with mapped labels; outcome leads first section', () => {
    const out = buildSections({
      residence: {
        formData: {
          houseStatus: 'OPENED',
          finalStatus: 'POSITIVE',
          metPersonName: 'RAJESH',
          metPersonRelation: 'SELF',
          stayingPeriod: '5 Years',
          totalFamilyMembers: 4,
          locality: 'Residential',
          otherObservation: 'All ok',
        },
        verificationOutcome: 'POSITIVE',
        photos: [{ id: 'x' }],
        geoLocation: { latitude: 1 },
        metadata: { app: 'v2' },
      },
    });
    // Sections appear in spec order, only non-empty ones survive.
    expect(out.map((s) => s.title)).toEqual([
      'Verification Outcome & Status',
      'Met Person & Occupancy',
      'Household & Premises Details',
      'Locality & Area Assessment',
      'Conclusion / Remarks',
    ]);
    // Outcome row leads the first section, then the mapped fields in spec order with human labels.
    expect(out[0]).toEqual({
      title: 'Verification Outcome & Status',
      fields: [
        { label: 'Verification Outcome', value: 'POSITIVE' },
        { label: 'House Status', value: 'OPENED' },
        { label: 'Final Status', value: 'POSITIVE' },
      ],
    });
    expect(out[1]).toEqual({
      title: 'Met Person & Occupancy',
      fields: [
        { label: 'Met Person Name', value: 'RAJESH' },
        { label: 'Met Person Relation', value: 'SELF' },
        { label: 'Staying Period', value: '5 Years' },
      ],
    });
    expect(out[2]).toEqual({
      title: 'Household & Premises Details',
      fields: [{ label: 'Total Family Members', value: '4' }],
    });
    expect(out[4]).toEqual({
      title: 'Conclusion / Remarks',
      fields: [{ label: 'Field Observation', value: 'All ok' }],
    });
  });

  it('recombines split tenure (<base>Value + <base>Unit) into the named period row, not Additional Details', () => {
    // The v2-native device (ADR-0054) splits every tenure into `<base>Value` + `<base>Unit`; the report
    // section map keys the combined `<base>`. buildSections must recombine so the named row populates and
    // the raw split keys do not spill into the "Additional Details" catch-all (audit A2026-0623-01).
    const out = buildSections({
      residence: {
        formData: {
          houseStatus: 'OPENED',
          metPersonName: 'RAJESH',
          metPersonRelation: 'SELF',
          stayingPeriodValue: '5',
          stayingPeriodUnit: 'Years',
        },
        verificationOutcome: 'POSITIVE',
      },
    });
    const occupancy = out.find((s) => s.title === 'Met Person & Occupancy');
    expect(occupancy?.fields).toContainEqual({ label: 'Staying Period', value: '5 Years' });
    // The raw split keys must NOT leak into "Additional Details".
    expect(out.find((s) => s.title === 'Additional Details')).toBeUndefined();
  });

  it('a submitted key NOT in the map still appears under "Additional Details" (never-lose-a-field)', () => {
    const out = buildSections({
      residence: {
        formData: { houseStatus: 'OPENED', someBrandNewField: 'KEEP-ME', tags: ['a', 'b'] },
        verificationOutcome: 'POSITIVE',
      },
    });
    const additional = out.find((s) => s.title === 'Additional Details');
    expect(additional).toBeDefined();
    expect(additional!.fields).toEqual([
      { label: 'Some Brand New Field', value: 'KEEP-ME' },
      { label: 'Tags', value: 'a, b' },
    ]);
    // The unknown key never collides with mapped placement and the outcome is not duplicated.
    expect(out[0]!.fields).toEqual([
      { label: 'Verification Outcome', value: 'POSITIVE' },
      { label: 'House Status', value: 'OPENED' },
    ]);
  });

  it('empty/absent mapped fields are dropped and empty sections omitted', () => {
    const out = buildSections({
      residence: {
        formData: {
          houseStatus: 'OPENED',
          finalStatus: '', // empty → dropped
          metPersonName: null, // null → dropped, its section empties out
          nested: { deep: 1 }, // nested object → dropped (no Additional Details either)
        },
      },
    });
    // Only the outcome/status section survives (no outcome row, no Met Person section, no Additional).
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      title: 'Verification Outcome & Status',
      fields: [{ label: 'House Status', value: 'OPENED' }],
    });
  });

  it('dedupes an ERT-shared ref to one row (first/non-ERT wins) — property-apf met-person', () => {
    const out = buildSections({
      'property-apf': {
        formData: {
          buildingStatus: 'UNDER_CONSTRUCTION',
          projectName: 'Skyline',
          metPersonName: 'WATCHMAN', // shared by "Met Person Name" + "Name of Met Person (ERT)"
          metPersonDesignation: 'Guard',
        },
        verificationOutcome: 'ERT',
      },
    });
    const titles = out.map((s) => s.title);
    expect(titles).toEqual(['Verification Outcome & Status', 'Project Details', 'Met Person Details']);
    const metPerson = out.find((s) => s.title === 'Met Person Details')!;
    // metPersonName rendered exactly once, under its primary (non-ERT) label.
    expect(metPerson.fields).toEqual([
      { label: 'Met Person Name', value: 'WATCHMAN' },
      { label: 'Met Person Designation', value: 'Guard' },
    ]);
  });

  it('OFFICE blob proves multi-type coverage with mapped grouping', () => {
    const out = buildSections({
      office: {
        formData: {
          officeStatus: 'EXISTS',
          metPersonName: 'PRIYA',
          metPersonDesignation: 'HR',
          workingPeriod: '3 Years',
          companyNatureOfBusiness: 'IT Services',
          contactPerson: 'PRIYA',
        },
        verificationOutcome: 'POSITIVE',
      },
    });
    expect(out.map((s) => s.title)).toEqual([
      'Verification Outcome & Status',
      'Met Person Details',
      'Employment & Office Details',
      'Telephonic Confirmation',
    ]);
    expect(out[0]!.fields[0]).toEqual({ label: 'Verification Outcome', value: 'POSITIVE' });
    expect(out[1]!.fields).toEqual([
      { label: 'Met Person Name', value: 'PRIYA' },
      { label: 'Met Person Designation', value: 'HR' },
    ]);
  });

  it('UNKNOWN/custom slug → generic single-section flatten (no regression)', () => {
    const out = buildSections({
      customForm: { formData: { remark: 'ok', area: 'BTM' }, verificationOutcome: 'POSITIVE' },
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('Custom Form');
    expect(out[0]!.fields).toEqual([
      { label: 'Remark', value: 'ok' },
      { label: 'Area', value: 'BTM' },
      { label: 'Verification Outcome', value: 'POSITIVE' },
    ]);
  });

  it('UNKNOWN slug falls back to the blob itself when there is no nested formData', () => {
    const out = buildSections({ customForm: { remark: 'ok', area: 'BTM' } });
    expect(out[0]!.title).toBe('Custom Form');
    expect(out[0]!.fields).toEqual([
      { label: 'Remark', value: 'ok' },
      { label: 'Area', value: 'BTM' },
    ]);
  });

  it('empty / null / non-object input → no sections; a slug with no usable fields is dropped', () => {
    expect(buildSections(null)).toEqual([]);
    expect(buildSections({})).toEqual([]);
    expect(buildSections({ residence: { photos: [], metadata: {} } })).toEqual([]);
    expect(buildSections({ customForm: { photos: [], metadata: {} } })).toEqual([]);
  });
});

describe('field-report sections — mandatory device fields surface in named sections (not Additional Details)', () => {
  // Per the source-of-truth rule, every field the mobile form emits for a type×outcome is mandatory; an
  // unmapped key falls into the "Additional Details" catch-all. These assert the previously-unmapped keys
  // now map to a named section (audit A2026-0623-14/21/22/23/35/37 + verified siblings).
  const allLabels = (out: ReturnType<typeof buildSections>) =>
    out.flatMap((s) => s.fields.map((f) => f.label));
  const additionalLabels = (out: ReturnType<typeof buildSections>) =>
    out.find((s) => s.title === 'Additional Details')?.fields.map((f) => f.label) ?? [];
  const expectMapped = (out: ReturnType<typeof buildSections>, labels: string[]) => {
    expect(allLabels(out)).toEqual(expect.arrayContaining(labels));
    expect(additionalLabels(out)).toEqual(expect.not.arrayContaining(labels));
  };

  it('residence: addressLocatable maps to a named section (device emits it, 4 outcomes)', () => {
    const out = buildSections({
      residence: {
        formData: { houseStatus: 'Opened', addressLocatable: 'Easily Locatable', metPersonName: 'X' },
        verificationOutcome: 'POSITIVE',
      },
    });
    expectMapped(out, ['Address Locatable']);
  });

  it('office: addressLocatable maps to a named section (device emits it, 4 outcomes)', () => {
    const out = buildSections({
      office: {
        formData: { officeStatus: 'Exists', addressLocatable: 'Easily Locatable', metPersonName: 'X' },
        verificationOutcome: 'POSITIVE',
      },
    });
    expectMapped(out, ['Address Locatable']);
  });

  it('business: addressLocatable, addressStatus, businessExistance (NSP)', () => {
    const out = buildSections({
      business: {
        formData: {
          businessStatus: 'Open',
          addressLocatable: 'Easily Locatable',
          addressStatus: 'Owned',
          businessExistance: 'Exists',
          metPersonName: 'X',
        },
        verificationOutcome: 'POSITIVE',
      },
    });
    expectMapped(out, ['Address Locatable', 'Premises Held Status', 'Business Existence (NSP)']);
  });

  it('noc: addressLocatable, businessExistance (NSP)', () => {
    const out = buildSections({
      noc: {
        formData: {
          officeStatus: 'Exists',
          addressLocatable: 'Easily Locatable',
          businessExistance: 'Exists',
          metPersonName: 'X',
        },
        verificationOutcome: 'NSP',
      },
    });
    expectMapped(out, ['Address Locatable', 'Business Existence (NSP)']);
  });

  it('property-apf: addressLocatable, tpcConfirmation1, tpcConfirmation2', () => {
    const out = buildSections({
      'property-apf': {
        formData: {
          buildingStatus: 'UNDER_CONSTRUCTION',
          addressLocatable: 'Easily Locatable',
          tpcName1: 'A',
          tpcConfirmation1: 'Confirmed',
          tpcName2: 'B',
          tpcConfirmation2: 'Confirmed',
        },
        verificationOutcome: 'POSITIVE',
      },
    });
    expectMapped(out, ['Address Locatable', 'TPC 1 Confirmation', 'TPC 2 Confirmation']);
  });

  it('property-individual: flatStatus, addressLocatable', () => {
    const out = buildSections({
      'property-individual': {
        formData: {
          buildingStatus: 'OCCUPIED',
          flatStatus: 'Occupied',
          addressLocatable: 'Easily Locatable',
          metPersonName: 'X',
        },
        verificationOutcome: 'POSITIVE',
      },
    });
    expectMapped(out, ['Flat Status', 'Address Locatable']);
  });

  it('builder: addressLocatable, businessExistance (NSP)', () => {
    const out = buildSections({
      builder: {
        formData: {
          officeStatus: 'Exists',
          addressLocatable: 'Easily Locatable',
          businessExistance: 'Exists',
          metPersonName: 'X',
        },
        verificationOutcome: 'NSP',
      },
    });
    expectMapped(out, ['Address Locatable', 'Business Existence (NSP)']);
  });

  it('dsa-connector: addressLocatable, businessExistance (NSP)', () => {
    const out = buildSections({
      'dsa-connector': {
        formData: {
          officeStatus: 'Exists',
          addressLocatable: 'Easily Locatable',
          businessExistance: 'Exists',
          metPersonName: 'X',
        },
        verificationOutcome: 'NSP',
      },
    });
    expectMapped(out, ['Address Locatable', 'Business Existence (NSP)']);
  });

  it('residence-cum-office: officeApproxArea (area key fix), documentType, addressLocatable', () => {
    const out = buildSections({
      'residence-cum-office': {
        formData: {
          resiCumOfficeStatus: 'Open',
          officeApproxArea: 500,
          documentType: 'Aadhaar',
          addressLocatable: 'Easily Locatable',
          businessStatus: 'Open',
          documentShown: 'Showed',
          metPersonName: 'X',
        },
        verificationOutcome: 'POSITIVE',
      },
    });
    // Approx Area now reads the device key officeApproxArea (was approxArea); documentType + addressLocatable mapped.
    expectMapped(out, ['Approx Area', 'Document Type', 'Address Locatable']);
  });
});
