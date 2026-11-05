/** Immutable-note envelope and repository contracts; validated reads discriminate readiness explicitly. */
import type { Graph, LibraryScope } from '../domain/contracts.mts';

/** Signed canonical snapshot fragment. */
export interface RecordEnvelope {
  format: 'reference-relationships/record'; schema: 1; index: number; data: string; hash: string;
}
/** Immutable fragment identity as bound by a manifest. */
export interface RecordReference { key: string; hash: string; index: number }
/** Manifest payload; constructors sort references before signing. */
export interface CommitFields {
  parents: string[]; records: RecordReference[]; snapshotHash: string; bytes: number; createdAt: string;
}
/** Signed complete snapshot manifest. */
export interface CommitEnvelope extends CommitFields {
  format: 'reference-relationships/commit'; schema: 1; hash: string;
}
/** Validated production note body. */
export type Envelope = RecordEnvelope | CommitEnvelope;
/** Observed note content is untrusted until all envelope and history checks pass. */
export interface NoteObservation { key: string; body: unknown }
/** Readiness is established only after all references and ancestry arrive. */
export type RepositoryState = { state: 'uninitialized' }
  | { state: 'pending'; missing: string[]; previousHeads: string[] }
  | { state: 'conflict'; heads: string[] }
  | { state: 'ready'; head: string; snapshot: Graph };
/** One physical authority note, including rendered bytes used for observation bounds. */
export interface PhysicalNote { key: string; body: Record<string, unknown>; html: string }
/** Native transaction transport shared by strict writers and independently scheduled events. */
export interface NoteTransport {
  identity: object; scope: LibraryScope;
  scan(): Promise<PhysicalNote[]>;
  get(key: string): Promise<PhysicalNote | null>;
  create(body: Envelope): Promise<string>;
  transaction<T>(action: () => Promise<T>): Promise<T>;
  transactionFromEvent<T>(action: () => Promise<T>): Promise<T>;
  assertWritable(): void;
}
