import Handlebars from 'handlebars';

/**
 * FIELD_REPORT grammar helpers (ADR-0039 S3) — a faithful port of v1's ~30 derived "smart placeholder"
 * functions (CRM-BACKEND `TemplateReportService.mapFormDataToTemplateVariables`), now exposed as
 * Handlebars helpers so a config template can render grammatically-correct prose from raw form values.
 * Each helper takes variable values as args; the v1 "render empty when source missing" rule + the
 * whitespace-collapse pass (render.ts) keep optional clauses clean.
 *
 * `str()` coerces any arg to a trimmed string and maps objects to '' — this is what makes optional
 * trailing args safe: Handlebars passes its `options` object as the final arg, so a helper called with
 * fewer values than its arity sees `options` (an object) → '' instead of stringifying it.
 */

const str = (x: unknown): string => (x == null || typeof x === 'object' ? '' : String(x));
const lcOf = (x: unknown): string => str(x).toLowerCase();

const ordinal = (n: unknown): string => {
  const num = Number(str(n));
  if (!Number.isFinite(num) || num < 0) return str(n);
  const s = ['th', 'st', 'nd', 'rd'];
  const v = num % 100;
  return `${num}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

const pluralize = (raw: unknown): string => {
  const s = str(raw).trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s+(year|month|day|week)s?$/i);
  if (!m) return s;
  const num = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  const cap = unit.charAt(0).toUpperCase() + unit.slice(1);
  return `${m[1]} ${num === 1 ? cap : `${cap}s`}`;
};

const lc = (s: unknown): string => str(s).toLowerCase();
const capFirst = (s: unknown): string => {
  const v = lc(s);
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : '';
};

const localIso = (d: Date): string => {
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};
/** YYYY-MM-DD from a Date/ISO/string, read as LOCAL calendar parts (never UTC — v1 bug 135). */
const date = (raw: unknown): string => {
  if (raw == null || typeof raw === 'object') return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1]!;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : localIso(d);
};

const area = (raw: unknown): string => {
  const value = Number(str(raw));
  return !Number.isNaN(value) && value > 0 ? `${value} sq. feet` : 'Not provided';
};

/** Nameplate clause: sighted → `<verb> "<name>"`, else `is not sighted`. Door uses the default verb
 *  "shows the name"; society/company boards pass verb "displays". */
const nameplate = (status: unknown, name: unknown, verb?: unknown): string => {
  const sighted = /^sighted/i.test(str(status));
  const v = str(verb) || 'shows the name';
  return sighted ? `${v} "${str(name) || 'N/A'}"` : 'is not sighted';
};

const dominatedArea = (raw: unknown): string => {
  const v = lcOf(raw).trim();
  if (!v) return 'The area dominance is not specified';
  if (v.startsWith('not') || v === 'no') return 'The area is not dominated by any particular community';
  return 'The area is a community-dominated area';
};

const politicalConnection = (raw: unknown): string => {
  const v = lcOf(raw).trim();
  if (!v) return 'Political connection status is not specified';
  if (v.startsWith('not having') || v === 'no')
    return 'The applicant does not have any political connections';
  if (v.startsWith('having') || v === 'yes') return 'The applicant has political connections';
  return `Political connection: ${str(raw)}`;
};

const sittingLocation = (premises: unknown, location: unknown): string => {
  const p = lcOf(premises).trim();
  const l = str(location).trim();
  if (p === 'different location' && l) return `sits at a different location (${l})`;
  if (p === 'different location') return 'sits at a different location';
  if (p === 'same location') return 'sits at the same location as the office';
  if (!p) return 'sits at the office';
  return `sits at ${str(premises)}`;
};

const tpcLabel = (name: unknown, relation: unknown): string => {
  const n = str(name).trim();
  const r = str(relation).trim();
  if (!n) return '';
  return r && r.toLowerCase() !== 'not provided' ? `${n} (${r})` : n;
};

const tpcPair = (p1: unknown, n1: unknown, p2: unknown, n2: unknown): string => {
  const valid = (s: unknown): boolean => {
    const v = str(s).trim();
    return v.length > 0 && v.toLowerCase() !== 'not provided';
  };
  const a = valid(p1) && valid(n1) ? `${str(p1).trim()} ${str(n1).trim()}` : '';
  const b = valid(p2) && valid(n2) ? `${str(p2).trim()} ${str(n2).trim()}` : '';
  if (a && b) return `${a} and ${b}`;
  return a || b || '';
};

const workingStatus = (raw: unknown): string => {
  const v = lcOf(raw).trim();
  if (!v) return 'the applicant working status is not specified';
  if (v.startsWith('applicant is working')) return 'the applicant is working at the given address';
  if (v.startsWith('applicant is shifted') || v.startsWith('applicant has shifted'))
    return 'the applicant has shifted from the given address';
  if (v.startsWith('no such person')) return 'no such person is working at the given address';
  return str(raw).trim();
};

const stayingStatus = (raw: unknown): string => {
  const v = lcOf(raw).trim();
  if (!v) return 'the applicant staying status is not specified';
  if (v.startsWith('applicant is staying')) return 'the applicant is staying at the given address';
  if (v.startsWith('applicant is shifted') || v.startsWith('applicant has shifted'))
    return 'the applicant has shifted from the given address';
  if (v.startsWith('no such person')) return 'no such person is staying at the given address';
  return str(raw).trim();
};

const setup = (raw: unknown): string => {
  const v = lcOf(raw).trim();
  if (!v) return 'not specified';
  if (v.startsWith('sighted')) return 'sighted';
  if (v.startsWith('not sighted')) return 'not sighted';
  return str(raw).trim();
};

const businessLocation = (location: unknown, address: unknown): string => {
  const l = lcOf(location).trim();
  const a = str(address).trim();
  if (l === 'at same address' || l === 'same address') return 'at the same address';
  if (l === 'from different address' || l === 'different address')
    return a ? `from a different address (${a})` : 'from a different address';
  if (!l) return '';
  return `at ${str(location)}`;
};

const documentShown = (status: unknown, docType: unknown): string => {
  const s = lcOf(status).trim();
  const d = str(docType).trim();
  if (
    s.startsWith('did not') ||
    s.startsWith('not ') ||
    s === 'not showed' ||
    s === 'not shown' ||
    s === 'no' ||
    s === 'n'
  )
    return 'the met person did not show any document';
  if (s.startsWith('showed') || s === 'shown' || s === 'yes' || s === 'y')
    return d ? `the met person showed ${d} as identity proof` : 'the met person showed an identity proof';
  if (d) return `the met person showed ${d} as identity proof`;
  return '';
};
const documentShownSentence = (status: unknown, docType: unknown): string => {
  const text = documentShown(status, docType);
  return text ? `During the visit, ${text}.` : '';
};

const addressFloor = (raw: unknown): string => {
  const v = str(raw).trim();
  if (!v) return '';
  const low = v.toLowerCase();
  const floor = low === 'ground' || low === 'g' || v === '0' ? 'ground' : ordinal(v);
  return `The premises is located on the ${floor} floor.`;
};

const metPersonConfirmation = (raw: unknown): string => {
  const v = lcOf(raw).trim();
  return v === 'not confirmed' || v === 'did not confirm' ? 'did not confirm' : 'confirmed';
};

const existsClause = (raw: unknown): string => {
  const v = str(raw).trim();
  return v ? ` — ${v}` : '';
};

const callConfirmation = (raw: unknown): string => {
  const v = lcOf(raw).trim();
  if (v.startsWith('address is shifted')) return 'the applicant informed that the address has been shifted';
  if (v.startsWith('loan cancel')) return 'the applicant informed that the loan has been cancelled';
  if (v.startsWith('already verification'))
    return 'the applicant informed that the verification has already been completed';
  if (v.startsWith('hold for verification'))
    return 'the applicant requested to keep the verification on hold';
  if (v.startsWith('requested to visit another address'))
    return 'the applicant requested us to visit another address';
  if (v.startsWith('request to visit another day'))
    return 'the applicant requested us to visit on another day';
  if (v.startsWith('currently not available'))
    return 'the applicant informed that they are currently not available';
  return 'the applicant confirmed the details over the call';
};

const callRemark = (raw: unknown, confirmation?: unknown): string => {
  const v = lcOf(raw).trim();
  if (!v) return 'the call did not go through';
  if (v.startsWith('did not pick')) return 'the call was not picked up';
  if (v.startsWith('number is switch') || v.startsWith('switched off')) return 'the number was switched off';
  if (v.startsWith('number is unreachable') || v.startsWith('unreachable'))
    return 'the number was unreachable';
  if (v.startsWith('refused to guide')) return 'the customer refused to guide us to the address';
  if (v.startsWith('pickup call')) return callConfirmation(confirmation);
  return lc(raw);
};

const ownershipType = (raw: unknown): string => str(raw).replace(/^(Are|Is)\s+/i, '');

/** "<name> is <status> at <company>." — '' unless all three present (v1 workingProfileText). */
const workingProfile = (customerName: unknown, workingStatus: unknown, companyName: unknown): string => {
  const ws = str(workingStatus).trim();
  const cn = str(companyName).trim();
  const name = str(customerName).trim();
  if (!ws || !cn || !name) return '';
  return `${name} is ${lc(ws)} at ${cn}.`;
};

const currentCompanyOperating = (name: unknown, period: unknown): string => {
  const n = str(name).trim();
  const p = str(period).trim();
  if (!n) return '';
  return p
    ? `${n} is currently operating at the given address for the last ${p}. `
    : `${n} is currently operating at the given address. `;
};

const sentenceClause = (raw: unknown, prefix: unknown, suffix: unknown): string => {
  const v = str(raw).trim();
  return v ? `${str(prefix)}${v}${str(suffix)}` : '';
};

/** APF POSITIVE — verdict-aware met-person sentence (reconciles agent verdict vs construction reality). */
const activityVerdict = (
  activity: unknown,
  status: unknown,
  metPersonName: unknown,
  designation: unknown,
  otherObservation: unknown,
): string => {
  const a = str(activity).toUpperCase().trim();
  const s = lcOf(status).trim();
  const name = str(metPersonName).trim();
  const role = str(designation).trim();
  const obs = str(otherObservation).trim();
  const who = name && role ? `${name} (${role})` : name || role || 'the met person';
  if (a === 'SEEN') {
    if (s === 'positive') return `Met with ${who}, who confirmed the project at the given address.`;
    if (s === 'refer')
      return `Met with ${who} at the project site. The construction was observed, but the case is being referred for further review${obs ? ` — ${obs}` : ''}.`;
    if (s === 'fraud')
      return `Met with ${who} at the project site. Fraud indicators were noted${obs ? ` — ${obs}` : ''}.`;
    return `Met with ${who} at the project site. Despite the construction being observed, the verification was assessed as Negative${obs ? ` — ${obs}` : ''}.`;
  }
  return `Met with ${who} at the given address.`;
};

/** APF NEGATIVE_STOP / NEGATIVE_VACANT — '' when verdict aligns (Negative); else an override clause. */
const verdictOverride = (activity: unknown, status: unknown, otherObservation: unknown): string => {
  const a = str(activity).toUpperCase().trim();
  const s = lcOf(status).trim();
  const obs = str(otherObservation).trim();
  if (s === 'negative' || s === '') return '';
  const tail = obs ? ` — ${obs}` : '';
  const setting = a.includes('VACANT') ? 'the plot being vacant' : 'construction being stopped at the site';
  const sitedNote = a.includes('VACANT')
    ? 'the plot is currently vacant'
    : 'construction is currently stopped at the site';
  if (s === 'positive')
    return ` However, despite ${setting}, the verification was completed as Positive${tail}.`;
  if (s === 'refer') return ` Note: ${sitedNote}. The case is being referred for further review${tail}.`;
  if (s === 'fraud') return ` Note: ${sitedNote}. Fraud indicators were noted${tail}.`;
  return '';
};

const defaultHelper = (value: unknown, fallback: unknown): string => {
  const v = str(value).trim();
  return v || str(fallback);
};

/** APF NEGATIVE split: v1 routes the single "Negative" outcome to the VACANT vs STOP
 *  body by `constructionActivity.includes('VACANT')` (getTemplateKey). Returns a boolean for
 *  `{{#if (apfVacant construction_activity)}}` so one template branch can serve both. */
const apfVacant = (activity: unknown): boolean => str(activity).toUpperCase().includes('VACANT');

/** A shared, isolated Handlebars instance with the FIELD_REPORT helper library registered. */
export const hb: typeof Handlebars = Handlebars.create();

// `{{#eq a b}}…{{/eq}}` (block) and `{{#if (eq a b)}}` (subexpression) — outcome branching.
hb.registerHelper('eq', function (this: unknown, a: unknown, b: unknown, options?: Handlebars.HelperOptions) {
  const equal = a === b;
  if (options && typeof options.fn === 'function') return equal ? options.fn(this) : options.inverse(this);
  return equal;
});

hb.registerHelper({
  ordinal,
  pluralize,
  lc,
  capFirst,
  date,
  area,
  nameplate,
  dominatedArea,
  politicalConnection,
  sittingLocation,
  tpcLabel,
  tpcPair,
  workingStatus,
  stayingStatus,
  setup,
  businessLocation,
  documentShown,
  documentShownSentence,
  addressFloor,
  metPersonConfirmation,
  existsClause,
  callConfirmation,
  callRemark,
  ownershipType,
  workingProfile,
  currentCompanyOperating,
  sentenceClause,
  activityVerdict,
  verdictOverride,
  apfVacant,
  default: defaultHelper,
});
