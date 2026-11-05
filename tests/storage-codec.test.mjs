/** Production envelope and rendered-note codec tests with real external Node SHA-256. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJSON } from '../src/storage/canonical.mjs';
import { makeRecord, makeCommit, verifyEnvelope } from '../src/storage/envelopes.mjs';
import { renderNote, chunkSnapshot } from '../src/storage/chunks.mjs';
import { graphFixture } from './fixtures/graph-contract.mjs';

const timestamp = '2026-11-05T12:00:00.000Z';
const recordFormat = 'reference-relationships/record';
const commitFormat = 'reference-relationships/commit';

/** Hash actual UTF-8 text. @param {string} text Input. @returns {Promise<string>} SHA-256. */
async function digest(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }

/** Sign arbitrary wire input for negative schema tests. @param {object} body Unsigned body. @returns {Promise<object>} Body. */
async function signed(body) { return { ...body, hash: await digest(canonicalJSON(body)) }; }

/** Make constructor input. @param {object} changes Overrides. @returns {object} Commit fields. */
function commitInput(changes = {}) {
  return { parents: [], records: [{ key: 'RECORD01', hash: 'a'.repeat(64), index: 0 }],
    snapshotHash: 'b'.repeat(64), bytes: 100, createdAt: timestamp, ...changes };
}

/** Match typed error. @param {string} code Category. @returns {Function} Predicate. */
function failure(code) { return error => error.code === code && typeof error.details === 'object'; }

test('record and commit hashes cover every unsigned production field', async () => {
  const record = await makeRecord(0, 'e\u0301😀<&>', digest);
  assert.deepEqual(record, await signed({ format: recordFormat, schema: 1, index: 0, data: 'é😀<&>' }));
  assert.deepEqual(await verifyEnvelope(record, digest), record);
  const input = commitInput({ parents: ['ZZZZZZZZ', 'AAAAAAAA'], records: [
    { key: 'RECORD02', hash: 'c'.repeat(64), index: 1 }, { key: 'RECORD01', hash: record.hash, index: 0 }] });
  const commit = await makeCommit(input, digest);
  assert.deepEqual(commit.parents, ['AAAAAAAA', 'ZZZZZZZZ']);
  assert.deepEqual(commit.records.map(ref => ref.index), [0, 1]);
  assert.deepEqual(commit, await signed({ format: commitFormat, schema: 1, ...input,
    parents: [...input.parents].sort(), records: [...input.records].reverse() }));
  assert.deepEqual(await verifyEnvelope(commit, digest), commit);
  assert.deepEqual(input.parents, ['ZZZZZZZZ', 'AAAAAAAA']);
  assert.equal(input.records[0].index, 1);
});

test('verification returns detached normalized bodies and constructor data are detached', async () => {
  const input = commitInput();
  const body = await makeCommit(input, digest);
  input.records[0].key = 'CHANGED1';
  const verified = await verifyEnvelope(body, digest);
  body.records[0].key = 'CHANGED2';
  assert.equal(verified.records[0].key, 'RECORD01');
  const normalized = await makeRecord(0, 'é', digest);
  assert.equal((await verifyEnvelope({ ...normalized, data: 'e\u0301' }, digest)).data, 'é');
});

test('explicit digest providers and valid lowercase SHA-256 outputs are mandatory', async () => {
  for (const provider of [undefined, null, 1]) {
    await assert.rejects(makeRecord(0, '{}', provider), failure('validation'));
    await assert.rejects(makeCommit(commitInput(), provider), failure('validation'));
    await assert.rejects(verifyEnvelope({}, provider), failure('validation'));
    await assert.rejects(chunkSnapshot(graphFixture(), provider), failure('validation'));
  }
  await assert.rejects(makeRecord(0, '{}', async text => (await digest(text)).toUpperCase()), failure('validation'));
});

test('constructors reject invalid indices, strict JSON, data and exact commit fields', async () => {
  for (const index of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(makeRecord(index, 'a', digest), failure('validation'));
  }
  for (const data of [undefined, null, {}, '\uD800']) {
    await assert.rejects(makeRecord(0, data, digest), failure('validation'));
  }
  await assert.rejects(makeCommit({ ...commitInput(), extra: true }, digest), failure('validation'));
  const absent = commitInput(); delete absent.bytes;
  await assert.rejects(makeCommit(absent, digest), failure('validation'));
});

test('commits require unique native references, contiguous indices and at least one record', async () => {
  for (const changes of [
    { parents: ['AAAAAAAA', 'AAAAAAAA'] }, { parents: ['lowercas'] }, { parents: ['AAAAAAA\n'] },
    { records: [] }, { records: [{ key: 'RECORD01', hash: 'a'.repeat(64), index: 1 }] },
    { records: [{ key: 'RECORD01', hash: 'a'.repeat(64), index: 0, other: 1 }] },
    { records: [{ key: 'RECORD01', hash: 'A'.repeat(64), index: 0 }] },
    { records: [0, 1].map(index => ({ key: 'RECORD01', hash: 'a'.repeat(64), index })) },
    { records: ['RECORD01', 'RECORD02'].map(key => ({ key, hash: 'a'.repeat(64), index: 0 })) },
    { snapshotHash: 'not-a-hash' }, { bytes: 0 }, { bytes: 1.5 },
  ]) await assert.rejects(makeCommit(commitInput(changes), digest), failure('validation'));
  await assert.rejects(makeCommit(commitInput({ bytes: 1_048_577 }), digest), failure('limit'));
  assert.equal((await makeCommit(commitInput({ bytes: 1_048_576 }), digest)).bytes, 1_048_576);
});

