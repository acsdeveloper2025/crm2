/**
 * @crm2/ui-theme — TS token constants. The color VALUES live in tokens.css (the single
 * source); this exposes token NAMES + the workflow-status mapping for chips/charts. FROZEN.
 */

export const cssVar = (name: string): string => `hsl(var(${name}))`;

/** Categorical chart tokens (dashboards). Colorblind-aware, no gradients. */
export const CHART_TOKENS = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
] as const;

/** Semantic feedback tokens. */
export const FEEDBACK_TOKENS = {
  success: '--success',
  warning: '--warning',
  info: '--info',
  destructive: '--destructive',
} as const;

/** The CRM2 task/verification workflow statuses (UPPER_SNAKE domain codes). */
export const WORKFLOW_STATUSES = [
  'PENDING',
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'REVISIT',
] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

/** status code → { label, chip Tailwind classes (soft bg + strong fg + subtle border) }. */
export const STATUS_META: Record<WorkflowStatus, { label: string; chip: string; dot: string }> = {
  PENDING: { label: 'Pending', chip: 'bg-st-pending-bg text-st-pending', dot: 'bg-st-pending' },
  ASSIGNED: { label: 'Assigned', chip: 'bg-st-assigned-bg text-st-assigned', dot: 'bg-st-assigned' },
  IN_PROGRESS: {
    label: 'In Progress',
    chip: 'bg-st-in-progress-bg text-st-in-progress',
    dot: 'bg-st-in-progress',
  },
  SUBMITTED: { label: 'Submitted', chip: 'bg-st-submitted-bg text-st-submitted', dot: 'bg-st-submitted' },
  UNDER_REVIEW: {
    label: 'Under Review',
    chip: 'bg-st-under-review-bg text-st-under-review',
    dot: 'bg-st-under-review',
  },
  APPROVED: { label: 'Approved', chip: 'bg-st-approved-bg text-st-approved', dot: 'bg-st-approved' },
  REJECTED: { label: 'Rejected', chip: 'bg-st-rejected-bg text-st-rejected', dot: 'bg-st-rejected' },
  REVISIT: { label: 'Revisit', chip: 'bg-st-revisit-bg text-st-revisit', dot: 'bg-st-revisit' },
};

/** Chip classes for a status code; falls back to neutral pending styling. */
export const statusChip = (status: string): string =>
  (STATUS_META[status as WorkflowStatus] ?? STATUS_META.PENDING).chip;

/* ===========================================================================
 * UPPERCASE DISPLAY STANDARD — exception model (PERMANENT).
 * The visual uppercase is CSS (tokens.css). Stored values are NEVER transformed.
 * These helpers let components tag case-sensitive data so it renders verbatim
 * (apply CASE_SENSITIVE_CLASS, or render in `font-mono`). docs/UPPERCASE_DISPLAY_STANDARD.md.
 * =========================================================================== */

/** Add to any element whose text must render in its original case. */
export const CASE_SENSITIVE_CLASS = 'case-sensitive';

/** Field name tokens that must ALWAYS preserve case (display + entry). */
export const CASE_SENSITIVE_NAME_TOKENS = [
  'email',
  'mail',
  'password',
  'pwd',
  'username',
  'url',
  'link',
  'website',
  'domain',
  'token',
  'jwt',
  'secret',
  'apikey',
  'otp',
  'pin',
  'hash',
  'checksum',
  'filename',
  'filepath',
  'path',
  // external / regulatory identifiers — meaning is case-significant
  'losid',
  'applicationid',
  'proposalid',
  'bankref',
  'referenceid',
  'externalid',
  'solid',
] as const;

/** HTML input types that must never be uppercased. */
export const CASE_SENSITIVE_INPUT_TYPES = new Set([
  'email',
  'password',
  'url',
  'tel',
  'number',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
  'file',
  'hidden',
  'color',
  'range',
]);

/** True when a field (by name/type) must preserve original case. */
export function isCaseSensitiveField(name?: string, type?: string): boolean {
  if (type && CASE_SENSITIVE_INPUT_TYPES.has(type.toLowerCase())) return true;
  if (!name) return false;
  const fullAlnum = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const segments = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_\-\s]+/)
    .filter(Boolean);
  return CASE_SENSITIVE_NAME_TOKENS.some((t) => fullAlnum === t || segments.includes(t));
}
