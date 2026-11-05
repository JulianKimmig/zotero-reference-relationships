/** Portable export envelopes preserve explicit authority and reject untrusted or owner-mismatched payloads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createExport, verifyExport, parseExport } from '../src/transfer/format.mjs';
import { transferGraph, maximumGraph, exportedAt } from './fixtures/transfer.mjs';
import { evaluateGraph } from '../src/domain/evaluate.mjs';
import { validateGraph } from '../src/domain/graph-contract.mjs';

/** Use actual platform SHA-256 rather than a stubbed content identity. @param {string} input Canonical UTF-8 data. @returns {Promise<string>} Actual lowercase SHA-256. */
async function digest(input) { return createHash('sha256').update(input, 'utf8').digest('hex'); }

/** Create one actual valid export using the desired owner binding. @param {object} source Exact canonical owner. @param {string} library Source graph scope. @returns {Promise<object>} Valid hashed envelope. */
async function document(source = { kind: 'user', id: '123' }, library = 'self') {
  return createExport({ source, snapshot: transferGraph(library), exportedAt }, digest);
}

test('export uses the exact hashed envelope and preserves all explicit versions and semantics', async () => {
  const snapshot = transferGraph(), result = await createExport({ source: { kind: 'user', id: '123' }, snapshot, exportedAt }, digest);
  assert.deepEqual(Object.keys(result).sort(), ['exportedAt', 'format', 'hash', 'schema', 'snapshot', 'source']);
  assert.equal(result.format, 'reference-relationships/export'); assert.equal(result.schema, 1);
  assert.match(result.hash, /^[a-f0-9]{64}$/); assert.deepEqual(result.snapshot, validateGraph(snapshot));
  assert.equal(result.snapshot.types[0].version, 7); assert.equal(result.snapshot.rules[0].version, 9);
  assert.deepEqual(evaluateGraph(result.snapshot), evaluateGraph(snapshot));
  result.snapshot.assertions[0].metadata.note = 'caller'; assert.equal(snapshot.assertions[0].metadata.note, 'Café 你好 😀 <b>literal</b>');
});

test('hash covers canonical unsigned JSON rather than the hash field or input property order', async () => {
  const snapshot = { schema: 1, library: 'self', assertions: [], rules: [], types: [
    { id: 'r', label: 'R', description: '', fields: [], retired: false, version: 1 },
  ] };
  const unsigned = '{"exportedAt":"2026-11-05T12:00:00.000Z","format":"reference-relationships/export","schema":1,"snapshot":{"assertions":[],"library":"self","rules":[],"schema":1,"types":[{"description":"","fields":[],"id":"r","label":"R","retired":false,"version":1}]},"source":{"id":"123","kind":"user"}}';
  const result = await createExport({ snapshot, exportedAt, source: { id: '123', kind: 'user' } }, digest);
  assert.equal(result.hash, await digest(unsigned));
  assert.deepEqual(await verifyExport(result, digest), result);
});

for (const source of [{ kind: 'user', id: '1' }, { kind: 'user', id: '999999999999999' }, { kind: 'local-user', id: 'aB2cD3eF' }, { kind: 'group', id: '456' }]) {
  test(`round-trips exact ${source.kind} owner ${source.id} without native numeric item IDs`, async () => {
    const result = await document(source, source.kind === 'group' ? `group:${source.id}` : 'self');
    const parsed = await parseExport(JSON.stringify(result, null, 2), digest); assert.deepEqual(parsed, result);
    assert.deepEqual(parsed.source, source); assert.equal(parsed.snapshot.assertions[0].source.library, parsed.snapshot.library);
  });
}

test('verification normalizes equivalent Unicode/key order and detaches its complete result', async () => {
  const original = await document(), input = Object.fromEntries(Object.entries(original).reverse());
  input.snapshot = structuredClone(original.snapshot); input.snapshot.assertions[0].metadata.note = 'Cafe\u0301 你好 😀 <b>literal</b>';
  const verified = await verifyExport(input, digest); assert.deepEqual(verified, original);
  verified.snapshot.assertions[0].metadata.note = 'caller'; verified.source.id = '456';
  assert.equal(original.snapshot.assertions[0].metadata.note, 'Café 你好 😀 <b>literal</b>'); assert.equal(original.source.id, '123');
});

for (const source of [{ kind: 'user', id: '0' }, { kind: 'user', id: '01' }, { kind: 'group', id: '1000000000000000' },
  { kind: 'user', id: 123 }, { kind: 'user', id: '123\n' }, { kind: 'local-user', id: 'short' },
  { kind: 'local-user', id: 'ÄB2cD3eF' }, { kind: 'unknown', id: '123' }, { kind: 'user', id: '123', extra: true }]) {
  test(`rejects noncanonical source identity ${JSON.stringify(source)}`, async () => {
    await assert.rejects(() => document(source), { code: 'validation' });
  });
}

