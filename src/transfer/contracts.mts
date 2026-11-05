/** Portable transfer DTOs distinguish explicit owner and endpoint choices from native acceptance. */
import type { Graph, ItemRef, LibraryScope } from '../domain/contracts.mts';
import type { EndpointResolution } from '../domain/projection-contracts.mts';

/** Public native owner identity, without local numeric library IDs or authentication material. */
export interface SourceOwner { kind: 'user' | 'local-user' | 'group'; id: string }
/** Complete portable authority is integrity-bound independently of its eventual target library. */
export interface ExportEnvelope {
  format: 'reference-relationships/export'; schema: 1; source: SourceOwner; snapshot: Graph; exportedAt: string; hash: string;
}
/** Explicit endpoint choice; retaining an unresolved original never guesses a new identity. */
export interface EndpointMapping { source: ItemRef; target: ItemRef; mode: 'reference' | 'retain' }
/** Every original endpoint must have exactly one explicit mapping row. */
export interface TransferMapping { source: SourceOwner; target: SourceOwner; library: LibraryScope; endpoints: EndpointMapping[] }
/** The real native boundary supplies semantic availability and current write permission. */
export type NativeFact = EndpointResolution & { editable: boolean };
/** Explicitly retained inactive original identity, shown in complete import review. */
export interface RetainedEndpoint { source: ItemRef; target: ItemRef; status: 'missing' | 'trashed' | 'unsupported' }
