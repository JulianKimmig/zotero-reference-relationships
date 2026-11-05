/** Actual production repository and native transport resources shared by storage acceptance phases. */
import type { NativeAPI } from './native-api.mts';
import type { GraphRepository } from '../../src/storage/repository.mts';
import type { NoteTransport } from '../../src/storage/contracts.mts';
import type { Digest } from '../../src/domain/contracts.mts';
import type { canonicalJSON } from '../../src/storage/canonical.mts';

/** The runner binds these real objects once; phases supply only external clock behavior. */
export interface StorageContext extends NativeAPI {
  repo: GraphRepository; transport: NoteTransport; libraryID: number;
  repository(now?: () => string | Promise<string>): GraphRepository;
  digest?: Digest; canonicalJSON?: typeof canonicalJSON;
}