test('requires the exact source owner kind and group scope binding', async () => {
  await assert.rejects(() => document({ kind: 'group', id: '456' }, 'self'), { code: 'validation' });
  await assert.rejects(() => document({ kind: 'user', id: '456' }, 'group:456'), { code: 'validation' });
  await assert.rejects(() => document({ kind: 'group', id: '456' }, 'group:789'), { code: 'validation' });
});

test('rejects tampered content/hash, extra envelope fields and computed imported entities', async () => {
  const original = await document();
  for (const mutate of [value => { value.snapshot.assertions[0].metadata.note = 'tampered'; },
    value => { value.source.id = '456'; }, value => { value.exportedAt = '2026-11-06T12:00:00.000Z'; },
    value => { value.hash = '0'.repeat(64); }, value => { value.hash = value.hash.toUpperCase(); },
    value => { value.extra = true; }, value => { delete value.hash; },
    value => { value.snapshot.relationships = evaluateGraph(value.snapshot).relationships; }]) {
    const value = structuredClone(original); mutate(value);
    await assert.rejects(() => verifyExport(value, digest), { code: 'validation' });
  }
});

test('rejects unknown outer and graph schemas before publishing any document', async () => {
  const original = await document();
  await assert.rejects(() => verifyExport({ ...original, schema: 2 }, digest), { code: 'unsupported-schema' });
  const unknown = structuredClone(original); unknown.snapshot.schema = 2;
  await assert.rejects(() => verifyExport(unknown, digest), { code: 'unsupported-schema' });
  await assert.rejects(() => verifyExport({ ...original, format: 'another-format' }, digest), { code: 'unsupported-schema' });
});

for (const timestamp of ['2026-02-30T12:00:00.000Z', '0000-01-01T00:00:00.000Z', '2026-11-05', '2026-11-05T12:00:00Z', '2026-11-05T13:00:00.000+01:00', null]) {
  test(`rejects noncanonical export timestamp ${JSON.stringify(timestamp)}`, async () => {
    await assert.rejects(() => createExport({ source: { kind: 'user', id: '123' }, snapshot: transferGraph(), exportedAt: timestamp }, digest), { code: 'validation' });
  });
}

test('a maximum valid snapshot survives an outer envelope larger than the graph byte limit', async () => {
  const snapshot = maximumGraph(); assert.equal(Buffer.byteLength(JSON.stringify(snapshot)), 1_048_576);
  assert.deepEqual(validateGraph(snapshot), snapshot);
  const result = await createExport({ source: { kind: 'local-user', id: 'aB2cD3eF' }, snapshot, exportedAt }, digest);
  const text = JSON.stringify(result); assert.ok(Buffer.byteLength(text) > 1_048_576 && Buffer.byteLength(text) < 2_097_152);
  assert.deepEqual((await parseExport(text, digest)).snapshot, snapshot);
});

test('bounds raw UTF-8 file bytes before parsing and independently bounds the inner snapshot', async () => {
  await assert.rejects(() => parseExport(' '.repeat(2_097_152) + '{}', digest), { code: 'limit' });
  await assert.rejects(() => parseExport('"' + 'é'.repeat(1_048_576) + '"', digest), { code: 'limit' });
  const snapshot = maximumGraph(); snapshot.assertions.at(-1).metadata.note += 'x';
  await assert.rejects(() => createExport({ source: { kind: 'user', id: '123' }, snapshot, exportedAt }, digest), { code: 'limit' });
});

test('malformed JSON, exotic containers and accessors never become valid export payloads', async () => {
  for (const input of ['', '{', 'null', '[]']) await assert.rejects(() => parseExport(input, digest), { code: 'validation' });
  let called = false; const getter = { get source() { called = true; return { kind: 'user', id: '123' }; } };
  await assert.rejects(() => createExport(getter, digest), { code: 'validation' }); assert.equal(called, false);
  await assert.rejects(() => verifyExport(new Date(), digest), { code: 'validation' });
});

test('creation requires an explicit SHA-256 provider and preserves input if external hashing fails', async () => {
  const input = { source: { kind: 'user', id: '123' }, snapshot: transferGraph(), exportedAt }, before = structuredClone(input);
  await assert.rejects(() => createExport(input, undefined), { code: 'validation' });
  /** Simulate only failure of an external cryptographic resource. @returns {Promise<never>} Visible resource failure. */
  async function unavailableDigest() { throw new Error('Native crypto unavailable'); }
  await assert.rejects(() => createExport(input, unavailableDigest), /Native crypto unavailable/); assert.deepEqual(input, before);
});