test('timestamps require Gregorian UTC millisecond precision', async () => {
  for (const createdAt of ['2026-02-29T12:00:00.000Z', '2026-11-05T24:00:00.000Z',
    '2026-11-05T12:00:00Z', '2026-11-05T12:00:00.000+00:00', '0000-01-01T00:00:00.000Z']) {
    await assert.rejects(makeCommit(commitInput({ createdAt }), digest), failure('validation'));
  }
  for (const createdAt of ['2000-02-29T00:00:00.000Z', '0001-01-01T00:00:00.000Z']) {
    assert.equal((await makeCommit(commitInput({ createdAt }), digest)).createdAt, createdAt);
  }
});

test('stored envelopes require exact fields, known schemas and canonical reference order', async () => {
  const record = await makeRecord(0, '{}', digest);
  await assert.rejects(verifyEnvelope({ ...record, extra: 1 }, digest), failure('storage'));
  await assert.rejects(verifyEnvelope({ ...record, schema: 2 }, digest), failure('unsupported-schema'));
  await assert.rejects(verifyEnvelope({ ...record, format: 'reference-relationships/future' }, digest), failure('unsupported-schema'));
  const badParents = await signed({ format: commitFormat, schema: 1, ...commitInput({ parents: ['ZZZZZZZZ', 'AAAAAAAA'] }) });
  await assert.rejects(verifyEnvelope(badParents, digest), failure('storage'));
  const badRecords = await signed({ format: commitFormat, schema: 1, ...commitInput({ records: [
    { key: 'RECORD02', hash: 'a'.repeat(64), index: 1 }, { key: 'RECORD01', hash: 'a'.repeat(64), index: 0 }] }) });
  await assert.rejects(verifyEnvelope(badRecords, digest), failure('storage'));
});

test('changing any signed field or the digest is an existing-data integrity error', async () => {
  const record = await makeRecord(0, 'hello', digest);
  for (const change of [{ index: 1 }, { data: 'world' }, { hash: '0'.repeat(64) }, { hash: 'A'.repeat(64) }]) {
    await assert.rejects(verifyEnvelope({ ...record, ...change }, digest), failure('storage'));
  }
  const commit = await makeCommit(commitInput(), digest);
  for (const change of [{ parents: ['AAAAAAAA'] }, { bytes: 101 }, { snapshotHash: 'c'.repeat(64) },
    { createdAt: '2026-11-06T12:00:00.000Z' }, { records: [{ ...commit.records[0], key: 'RECORD02' }] }]) {
    await assert.rejects(verifyEnvelope({ ...commit, ...change }, digest), failure('storage'));
  }
});

test('note wrapper is exact and escapes only HTML pre text, with inclusive UTF-8 limit', async () => {
  const record = await makeRecord(0, '<&>😀', digest);
  const wire = canonicalJSON(record).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  assert.equal(renderNote(record), `<div data-schema-version="9"><h1>Reference Relationships data</h1><pre>${wire}</pre></div>`);
  const overhead = Buffer.byteLength(renderNote(await makeRecord(0, '', digest)));
  const exact = await makeRecord(0, 'x'.repeat(32000 - overhead), digest);
  assert.equal(Buffer.byteLength(renderNote(exact)), 32000);
  assert.throws(() => renderNote({ ...exact, data: exact.data + 'x' }), failure('limit'));
});

test('chunking canonicalizes the entire graph and fits actual escaped rendered envelopes', async () => {
  const graph = graphFixture({ assertions: [], rules: [] });
  graph.types = Array.from({ length: 50 }, (_, i) => ({ ...graph.types[0], id: `type-${i}`,
    description: '😀<&>é'.repeat(500) }));
  const chunks = await chunkSnapshot(graph, digest);
  const canonical = canonicalJSON(graph);
  assert.equal(chunks.snapshotHash, await digest(canonical));
  assert.equal(chunks.bytes, Buffer.byteLength(canonical));
  assert.equal(chunks.records.map(body => body.data).join(''), canonical);
  assert(chunks.records.length > 1);
  for (const [index, body] of chunks.records.entries()) {
    assert.equal(body.index, index);
    assert(Buffer.byteLength(renderNote(body)) <= 32000);
    assert.deepEqual(await verifyEnvelope(body, digest), body);
    assert(!/[\uD800-\uDFFF]/u.test(body.data));
  }
});

test('chunking rejects invalid graphs, unsupported schemas and full-snapshot byte overflow', async () => {
  await assert.rejects(chunkSnapshot(graphFixture({ types: [] }), digest), failure('validation'));
  await assert.rejects(chunkSnapshot(graphFixture({ schema: 2 }), digest), failure('unsupported-schema'));
  const graph = graphFixture({ assertions: [] });
  graph.types = Array.from({ length: 64 }, (_, i) => ({ ...graph.types[0], id: `type-${i}`, description: '😀'.repeat(4096) }));
  await assert.rejects(chunkSnapshot(graph, digest), failure('limit'));
});

test('chunkSnapshot detaches all caller data before its first asynchronous digest', async () => {
  const graph = graphFixture();
  const original = canonicalJSON(graph);
  const pending = chunkSnapshot(graph, digest);
  graph.library = 'group:12';
  graph.assertions[0].metadata = { unknown: 'caller mutation' };
  graph.rules.splice(0);
  const result = await pending;
  assert.equal(result.records.map(body => body.data).join(''), original);
  assert.equal(result.snapshotHash, await digest(original));
});
