/** Immutable graph repository with shared writer serialization and native transaction ownership. */
import { ContractError, check } from '../domain/values.mts';
import { validateGraph } from '../domain/graph-contract.mts';
import { chunkSnapshot, renderNote } from './chunks.mts';
import { makeCommit } from './envelopes.mts';
import { observe, readGeneration } from './observation.mts';
import { buildAdjacency, queryAdjacency } from './adjacency.mts';
import { errorMessage } from '../domain/failures.mts';
import type { Digest, Graph } from '../domain/contracts.mts';
import type { Page } from '../domain/pagination.mts';
import type { NoteObservation, NoteTransport, RepositoryState } from './contracts.mts';

const queues = new WeakMap<object, Promise<void>>();
const published = new WeakMap<object, { head: string; index: ReturnType<typeof buildAdjacency> }>();
const encoder = new TextEncoder();

/** Serialize mutations without hiding a preceding operation's error from its caller. @param {object} identity Stable native library. @param {Function} action Operation. @returns {Promise<*>} Operation result. */
async function serialize<T>(identity: object, action: () => Promise<T>): Promise<T> {
  const preceding = queues.get(identity);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  queues.set(identity, gate);
  if (preceding) await preceding;
  try { return await action(); }
  finally { release(); if (queues.get(identity) === gate) queues.delete(identity); }
}

/** Convert external platform failures without replacing meaningful domain diagnostics. @param {Error} error Failure. @returns {Error} Public failure. */
function storageError(error: unknown): Error {
  return error instanceof ContractError ? error : new ContractError('storage', errorMessage(error), { name: error instanceof Error ? error.name : typeof error });
}

/**
 * One library's versioned authority, transported by real native standalone notes.
 * No successful snapshot cache precedes transaction completion. Native item
 * eligibility beyond library scope belongs to the application gateway.
 */
export class GraphRepository {
  readonly transport: NoteTransport;
  readonly digest: Digest;
  readonly now: () => string | Promise<string>;
  /** Bind explicit platform transport, digest and clock. @param {object} options {transport,digest,now}; now may return a timestamp promise. */
  constructor({ transport, digest, now }: { transport: NoteTransport; digest: Digest; now: () => string | Promise<string> }) {
    check(!!transport && typeof transport.identity === 'object' && transport.identity !== null, 'Stable transport identity required');
    for (const method of ['scan', 'get', 'create', 'transaction', 'assertWritable'] as const) check(typeof transport[method] === 'function', `Missing transport ${method}`);
    check(typeof digest === 'function' && typeof now === 'function', 'Explicit digest and clock required');
    this.transport = transport; this.digest = digest; this.now = now;
  }

