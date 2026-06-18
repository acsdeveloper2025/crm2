/** Classify an elapsed duration (minutes) into the smallest usable TAT band (hours).
 *  Returns the band's tat_hours, -1 for overflow (> max band), or null if elapsed is null.
 *  `bands` must be ascending usable tat_hours (from tat_policies). */
export function classifyBand(elapsedMinutes: number | null, bands: number[]): number | null {
  if (elapsedMinutes === null || elapsedMinutes === undefined) return null;
  const elapsedHours = elapsedMinutes / 60;
  for (const b of bands) {
    if (elapsedHours <= b) return b;
  }
  return -1;
}
