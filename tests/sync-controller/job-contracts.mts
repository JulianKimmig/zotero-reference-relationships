/** Synthetic native job data; optional fields belong to restart, branch and recovery phases rather than every action. */
import type { Graph } from '../../src/domain/contracts.mts';
import type { RepositoryState } from '../../src/storage/contracts.mts';
import type { SourceOwner } from '../../src/transfer/contracts.mts';
import type { TestGroups } from '../../scripts/contracts.mts';

/** The independent-process runner serializes only public fixture identity and test authority. */
export interface ControllerJob {
  domainURI?: string; workloads?: Graph[];
  keys?: { personal: string; shared: string; restricted: string };
  action: string; groups: TestGroups; marker: string;
  state?: 'pending' | 'running'; profile?: string; data?: string; result?: string;
  xpi?: string; sourceURI?: string; branch?: string; fixtures?: Record<string, string>;
  a?: string; b?: string; c?: string; d?: string; source?: string; target?: string; second?: string;
  note?: string; editedNote?: string; noteKey?: string; root?: string; manual?: string; assertionID?: string;
  personal?: RepositoryState; keep?: RepositoryState; noteText?: string;
  before?: RepositoryState; snapshot?: Graph; current?: Graph; original?: Graph; resolvedSnapshot?: Graph; beforeMigration?: Graph;
  currentHead?: string; expectedHeads?: string[]; count?: number;
  ordinary?: string; ordinaryText?: string; removedSource?: string; removedState?: Extract<RepositoryState, { state: 'ready' }>;
  originalKey?: string; survivorKey?: string; erasedKey?: string; undoOriginalKey?: string; orphan?: string;
  undoNoteKey?: string; undoHash?: string; localURI?: string; recordHash?: string; itemKey?: string; expectedUserID?: number;
  owner?: SourceOwner; group?: SourceOwner; ambiguous?: { selected: string }; sync?: boolean; canonical?: string;
}
