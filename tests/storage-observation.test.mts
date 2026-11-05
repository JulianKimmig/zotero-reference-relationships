/** Complete immutable generation observation, restart and corruption behavior using real SHA-256. */
import { readyState } from './fixtures/evidence.mts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJSON } from '../src/storage/canonical.mts';
import { makeRecord, makeCommit } from '../src/storage/envelopes.mts';
import { chunkSnapshot } from '../src/storage/chunks.mts';
import { observe, readGeneration } from '../src/storage/observation.mts';
import { graphFixture } from './fixtures/graph-contract.mts';
import { ContractError } from '../src/domain/values.mts';
import type { MetadataField } from '../src/domain/contracts.mts';

const createdAt = '2026-11-05T12:00:00.000Z';

/** Real external hash. @param {string} text UTF-8 input. @returns {Promise<string>} SHA-256. */
async function digest(text: string) { return createHash('sha256').update(text, 'utf8').digest('hex'); }

/** Sign arbitrary wire inputs. @param {object} body Unsigned fields. @returns {Promise<object>} Signed body. */
async function signed<T extends object>(body: T): Promise<T & { hash: string }> { return { ...body, hash: await digest(canonicalJSON(body)) }; }

/** Match typed diagnostics. @param {string} code Error category. @returns {Function} Predicate. */
function failure(code: string) { return (error: unknown): error is ContractError => error instanceof ContractError && error.code === code; }

/** Build one generation. @param {string} key Commit key. @param {string[]} parents Ancestors.
 * @param {object} snapshot Full graph. @returns {Promise<object>} Observed arrays and snapshot. */
async function generation(key: string, parents: string[] = [], snapshot = graphFixture()) {
  const chunked = await chunkSnapshot(snapshot, digest);
  const records = chunked.records.map((body, index) => ({ key: `R${key.slice(1, 5)}${String(index).padStart(3, '0')}`, body }));
  const body = await makeCommit({ parents, records: records.map(note => ({ key: note.key, hash: note.body.hash,
    index: note.body.index })), snapshotHash: chunked.snapshotHash, bytes: chunked.bytes, createdAt }, digest);
  return { commits: [{ key, body }], records, snapshot: JSON.parse(canonicalJSON(snapshot)) };
}

/** Combine generation arrays. @param {...object} groups Observations. @returns {object} Observation. */
function together(...groups: Pick<Awaited<ReturnType<typeof generation>>, 'commits' | 'records'>[]) {
  return { commits: groups.flatMap(group => group.commits), records: groups.flatMap(group => group.records) };
}

/** Evaluate one batch. @param {object} batch Notes. @returns {Promise<object>} Read state. */
async function read(batch: Pick<Awaited<ReturnType<typeof generation>>, 'commits' | 'records'>) { return observe(batch.commits, batch.records, digest); }

/** Replace unsigned fields and recompute actual hash. @param {object} body Signed body.
 * @param {object} changes Overrides. @returns {Promise<object>} Resigned body. */
async function changed<T extends { hash: string }>(body: T, changes: object) {
  const { hash, ...unsigned } = body;
  return signed({ ...unsigned, ...changes });
}

/** Build a signed arbitrary snapshot text. @param {string} text Stored text. @returns {Promise<object>} Batch. */
async function rawSnapshot(text: string) {
  const body = await makeRecord(0, text, digest);
  const commit = await makeCommit({ parents: [], records: [{ key: 'RECORD01', hash: body.hash, index: 0 }],
    snapshotHash: await digest(text), bytes: Buffer.byteLength(text), createdAt }, digest);
  return { commits: [{ key: 'COMMIT01', body: commit }], records: [{ key: 'RECORD01', body }] };
}

test('zero authority alone is uninitialized; record-only observations are pending', async () => {
  assert.deepEqual(await observe([], [], digest), { state: 'uninitialized' });
  const g = await generation('C0001000');
  assert.deepEqual(await observe([], g.records, digest), { state: 'pending', missing: [], previousHeads: [] });
  // @ts-expect-error Deliberately malformed runtime input must still fail validation.
  await assert.rejects(observe([], []), failure('validation'));
});

test('containing-library binding validates ancestral snapshots as well as the current head', async () => {
  const personal = await generation('C0001000');
  const graph = graphFixture({ library: 'group:6749379' });
  for (const root of graph.assertions) root.source.library = root.target.library = graph.library;
  const group = await generation('C0002000', ['C0001000'], graph);
  const batch = together(personal, group);
  await assert.rejects(observe(batch.commits, batch.records, digest, 'group:6749379'), failure('storage'));
  await assert.rejects(readGeneration('C0002000', batch.commits, batch.records, digest, 'group:6749379'), failure('storage'));
});

