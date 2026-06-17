import { useEffect, useState } from 'react';

/**
 * The loading-experience time bands (PAGINATION_AND_LOADING_STANDARDS §6). While a load is
 * `active`, returns which band has elapsed:
 *  - `none`     0–300 ms  → render nothing (avoid flicker)
 *  - `skeleton` 300 ms–1 s → skeleton rows
 *  - `loader`   1–3 s      → the Hexagon Loader
 *  - `loader-op`≥3 s       → the Hexagon Loader + current-operation text
 * (`> 8 s` is a background job — §10, a later phase.) Resets to `none` when inactive.
 */
export type LoadingBand = 'none' | 'skeleton' | 'loader' | 'loader-op';

const SKELETON_AFTER_MS = 300;
const LOADER_AFTER_MS = 1000;
const LOADER_OP_AFTER_MS = 3000;

export function useLoadingBand(active: boolean): LoadingBand {
  const [band, setBand] = useState<LoadingBand>('none');
  useEffect(() => {
    if (!active) {
      setBand('none');
      return;
    }
    setBand('none');
    const t1 = setTimeout(() => setBand('skeleton'), SKELETON_AFTER_MS);
    const t2 = setTimeout(() => setBand('loader'), LOADER_AFTER_MS);
    const t3 = setTimeout(() => setBand('loader-op'), LOADER_OP_AFTER_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [active]);
  return band;
}
