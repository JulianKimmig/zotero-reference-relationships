/** Application command, review and gateway ports independent of native host globals. */
import type { Assertion, Digest, Graph, ItemRef, LibraryScope, Metadata, RelationshipType, Rule } from '../domain/contracts.mts';
import type { Diagnostic, EndpointResolution, ProjectionReport, Relationship } from '../domain/projection-contracts.mts';
import type { RepositoryState } from '../storage/contracts.mts';

/** Exact detached collection difference, sorted by stable identity. */
export interface EntityDelta<T> { added: T[]; updated: { before: T; after: T }[]; removed: T[] }
/** Whole-authority review; unresolved before aggregates remain explicitly unavailable. */
export interface ChangeSet {
  assertions: EntityDelta<Assertion>; types: EntityDelta<RelationshipType>; rules: EntityDelta<Rule>;
  derived: EntityDelta<Relationship> | null; diagnostics: Diagnostic[];
}
/** Full-snapshot replacement remains the sole publication command. */
export interface ReplaceCommand { kind: 'replace'; snapshot: Graph }
/** Drafts bind the exact authority generation used to prepare a command. */
export interface Draft { command: ReplaceCommand; expectedRevision: string | null }
/** Plain original assertion input whose identity and timestamps belong to the application. */
export interface AssertionInput { source: ItemRef; target: ItemRef; type: string; metadata: Metadata }
/** Catalog changes require explicit migration decisions. */
export interface TypeChange {
  kind: 'create' | 'update'; type: Omit<RelationshipType, 'version'>;
  migration: { id: string; metadata: Metadata }[] | null;
}
/** Rule deletion and definition editing have different exact input keys. */
export type RuleChange = { kind: 'create' | 'update'; rule: Omit<Rule, 'version'> } | { kind: 'delete'; id: string };
/** Application commands carry their containing library separately from their portable definition. */
export type TypeCommand = TypeChange & { library: LibraryScope };
/** Library-scoped rooted declaration command. */
export type RuleCommand = RuleChange & { library: LibraryScope };
/** Native endpoint evidence includes current permission and display facts. */
export type EndpointInspection = EndpointResolution & { title: string; editable: boolean };
/** Detached selection display facts exclude native IDs. */
export interface EndpointDescription { ref: ItemRef; title: string; status: EndpointResolution['status']; editable: boolean }
/** Item operations required by portable application behavior. */
export interface ApplicationGateway {
  ref(item: { libraryID: number; key: string; isRegularItem(): boolean } | false | null): ItemRef;
  inspect(input: ItemRef): Promise<EndpointInspection>;
  resolve(input: ItemRef): Promise<EndpointResolution>;
  describe(input: ItemRef): Promise<EndpointDescription>;
  assertWritable(scope: string, references: ItemRef[]): Promise<void>;
}
/** Writer guard runs under the repository's native transaction lock. */
export type WriteGuard = () => Promise<void>;
/** Application-owned repository capabilities; persistence details remain storage-owned. */
export interface RepositoryPort {
  read(): Promise<RepositoryState>;
  compareAndCommit(snapshot: Graph, expectedRevision: string | null): Promise<string>;
  invalidate(): void;
}
/** Strict and independent-event factories share the same application guard contract. */
export type RepositoryFactory = (scope: string, guard: WriteGuard | null) => RepositoryPort;
/** Actual application composition dependencies. */
export interface ApplicationOptions {
  gateway: ApplicationGateway; repositoryFor: RepositoryFactory; repositoryForEvent: RepositoryFactory;
  digest: Digest; now: () => string; newID: () => string; yieldToHost(): Promise<void>;
}
/** Selection context remains small and has no whole snapshot. */
export interface SelectionContext {
  state: RepositoryState['state']; revision: string | null; types: RelationshipType[]; editable: boolean; diagnostics: Diagnostic[];
}
/** A complete user-visible receipt is also bound privately to this application generation. */
export interface Review {
  expectedRevision: string | null; snapshot: Graph; changeSet: ChangeSet;
  projection: { before: ProjectionReport; after: Extract<ProjectionReport, { state: 'ready' }> }; endpointRevision: string;
}
/** Successful publication preserves the reviewed whole-authority change set. */
export interface Applied { revision: string; changeSet: ChangeSet }