test('round trips Unicode, all metadata kinds, full catalog/rules and detached snapshots', async () => {
  const graph = graphFixture();
  const kinds = ['string', 'number', 'boolean', 'date', 'enum'] as const;
  graph.types[0].label = 'Re\u0301fe\u0301rence 😀';
  graph.types[0].fields = kinds.map(kind => ({ id: kind, kind, label: kind, required: true,
    options: kind === 'enum' ? ['e\u0301', '😀'] : [] }));
  graph.assertions[0].metadata = { string: '<&>😀 e\u0301', number: -0, boolean: false, date: '2000-02-29', enum: 'é' };
  const g = await generation('C0001000', [], graph);
  const state = await read(g);
  assert.deepEqual(state, { state: 'ready', head: 'C0001000', snapshot: g.snapshot });
  readyState(state).snapshot.types[0].label = 'changed';
  assert.deepEqual(readyState((await read(g))).snapshot, g.snapshot);
});

test('partial delivery and restart require ancestry manifests and every ancestral payload', async () => {
  const a = await generation('C0001000');
  const b = await generation('C0002000', ['C0001000'], graphFixture({ assertions: [] }));
  assert.deepEqual(await read(b), { state: 'pending', missing: ['C0001000'], previousHeads: [] });
  assert.deepEqual(await observe([...a.commits, ...b.commits], b.records, digest), {
    state: 'pending', missing: a.records.map(note => note.key).sort(), previousHeads: [] });
  assert.deepEqual(await observe([...a.commits, ...b.commits], a.records, digest), {
    state: 'pending', missing: b.records.map(note => note.key).sort(), previousHeads: ['C0001000'] });
  assert.deepEqual(await read(together(b, a)), { state: 'ready', head: 'C0002000', snapshot: b.snapshot });
  const c = await generation('C0003000', ['C0002000']);
  assert.deepEqual(await observe([...c.commits, ...b.commits, ...a.commits], a.records, digest), {
    state: 'pending', missing: [...b.records, ...c.records].map(note => note.key).sort(), previousHeads: ['C0001000'] });
});

test('concurrent rule deletion and editing remain forks until resolution parents every head', async () => {
  const a = await generation('C0001000');
  const b = await generation('C0002000', ['C0001000'], graphFixture({ rules: [] }));
  const edited = graphFixture(); edited.rules[0].version = 2; edited.rules[0].enabled = false;
  const c = await generation('C0003000', ['C0001000'], edited);
  const fork = together(a, b, c);
  assert.deepEqual(await read(fork), { state: 'conflict', heads: ['C0002000', 'C0003000'] });
  const partial = await generation('C0004000', ['C0002000']);
  assert.deepEqual(await read(together(fork, partial)), { state: 'conflict', heads: ['C0003000', 'C0004000'] });
  const resolved = await generation('C0005000', ['C0003000', 'C0002000'], graphFixture({ rules: [] }));
  assert.deepEqual(await read(together(fork, resolved)), { state: 'ready', head: 'C0005000', snapshot: resolved.snapshot });
  const empty = await generation('C0006000', ['C0005000'], graphFixture({ assertions: [], rules: [] }));
  assert.equal(readyState((await read(together(fork, resolved, empty)))).snapshot.assertions.length, 0);
});

test('pending exposes maximal complete ancestral heads and never a current snapshot', async () => {
  const a = await generation('C0001000');
  const b = await generation('C0002000', ['C0001000']);
  const c = await generation('C0003000', ['C0001000']);
  const d = await generation('C0004000', ['C0002000', 'C0003000']);
  const notes = together(a, b, c);
  assert.deepEqual(await observe([...notes.commits, ...d.commits], notes.records, digest), {
    state: 'pending', missing: d.records.map(note => note.key), previousHeads: ['C0002000', 'C0003000'] });
});

test('named generation reading allows complete history/forks but cannot claim current', async () => {
  const a = await generation('C0001000');
  const b = await generation('C0002000', ['C0001000']);
  const batch = together(a, b);
  assert.deepEqual(await readGeneration('C0001000', batch.commits, batch.records, digest), { head: 'C0001000', snapshot: a.snapshot });
  await assert.rejects(readGeneration('C0003000', batch.commits, batch.records, digest), failure('storage'));
  await assert.rejects(readGeneration('C0002000', batch.commits, a.records, digest), failure('storage'));
  assert.deepEqual(await readGeneration('C0001000', batch.commits, a.records, digest), { head: 'C0001000', snapshot: a.snapshot });
});

