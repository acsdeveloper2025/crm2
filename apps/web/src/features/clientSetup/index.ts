// Public surface of the client-setup feature. Other features import from here (never the
// internal modules directly) — enforced by the no-cross-feature-internals boundary.
export { safeReturnTo, exitPath } from './hubState.js';
export { withClientFilter, newRecordHref, bulkRecordHref } from './embed.js';
export type { EmbeddedPageProps } from './embed.js';
