/** Stateless immutable-history observation: verify every authority and expose only complete generations. */
import { ContractError, check, exact } from '../domain/values.mts';
import { validateGraph } from '../domain/graph-contract.mts';
import { canonicalJSON } from './canonical.mts';
import { verifyEnvelope } from './envelopes.mts';
import { renderNote } from './chunks.mts';
import type { Digest, Graph } from '../domain/contracts.mts';
import type { CommitEnvelope, RecordEnvelope, RepositoryState } from './contracts.mts';

const encoder = new TextEncoder();

/** Require an integrity invariant. @param {boolean} condition Required fact.
 * @param {string} key Affected authority. @param {string} reason Diagnostic. @returns {void} Throws storage. */
function integrity(condition: unknown, key: unknown, reason: string): asserts condition {
  if (!condition) throw new ContractError('storage', reason, { key, reason });
}

/** Annotate observed-data errors. @param {Error} error Cause. @param {string} key Authority.
 * @returns {ContractError} Storage, unsupported-schema or limit with authority diagnostics. */
function observedError(error: unknown, key: unknown): ContractError {
  const code = error instanceof ContractError && ['limit', 'unsupported-schema'].includes(error.code) ? error.code : 'storage';
  const message = error instanceof Error ? error.message : String(error);
  return new ContractError(code, message, { ...(error instanceof ContractError ? error.details : {}), key, reason: message });
}

/** Validate a native identity. @param {*} key Candidate. @returns {boolean} Strict key. */
function nativeKey(key: unknown): key is string { return typeof key === 'string' && key.length === 8 && /^[A-Z0-9]{8}$/u.test(key); }

/**
 * Capture the entire bounded observation synchronously, before invoking any asynchronous digest.
 * @param {object[]} commits Commit {key,body} entries. @param {object[]} records Record entries.
 * @returns {object[]} Detached entries with their expected kind, all render/history limits checked.
 */
function capture(commits: unknown, records: unknown): { key: string; body: unknown; kind: 'commit' | 'record' }[] {
  check(Array.isArray(commits) && Array.isArray(records), 'Expected observed note arrays', 'storage');
  check(commits.length + records.length <= 4096, 'Observed authority count exceeds 4096', 'limit');
  const entries: { key: string; body: unknown; kind: 'commit' | 'record' }[] = [], keys = new Set<string>();
  let bytes = 0;
  for (const [notes, kind] of [[commits, 'commit'], [records, 'record']] as const) {
    for (const note of notes) {
      let key: unknown;
      try {
        exact(note, ['key', 'body']);
        key = note.key;
        integrity(nativeKey(key), key, 'Invalid observed authority key');
        integrity(!keys.has(key), key, 'Duplicate observed authority key'); keys.add(key);
        const body: unknown = JSON.parse(canonicalJSON(note.body));
        bytes += encoder.encode(renderNote(body)).byteLength;
        check(bytes <= 32 * 1024 * 1024, 'Rendered authority history exceeds 32 MiB', 'limit');
        entries.push({ key, body, kind });
      } catch (error) { throw observedError(error, key); }
    }
  }
  return entries;
}

/**
 * Assemble and validate one complete payload, independent of whether its ancestry has arrived.
 * @param {string} key Manifest key. @param {object} commit Verified manifest.
 * @param {Map} records Verified record bodies. @param {Function} digest SHA-256 provider.
 * @param {string|undefined} expectedLibrary Containing-library binding, when supplied.
 * @returns {Promise<object>} Detached canonical graph; throws an annotated integrity failure.
 */
async function assemble(key: string, commit: CommitEnvelope, records: Map<string, RecordEnvelope>, digest: Digest, expectedLibrary: string | undefined): Promise<Graph> {
  try {
    const fragments = [];
    let bytes = 0;
    for (const ref of commit.records) {
      const record = records.get(ref.key)!;
      bytes += encoder.encode(record.data).byteLength;
      check(bytes <= 1_048_576, 'Assembled snapshot exceeds 1 MiB', 'limit');
      fragments.push(record.data);
    }
    integrity(bytes === commit.bytes, key, 'Snapshot byte count mismatch');
    const text = fragments.join('');
    integrity(await digest(text) === commit.snapshotHash, key, 'Snapshot SHA-256 mismatch');
    const snapshot: unknown = JSON.parse(text);
    integrity(canonicalJSON(snapshot) === text, key, 'Snapshot text is not canonical JSON');
    const validated = validateGraph(snapshot);
    integrity(expectedLibrary === undefined || validated.library === expectedLibrary,
      key, 'Historical snapshot belongs to another library');
    return validated;
  } catch (error) { throw observedError(error, key); }
}

/**
 * Verify all notes, references, available payloads and the complete ancestry DAG before state projection.
 * @param {object[]} commits Commit observations. @param {object[]} records Record observations.
 * @param {Function} digest Explicit real SHA-256 UTF-8 provider.
 * @param {string|undefined} expectedLibrary Optional containing-library binding for all generations.
 * @returns {Promise<object>} Verified maps, completeness, sorted missing keys and maximal heads.
 */