test('valid orphans do not publish a head; corrupt/unknown orphan bodies still fail with authority keys', async () => {
  const a = await generation('C0001000');
  const orphan = { key: 'ORPHAN01', body: await makeRecord(0, 'unpublished fragment', digest) };
  assert.equal(readyState((await observe(a.commits, [...a.records, orphan], digest))).head, 'C0001000');
  for (const [changes, code] of [[{ data: 'corrupt' }, 'storage'], [{ schema: 9 }, 'unsupported-schema'],
    [{ extra: true }, 'storage'], [{ format: 'reference-relationships/record-v2' }, 'unsupported-schema']] as const) {
    await assert.rejects(observe(a.commits, [...a.records, { ...orphan, body: { ...orphan.body, ...changes } }], digest),
      error => failure(code)(error) && error.details.key === 'ORPHAN01');
  }
});

test('validates every commit payload even when a different branch is missing ancestry', async () => {
  const a = await generation('C0001000');
  const b = await generation('C0002000', ['MISSING1']);
  const bad = { ...a.commits[0], body: await changed(a.commits[0].body, { snapshotHash: '0'.repeat(64) }) };
  await assert.rejects(observe([bad, ...b.commits], [...a.records, ...b.records], digest), failure('storage'));
});

test('duplicate keys, invalid note wrappers and wrong-kind references fail before publication', async () => {
  const a = await generation('C0001000');
  await assert.rejects(observe(a.commits, [...a.records, ...a.records], digest), failure('storage'));
  await assert.rejects(observe([...a.commits, ...a.commits], a.records, digest), failure('storage'));
  await assert.rejects(observe(a.commits, [{ ...a.records[0], key: 'C0001000' }], digest), failure('storage'));
  await assert.rejects(observe([{ ...a.commits[0], extra: 1 }], a.records, digest), failure('storage'));
  await assert.rejects(observe([{ ...a.commits[0], key: 'bad' }], a.records, digest), failure('storage'));
  const parentRecord = await changed(a.commits[0].body, { parents: [a.records[0].key] });
  await assert.rejects(observe([{ key: 'C0001000', body: parentRecord }], a.records, digest), failure('storage'));
  const commitRecord = await changed(a.commits[0].body, { records: [{ ...a.commits[0].body.records[0], key: 'C0001000' }] });
  await assert.rejects(observe([{ key: 'C0001000', body: commitRecord }], a.records, digest), failure('storage'));
  await assert.rejects(observe([{ key: 'C0001000', body: a.records[0].body }], [], digest), failure('storage'));
});

test('self-cycles and disconnected cycles are errors even alongside missing records', async () => {
  const a = await generation('C0001000');
  const b = await generation('C0002000');
  for (const parents of [['C0001000'], ['C0002000']]) {
    const first = { key: 'C0001000', body: await changed(a.commits[0].body, { parents }) };
    const second = { key: 'C0002000', body: await changed(b.commits[0].body, { parents: ['C0001000'] }) };
    await assert.rejects(observe([first, second], [], digest), failure('storage'));
  }
});

test('corrupt chunks, manifest hashes, referenced indices and truncated snapshots fail', async () => {
  const a = await generation('C0001000');
  await assert.rejects(observe(a.commits, [{ ...a.records[0], body: { ...a.records[0].body, data: 'bad' } }], digest), failure('storage'));
  await assert.rejects(observe([{ ...a.commits[0], body: { ...a.commits[0].body, bytes: 1 } }], a.records, digest), failure('storage'));
  const indexBody = await makeRecord(1, a.records[0].body.data, digest);
  const indexCommit = await changed(a.commits[0].body, { records: [{ key: a.records[0].key, hash: indexBody.hash, index: 0 }] });
  await assert.rejects(observe([{ key: 'C0001000', body: indexCommit }], [{ key: a.records[0].key, body: indexBody }], digest), failure('storage'));
  for (const changes of [{ bytes: a.commits[0].body.bytes + 1 }, { snapshotHash: '0'.repeat(64) },
    { records: [{ ...a.commits[0].body.records[0], hash: '0'.repeat(64) }] }]) {
    await assert.rejects(observe([{ key: 'C0001000', body: await changed(a.commits[0].body, changes) }], a.records, digest), failure('storage'));
  }
  await assert.rejects(read(await rawSnapshot(canonicalJSON(a.snapshot).slice(0, -1))), failure('storage'));
});

