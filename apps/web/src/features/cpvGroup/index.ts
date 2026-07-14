// Public surface of the CPV-group feature — the shared "pick many products × many verification
// units for one client" building blocks. Other features import from here (never the internal
// modules directly) — enforced by the no-cross-feature-internals boundary.
export { pairKey, resolvePairs, unitOptionIds, retainUnits, toggleUniversalExclusive } from './pairs.js';
export type { Pair } from './pairs.js';
export { PairPicker } from './PairPicker.js';