  /** Read every authority envelope and follow exact references, detecting modified known notes. @returns {Promise<object>} Complete bounded observation. */
  async observation() {
    const entries = await this.transport.scan(), byKey = new Map(entries.map(entry => [entry.key, entry]));
    check(byKey.size === entries.length, 'Duplicate physical authority keys', 'storage');
    let bytes = 0;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]; bytes += encoder.encode(entry.html).byteLength;
      check(entries.length <= 4096 && bytes <= 33_554_432, 'Authority history exceeds observation bounds', 'limit');
      if (entry.body.format !== 'reference-relationships/commit') continue;
      const references = [...(Array.isArray(entry.body.parents) ? entry.body.parents : []),
        ...(Array.isArray(entry.body.records) ? entry.body.records.map(ref => ref?.key) : [])];
      for (const key of references) {
        if (typeof key !== 'string' || byKey.has(key)) continue;
        const loaded = await this.transport.get(key);
        if (loaded) { byKey.set(key, loaded); entries.push(loaded); }
      }
    }
    const commits: NoteObservation[] = [], records: NoteObservation[] = [];
    for (const { key, body } of entries) {
      if (body.format === 'reference-relationships/commit') commits.push({ key, body });
      else if (body.format === 'reference-relationships/record') records.push({ key, body });
      else throw new ContractError('unsupported-schema', `Unknown authority format ${body.format}`, { key });
    }
    return { commits, records };
  }

  /** Validate a current or historical snapshot's containing-library binding. @param {object} state State with optional snapshot. @returns {object} Valid state. */
  bind<T extends RepositoryState | { head: string; snapshot: Graph }>(state: T): T {
    if ('snapshot' in state) check(state.snapshot.library === this.transport.scope, 'Authority snapshot belongs to another library', 'storage');
    return state;
  }

  /** Reconstruct authority under an already held writer/read queue. @returns {Promise<object>} Unpublished read state. */
  async #readCurrent(): Promise<RepositoryState> {
    try {
      const { commits, records } = await this.observation();
      return this.bind(await observe(commits, records, this.digest, this.transport.scope));
    } catch (error) {
      this.invalidate();
      if (error instanceof ContractError && error.code === 'validation') throw new ContractError('storage', error.message, error.details);
      throw storageError(error);
    }
  }

  /** Clear the process-shared library index after native changes. @returns {void} */
  invalidate() { published.delete(this.transport.identity); }

  /** Read after owned writers finish, publishing only a validated complete generation. @returns {Promise<object>} Fresh repository read state. */
  async read() {
    return serialize(this.transport.identity, async () => {
      const state = await this.#readCurrent();
      if (state.state === 'ready') published.set(this.transport.identity, { head: state.head, index: buildAdjacency(state.snapshot) });
      else this.invalidate();
      return state;
    });
  }

  /** Query the shared last-validated revision without storage scans. @param {object} itemRef Endpoint. @param {string} expectedRevision Explicit validated head. @param {string} direction outgoing/incoming/both. @param {string|null} typeFilter Known type or all. @param {object} page {offset,limit}. @returns {object} Detached {revision,assertions,total,nextOffset}. */
  adjacent(itemRef: unknown, expectedRevision: string, direction: string, typeFilter: string|null, page: Page) {
    const cached = published.get(this.transport.identity);
    check(!!cached && cached.head === expectedRevision, 'Adjacency revision is stale or invalidated; refresh first', 'conflict');
    return { revision: cached.head, ...queryAdjacency(cached.index, itemRef, direction, typeFilter, page) };
  }

  /** Retrieve a complete historical snapshot without calling it current. @param {string} head Exact observed commit key. @returns {Promise<object>} {head,snapshot}. */
  async readHead(head: string) {
    return serialize(this.transport.identity, async () => {
      try {
        const { commits, records } = await this.observation();
        return this.bind(await readGeneration(head, commits, records, this.digest, this.transport.scope));
      } catch (error) { this.invalidate(); throw storageError(error); }
    });
  }

  /** Compare-and-commit one full snapshot after both local writer and native transaction locks. @param {object} snapshot Proposed authority. @param {string|null} expectedRevision Head or null for explicit initialization. @returns {Promise<string>} Committed native manifest key. */
  async compareAndCommit(snapshot: unknown, expectedRevision: string|null) {
    return this.commit(snapshot, expectedRevision, false);
  }

  /** Publish an explicitly reviewed resolution of all observed complete heads. @param {object} snapshot Resolved snapshot. @param {string[]} expectedHeads All conflicting heads. @returns {Promise<string>} Committed manifest key. */
  async resolve(snapshot: unknown, expectedHeads: string[]) {
    check(Array.isArray(expectedHeads) && expectedHeads.length >= 2 &&
      expectedHeads.every(key => typeof key === 'string' && /^[A-Z0-9]{8}$/.test(key)) &&
      new Set(expectedHeads).size === expectedHeads.length, 'Explicit unique conflict heads required');
    return this.commit(snapshot, [...expectedHeads].sort(), true);
  }

  /** Validate data first, then atomically save all fragments and the final manifest. @param {object} snapshot Proposed graph. @param {string|null|string[]} expected Revision(s). @param {boolean} resolution Explicit all-head resolution. @returns {Promise<string>} Published key after actual commit. */
  async commit(snapshot: unknown, expected: string | null | string[], resolution: boolean): Promise<string> {
    const detached = validateGraph(snapshot);
    check(detached.library === this.transport.scope, 'Cannot write a graph into another library', 'validation');
    const index = buildAdjacency(detached);
    const prepared = await chunkSnapshot(detached, this.digest);
    try {
      return await serialize(this.transport.identity, async () => {
        const head = await this.transport.transaction(async () => {
          this.transport.assertWritable();
          const current = await this.#readCurrent();
          let parents: string[];
          if (resolution) {
            check(current.state === 'conflict' && JSON.stringify(current.heads) === JSON.stringify(expected), 'Conflict heads changed; review again', 'conflict');
            parents = expected as string[];
          } else if (expected === null) {
            check(current.state === 'uninitialized', 'Authority is already initialized or incomplete', 'conflict');
            parents = [];
          } else {
            check(current.state === 'ready' && current.head === expected, 'Revision changed; review again', 'conflict');
            parents = [expected as string];
          }
          const records = [];
          for (const body of prepared.records) {
            records.push({ key: await this.transport.create(body), hash: body.hash, index: body.index });
          }
          const body = await makeCommit({ parents, records, snapshotHash: prepared.snapshotHash,
            bytes: prepared.bytes, createdAt: await this.now() }, this.digest);
          // Validate actual manifest size before saving; any error rolls back fragments.
          renderNote(body);
          return this.transport.create(body);
        });
        published.set(this.transport.identity, { head, index });
        return head;
      });
    } catch (error) {
      if (error instanceof ContractError && error.code === 'conflict') this.invalidate();
      throw storageError(error);
    }
  }
}
