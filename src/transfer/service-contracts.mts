/** Application transfer capabilities preserve native owner, repository and verified filesystem ownership. */
import type { Digest, LibraryScope } from '../domain/contracts.mts';
import type { ApplicationGateway, RepositoryPort, WriteGuard } from '../application/contracts.mts';
import type { ExportEnvelope, SourceOwner, TransferMapping } from './contracts.mts';
import type { TransferFiles } from './file-contracts.mts';
import type { reviewTransfer } from './review.mts';

/** Captured actual library identity must remain current independently of the detached public owner. */
export interface OwnerBinding { owner: SourceOwner; assertCurrent(): void }
/** Actual native ownership reads are independent of write eligibility. */
export interface TransferIdentity { read(scope: string): SourceOwner; capture(scope: string): OwnerBinding }
/** No-op acceptance still owns a real transaction and compares the current ready head. */
export interface TransferRepository extends RepositoryPort { compareAndCheck(expectedRevision: string): Promise<string> }
/** Guarded factory invokes application checks inside its owned transaction, including no-op merges. */
export type TransferRepositoryFactory = (scope: string, guard: WriteGuard | null) => TransferRepository;
/** All dependencies are supplied by native composition; no replacement storage or hidden globals. */
export interface TransferOptions {
  gateway: ApplicationGateway; identity: TransferIdentity; files: TransferFiles;
  repositoryFor: TransferRepositoryFactory; repositoryForEvent: TransferRepositoryFactory;
  digest: Digest; now(): string; invalidate(scope: string): void; yieldToHost(): Promise<void>;
}
/** Complete detached import report is separate from the opaque token returned by preview. */
export type TransferReview = ReturnType<typeof reviewTransfer>;
/** Private mutable binding stays generation-local and is never accepted from callers. */
export interface ImportBinding {
  scope: LibraryScope; owner: OwnerBinding; expectedRevision: string | null; operation: 'merge' | 'replace';
  document: ExportEnvelope; mapping: TransferMapping; review: TransferReview; endpointRevision: string;
  noop: boolean; backup: { path: string; document: ExportEnvelope } | null; busy: boolean;
}
