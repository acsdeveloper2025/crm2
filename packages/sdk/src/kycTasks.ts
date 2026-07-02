/**
 * KYC-verifier queue (ADR-0085). A self-scoped read model over the verifier's OFFICE tasks with a
 * DERIVED export state: TO_EXPORT (assigned, never exported) vs EXPORTED (a first-export event
 * exists in `task_export_events`). The server owns every column's SQL (code-owned registry, MIS
 * pattern) — the SDK carries column KEYS only. No money columns on this surface.
 */

export const KYC_QUEUE_STATES = ['TO_EXPORT', 'EXPORTED'] as const;
export type KycQueueState = (typeof KYC_QUEUE_STATES)[number];

/** A queue row: values keyed by column key. `documentDetails` is the label→value map. */
export type KycTaskCell = string | number | boolean | null | Record<string, string>;
export type KycTaskRow = Record<string, KycTaskCell>;
