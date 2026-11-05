/** Immutable feasibility protocol types remain distinct from the production storage schema. */

/** Opaque experiment snapshots may contain any runtime-validated strict JSON value. */
export interface ExperimentRecord<T = unknown> { format: 'rr-feasibility-record/v1'; hash: string; payload: T }
/** Complete experiment manifest references do not use the production chunk codec. */
export interface ExperimentReferences { parents: string[]; records: { key: string; hash: string }[] }
/** Signed feasibility manifest. */
export interface ExperimentCommit extends ExperimentReferences { format: 'rr-feasibility-commit/v1'; hash: string }
/** Raw received note identity with a separately validated body. */
export interface ExperimentNote<T = unknown> { key: string; body: T }
/** Complete and incomplete histories expose different exact evidence. */
export type ExperimentState<T = unknown> = { state: 'pending'; missing: string[]; previousHeads: string[] }
  | { state: 'conflict'; heads: string[] } | { state: 'ready'; head: string; payloads: T[] };
