/** Computed relationship, contributor and native endpoint contracts; these are never synchronized authority. */
import type { Assertion, Edge, ItemRef, Metadata } from './contracts.mts';

/** A generated edge retains the producing rule and immutable explicit root. */
export interface Support extends Edge { root: string; rule: string; version: number; metadata: Metadata }
/** Aggregated ready relationship with complete provenance. */
export interface Relationship extends Edge {
  key: string; metadata: Metadata; assertions: string[]; supports: Support[];
}
/** Stable contributor identity used by field-level conflict witnesses. */
export type ContributorIdentity = { kind: 'assertion'; id: string }
  | { kind: 'support'; root: string; rule: string; version: number };
/** One present primitive value together with its authority identity. */
export type Contributor = ContributorIdentity & { value: Metadata[string] };
/** Private aggregation entry; inspection collectors additionally retain every witness. */
export interface FieldEntry { value: Metadata[string]; contributor: Contributor; contributors?: Contributor[] }
/** Private mutable accumulator owned by exactly one complete evaluation. */
export interface EdgeAccumulator extends Edge {
  key: string; fields: Map<string, FieldEntry>; assertions: Set<string>; supports: Map<string, Support>;
}
/** Endpoint observations distinguish resolvable identities from unresolved native evidence. */
export type EndpointResolution = { original: ItemRef; resolved: ItemRef; status: 'active' | 'trashed' | 'unsupported' }
  | { original: ItemRef; resolved: null; status: 'missing' | 'ambiguous' | 'cyclic' | 'alias-limit' };
/** Detached diagnostic data remains inspectable without inventing aggregate authority. */
export interface Diagnostic { code: string; message: string; details: Record<string, unknown> }
/** Complete original contributor cluster, including all field conflicts. */
export interface ProjectionCluster extends Edge {
  key: string; assertions: { id: string; metadata: Metadata }[]; supports: Support[];
  conflicts: { field: string; contributors: Contributor[] }[];
}
/** Ready and conflicted projections deliberately expose different aggregate availability. */
export type ProjectionReport = {
  state: 'ready'; relationships: Relationship[]; clusters: ProjectionCluster[]; transitions: number; diagnostics: Diagnostic[];
} | {
  state: 'conflict'; relationships: null; clusters: ProjectionCluster[]; transitions: number; diagnostics: Diagnostic[];
} | {
  state: 'endpoint-conflict'; relationships: null; clusters: null; transitions: null; diagnostics: Diagnostic[]; originals: Assertion[];
};
/** Root projection itself has complete endpoint evidence; unresolved alias evidence belongs to its inspection wrapper. */
export type CompleteProjectionReport = Exclude<ProjectionReport, { state: 'endpoint-conflict' }>;
