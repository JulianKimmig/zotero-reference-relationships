/** Public synthetic fixture identities carried between independent signed native transfer phases. */
import type { RepositoryState } from '../../src/storage/contracts.mts';
import type { transferSyncContext } from './transfer-sync-context.sys.mts';

/** A verified complete production authority generation. */
export type NativeReady = Extract<RepositoryState, { state: 'ready' }>;
/** Actual shared production/native resources; never a replacement service or store. */
export type TransferSyncContext = Awaited<ReturnType<typeof transferSyncContext>>;
/** Unique additive catalog/rule/root baseline, retaining all earlier shared authority. */
export interface BaselineFixture {
  kind: 'baseline'; state: NativeReady; type: string; inverseType: string; rule: string; sourceKey: string;
}
/** One real production import with complete before/after authority and exact new physical records. */
export interface GenerationFixture {
  kind: 'generation'; baseline: BaselineFixture; before: NativeReady; after: NativeReady;
  records: string[]; withheld: string; assertionIDs: string[];
}
/** Serialized fixture discriminator, checked before phase-specific operations. */
export type TransferSyncFixture = BaselineFixture | GenerationFixture;
/** Personal and unrelated shared authority must survive every controlled group operation unchanged. */
export interface UnrelatedAuthority { personal: RepositoryState; restricted: RepositoryState }
/** Native reports contain typed fixtures and public evidence flags, never credentials. */
export interface TransferSyncReport {
  fixture?: TransferSyncFixture; userID?: number; state?: RepositoryState; scope?: string;
  [field: string]: unknown;
}