test('snapshot must be canonical complete graph JSON, with unknown graph schemas read-only', async () => {
  await assert.rejects(read(await rawSnapshot(JSON.stringify(graphFixture()))), failure('storage'));
  await assert.rejects(read(await rawSnapshot('{"library":"self"}')), failure('unsupported-schema'));
  // @ts-expect-error Unsupported schema must fail runtime validation.
  await assert.rejects(read(await rawSnapshot(canonicalJSON(graphFixture({ schema: 2 })))), failure('unsupported-schema'));
  await assert.rejects(read(await rawSnapshot(canonicalJSON(graphFixture({ types: [] })))), failure('storage'));
  const text = canonicalJSON(graphFixture()).replace('"schema":1', '"schema":1,"schema":1');
  await assert.rejects(read(await rawSnapshot(text)), failure('storage'));
});

test('multi-record snapshots are assembled in manifest index order under shuffled delivery', async () => {
  const graph = graphFixture({ assertions: [], rules: [] });
  graph.types = Array.from({ length: 10 }, (_, i) => ({ ...graph.types[0], id: `type-${i}`, description: '😀<&>'.repeat(700) }));
  const g = await generation('C0001000', [], graph);
  assert(g.records.length > 1);
  assert.deepEqual(await observe(g.commits, [...g.records].reverse(), digest), { state: 'ready', head: 'C0001000', snapshot: g.snapshot });
});

test('note count and total rendered history have independent strict bounds', async () => {
  const body = await makeRecord(0, '{}', digest);
  const notes = Array.from({ length: 4096 }, (_, index) => ({ key: index.toString(36).toUpperCase().padStart(8, '0'), body }));
  assert.deepEqual(await observe([], notes, digest), { state: 'pending', missing: [], previousHeads: [] });
  await assert.rejects(observe([], [...notes, { key: 'OVER4096', body }], digest), failure('limit'));
  const large = await makeRecord(0, 'x'.repeat(29_000), digest);
  await assert.rejects(observe([], notes.slice(0, 1200).map(note => ({ ...note, body: large })), digest), failure('limit'));
  const oversized = { ...body, data: 'x'.repeat(32_000) };
  await assert.rejects(observe([], [{ key: 'TOOLARGE', body: await changed(oversized, {}) }], digest), failure('limit'));
});

test('independent empty roots conflict and preserve their full snapshots for explicit review', async () => {
  const a = await generation('C0001000', [], graphFixture({ assertions: [], rules: [] }));
  const b = await generation('C0002000', [], graphFixture({ assertions: [], rules: [] }));
  const batch = together(b, a);
  assert.deepEqual(await read(batch), { state: 'conflict', heads: ['C0001000', 'C0002000'] });
  assert.deepEqual(await readGeneration('C0002000', batch.commits, batch.records, digest), { head: 'C0002000', snapshot: b.snapshot });
});

test('observation detaches the complete batch before invoking the first digest', async () => {
  const a = await generation('C0001000');
  const b = await generation('C0002000', ['C0001000']);
  const batch = together(a, b);
  const pending = read(batch);
  batch.commits[1].body.parents = ['MISSING1'];
  batch.records[1].body.data = 'mutated';
  assert.deepEqual(await pending, { state: 'ready', head: 'C0002000', snapshot: b.snapshot });
});

test('a missing native key cannot simultaneously be requested as a parent and a record', async () => {
  const a = await generation('C0001000');
  const body = await changed(a.commits[0].body, { parents: ['ABSENT01'],
    records: [{ ...a.commits[0].body.records[0], key: 'ABSENT01' }] });
  await assert.rejects(observe([{ key: 'C0001000', body }], [], digest), failure('storage'));
});

test('corrupt historical snapshots fail even when a complete descendant replaces all their data', async () => {
  const a = await generation('C0001000');
  const b = await generation('C0002000', ['C0001000'], graphFixture({ assertions: [] }));
  const body = await changed(a.commits[0].body, { snapshotHash: '0'.repeat(64) });
  await assert.rejects(observe([{ key: 'C0001000', body }, ...b.commits], [...a.records, ...b.records], digest),
    error => failure('storage')(error) && error.details.key === 'C0001000');
});
