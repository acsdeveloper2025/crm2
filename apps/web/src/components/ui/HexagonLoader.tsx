/**
 * The Hexagon Loader (PAGINATION_AND_LOADING_STANDARDS §7/§8; UI_STANDARDS) — the ONE
 * platform loader. Forbidden alternatives: spinning circles, progress bars, bouncing dots.
 *
 * Two modes, by design:
 *  - **Determinate** (`percent` given): a hexagon outline fills to a REAL percentage with the
 *    operation + optional sub-step. Use ONLY where genuine work stages exist (report generation,
 *    MIS/export jobs, case creation — §8 stage maps). Never pass an animated guess.
 *  - **Indeterminate** (`percent` omitted): a segment marches the hexagon outline with just the
 *    operation label. Use for single-stage waits (a list fetch has no knowable progress) — this
 *    honors §8 ("never a fake percentage") rather than inventing a number for the §6 1–3s band.
 */
const HEX_POINTS = '24,4 41.32,14 41.32,34 24,44 6.68,34 6.68,14';
const PATH_LENGTH = 100;

export function HexagonLoader({
  operation,
  percent,
  subStep,
}: {
  operation?: string;
  /** 0–100. Omit for an indeterminate loader — never fabricate a value (§8). */
  percent?: number;
  subStep?: string;
}) {
  const determinate = percent !== undefined;
  const value = determinate ? Math.max(0, Math.min(PATH_LENGTH, Math.round(percent))) : 0;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={operation ?? 'Loading'}
      className="flex flex-col items-center justify-center gap-2 py-8 text-center"
    >
      <div className="relative h-12 w-12">
        <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" aria-hidden="true">
          <polygon points={HEX_POINTS} className="stroke-border" strokeWidth="3" />
          <polygon
            points={HEX_POINTS}
            pathLength={PATH_LENGTH}
            className={`stroke-primary ${determinate ? 'hex-fill' : 'hex-march'}`}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={determinate ? String(PATH_LENGTH) : '25 75'}
            strokeDashoffset={determinate ? PATH_LENGTH - value : 0}
          />
        </svg>
        {determinate && (
          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums text-foreground">
            {value}%
          </span>
        )}
      </div>
      {operation && <p className="text-sm font-medium text-foreground">{operation}</p>}
      {subStep && <p className="text-xs text-muted-foreground">{subStep}</p>}
    </div>
  );
}