async function inspect(commits: unknown, records: unknown, digest: Digest, expectedLibrary: string | undefined) {
  check(typeof digest === 'function', 'Explicit SHA-256 digest provider required');
  const entries = capture(commits, records);
  const commitMap = new Map<string, CommitEnvelope>(), recordMap = new Map<string, RecordEnvelope>();
  for (const entry of entries) {
    try {
      const body = await verifyEnvelope(entry.body, digest);
      integrity(body.format === `reference-relationships/${entry.kind}`, entry.key, 'Authority is stored in the wrong kind collection');
      if (body.format === 'reference-relationships/commit') commitMap.set(entry.key, body);
      else recordMap.set(entry.key, body);
    } catch (error) { throw observedError(error, entry.key); }
  }
  const missing = new Set<string>(), children = new Map<string, string[]>();
  const remaining = new Map<string, number>(), snapshots = new Map<string, Graph>();
  const roles = new Map<string, string>(entries.map(entry => [entry.key, entry.kind]));
  /** Require an unambiguous identity even before arrival. @param {string} target Referenced key.
   * @param {string} kind Required kind. @param {string} owner Referring manifest. @returns {void} Throws storage. */
  function claim(target: string, kind: string, owner: string) {
    integrity(!roles.has(target) || roles.get(target) === kind, owner, `Authority key has conflicting roles: ${target}`);
    roles.set(target, kind);
  }
  for (const [key, body] of commitMap) {
    let arrived = true;
    for (const parent of body.parents) {
      claim(parent, 'commit', key);
      integrity(!recordMap.has(parent), key, `Parent key is a record: ${parent}`);
      if (!commitMap.has(parent)) missing.add(parent);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent)!.push(key);
    }
    remaining.set(key, body.parents.filter(parent => commitMap.has(parent)).length);
    for (const ref of body.records) {
      claim(ref.key, 'record', key);
      integrity(!commitMap.has(ref.key), key, `Record key is a commit: ${ref.key}`);
      const record = recordMap.get(ref.key);
      if (!record) { missing.add(ref.key); arrived = false; }
      else {
        integrity(record.index === ref.index, ref.key, 'Referenced record index mismatch');
        integrity(record.hash === ref.hash, ref.key, 'Referenced record SHA-256 mismatch');
      }
    }
    if (arrived) snapshots.set(key, await assemble(key, body, recordMap, digest, expectedLibrary));
  }
  const queue = [...remaining].filter(([, count]) => count === 0).map(([key]) => key);
  const complete = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const key = queue[index];
    if (snapshots.has(key) && commitMap.get(key)!.parents.every(parent => complete.has(parent))) complete.add(key);
    if (!children.has(key)) continue;
    for (const child of children.get(key)!) {
      remaining.set(child, remaining.get(child)! - 1);
      if (remaining.get(child) === 0) queue.push(child);
    }
  }
  if (queue.length !== commitMap.size) {
    const key = [...remaining.keys()].find(candidate => remaining.get(candidate)! > 0);
    throw new ContractError('storage', 'Commit ancestry contains a cycle', { key, reason: 'Commit ancestry contains a cycle' });
  }
  const heads = [...commitMap.keys()].filter(key => !children.has(key)).sort();
  const previousHeads = [...complete].filter(key => !children.has(key)
    || !children.get(key)!.some(child => complete.has(child))).sort();
  return { count: entries.length, missing: [...missing].sort(), heads, previousHeads, complete, snapshots };
}

/**
 * Read immutable observations for one containing library; no hidden state is retained across restarts.
 * Every supplied authority, including orphans and historical payloads, is validated before classification.
 * Selected native-library binding/permissions remain repository responsibilities.
 * @param {Array<{key:string,body:object}>} commits All observed commit notes.
 * @param {Array<{key:string,body:object}>} records All observed record notes.
 * @param {Function} digest Required real SHA-256 UTF-8 provider.
 * @param {string|undefined} expectedLibrary Optional binding applied to every assembled ancestor.
 * @returns {Promise<object>} Exact uninitialized, pending {missing,previousHeads}, conflict {heads},
 * or ready {head,snapshot}; failures are typed and include affected authority keys.
 */
export async function observe(commits: unknown, records: unknown, digest: Digest, expectedLibrary?: string): Promise<RepositoryState> {
  const history = await inspect(commits, records, digest, expectedLibrary);
  if (history.count === 0) return { state: 'uninitialized' };
  if (history.missing.length || history.heads.length === 0) {
    return { state: 'pending', missing: history.missing, previousHeads: history.previousHeads };
  }
  if (history.heads.length > 1) return { state: 'conflict', heads: history.heads };
  const head = history.heads[0];
  return { state: 'ready', head, snapshot: history.snapshots.get(head)! };
}

/**
 * Read a named complete generation for history/conflict review, validating the full observation first.
 * Unrelated missing arrivals are allowed; corruption anywhere and incompleteness in this head's ancestry fail.
 * @param {string} head Native manifest key, including historical/noncurrent heads.
 * @param {Array<{key:string,body:object}>} commits Observed manifests.
 * @param {Array<{key:string,body:object}>} records Observed record bodies.
 * @param {Function} digest Required real SHA-256 UTF-8 provider.
 * @param {string|undefined} expectedLibrary Optional binding applied throughout the observed history.
 * @returns {Promise<object>} Exact {head,snapshot}; never claims that the generation is current.
 */
export async function readGeneration(head: string, commits: unknown, records: unknown, digest: Digest, expectedLibrary?: string): Promise<{ head: string; snapshot: Graph }> {
  const history = await inspect(commits, records, digest, expectedLibrary);
  integrity(nativeKey(head) && history.complete.has(head), head, 'Requested generation is unknown or incomplete');
  return { head, snapshot: history.snapshots.get(head)! };
}
