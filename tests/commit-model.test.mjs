/** Exercise the real portable feasibility module with Node's external SHA-256 provider. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import {
  canonicalJSON, makeRecord, makeCommit, evaluate, IntegrityError, UnsupportedSchemaError,
} from './sync-controller/commit-model.sys.mjs';

/** Hash canonical text using real Node crypto. @param {string} text UTF-8 input. @returns {Promise<string>} SHA-256 hex. */
async function digest(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }

/** Create a record note fixture. @param {string} key Native key. @param {*} payload JSON data. @returns {Promise<object>} Note. */
async function record(key, payload) { return { key, body: await makeRecord(payload, digest) }; }

/** Create a complete-snapshot commit fixture. @param {string} key Note key. @param {string[]} parents Keys. @param {object[]} records Notes. @returns {Promise<object>} Note. */
async function commit(key, parents, records) {
  return { key, body: await makeCommit({ parents, records: records.map(({ key, body }) => ({ key, hash: body.hash })) }, digest) };
}

/** Build an initial and an updated generation. @returns {Promise<object>} Actual immutable fixtures. */
async function generations() {
  const r0 = await record('R0', { assertion: 'original', rule: 1 });
  const r1 = await record('R1', { assertion: 'edited', rule: 2 });
  const c0 = await commit('C0', [], [r0]);
  const c1 = await commit('C1', ['C0'], [r1]);
  return { r0, r1, c0, c1 };
}

test('canonical JSON recursively sorts keys, normalizes every string and preserves primitives', () => {
  assert.equal(canonicalJSON({ z: [true, null, -0, { 'e\u0301': 'A\u030a' }], a: 'e\u0301' }),
    '{"a":"é","z":[true,null,0,{"é":"Å"}]}');
  assert.equal(canonicalJSON({ 2: 'two', 10: 'ten' }), '{"10":"ten","2":"two"}');
  assert.equal(canonicalJSON(JSON.parse('{"__proto__":{"safe":true}}')), '{"__proto__":{"safe":true}}');
});

for (const value of [undefined, NaN, Infinity, -Infinity, 1n, () => 1, Symbol('x'),
  new Date(), new Map(), Object.create({ inherited: 1 }), [1, , 3], { missing: undefined }]) {
  test(`rejects unsupported JSON value ${String(value)}`, () => assert.throws(() => canonicalJSON(value), IntegrityError));
}

test('rejects cyclic JSON and duplicate NFC object keys', () => {
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => canonicalJSON(cyclic), IntegrityError);
  assert.throws(() => canonicalJSON({ é: 1, 'e\u0301': 2 }), IntegrityError);
});

test('rejects accessors, hidden properties, symbols and non-JSON array properties without invoking getters', () => {
  const accessor = Object.defineProperty({}, 'secret', { enumerable: true, get() { throw new Error('getter invoked'); } });
  for (const value of [accessor, Object.defineProperty({}, 'hidden', { value: 1 }),
    { [Symbol('x')]: 1 }, Object.assign([], { extra: 1 })]) {
    assert.throws(() => canonicalJSON(value), IntegrityError);
  }
});

test('hashes canonical payloads, detaches inputs and returns NFC-normalized bodies', async () => {
  const payload = { nested: { text: 'e\u0301' }, values: [false, 12.5, null] };
  const body = await makeRecord(payload, digest);
  assert.deepEqual(body, { format: 'rr-feasibility-record/v1', payload: { nested: { text: 'é' }, values: [false, 12.5, null] }, hash: await digest(canonicalJSON(payload)) });
  payload.nested.text = 'mutated';
  assert.equal(body.payload.nested.text, 'é');
  assert.equal((await makeRecord({ values: [false, 12.5, null], nested: { text: 'é' } }, digest)).hash, body.hash);
});

test('hashes commit envelopes with canonical parent and snapshot-set ordering', async () => {
  const r = await record('R', 7);
  const refs = [{ key: 'R', hash: r.body.hash }];
  const body = await makeCommit({ parents: ['B', 'A'], records: refs }, digest);
  assert.deepEqual(body.parents, ['A', 'B']);
  assert.equal(body.hash, await digest(canonicalJSON({ format: body.format, parents: body.parents, records: refs })));
  assert.deepEqual(body, await makeCommit({ parents: ['A', 'B'], records: refs }, digest));
});

test('requires an explicit digest provider and validates its result', async () => {
  await assert.rejects(makeRecord({}, undefined), /digest/i);
  await assert.rejects(makeCommit({ parents: [], records: [] }), /digest/i);
  await assert.rejects(evaluate([], []), /digest/i);
  await assert.rejects(makeRecord({}, async () => 'bad external digest'), IntegrityError);
});

test('Unicode and HTML-escaped JSON roundtrip preserves parsed note data', async () => {
  const r = await record('R', { text: 'Cafe\u0301 你好 😀 <tag> & "quoted"', provenance: { label: 'Å', active: true, score: 2.5, absent: null } });
  const escaped = JSON.stringify(r.body).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const parsed = JSON.parse(escaped.replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&'));
  const c = await commit('C', [], [r]);
  assert.deepEqual(await evaluate([c], [{ key: 'R', body: parsed }], digest), { state: 'ready', head: 'C', payloads: [r.body.payload] });
});

test('pending partial arrival retains only the prior whole generation then completes', async () => {
  const { r0, r1, c0, c1 } = await generations();
  assert.deepEqual(await evaluate([c1, c0], [r0], digest), { state: 'pending', missing: ['R1'], previousHeads: ['C0'] });
  assert.deepEqual(await evaluate([c1, c0], [r1, r0], digest), { state: 'ready', head: 'C1', payloads: [r1.body.payload] });
  const restarted = JSON.parse(JSON.stringify({ commits: [c0, c1], records: [r0] }));
  assert.deepEqual(await evaluate(restarted.commits, restarted.records, digest), { state: 'pending', missing: ['R1'], previousHeads: ['C0'] });
});

test('missing parents block publication even when the newest payload is present', async () => {
  const { r0, r1, c0, c1 } = await generations();
  assert.deepEqual(await evaluate([c1], [r1], digest), { state: 'pending', missing: ['C0'], previousHeads: [] });
  assert.deepEqual(await evaluate([c1, c0], [r1], digest), { state: 'pending', missing: ['R0'], previousHeads: [] });
  assert.equal((await evaluate([c1, c0], [r0, r1], digest)).state, 'ready');
});

test('empty observations remain pending and missing dependencies are deduplicated and sorted', async () => {
  assert.deepEqual(await evaluate([], [], digest), { state: 'pending', missing: [], previousHeads: [] });
  const r = await record('Z', {});
  const a = await commit('A', ['P'], [r]);
  const b = await commit('B', ['P'], [r]);
  assert.deepEqual(await evaluate([b, a], [], digest), { state: 'pending', missing: ['P', 'Z'], previousHeads: [] });
});

test('concurrent assertion/rule edits produce sibling heads without an implicit winner', async () => {
  const { r0, r1, c0, c1 } = await generations();
  const r2 = await record('R2', { assertion: 'original', rule: 3 });
  const c2 = await commit('C2', ['C0'], [r2]);
  assert.deepEqual(await evaluate([c2, c0, c1], [r2, r0, r1], digest), { state: 'conflict', heads: ['C1', 'C2'] });
  assert.deepEqual(await evaluate([c2, c0, c1], [r0, r1], digest), { state: 'pending', missing: ['R2'], previousHeads: ['C1'] });
});

test('delete versus edit is a conflict and only a resolution of all heads publishes', async () => {
  const { r0, r1, c0, c1 } = await generations();
  const deleted = await commit('DELETE', ['C0'], []);
  assert.deepEqual(await evaluate([c0, c1, deleted], [r0, r1], digest), { state: 'conflict', heads: ['C1', 'DELETE'] });
  const partial = await commit('PARTIAL', ['C1'], [r1]);
  assert.deepEqual(await evaluate([c0, c1, deleted, partial], [r0, r1], digest), { state: 'conflict', heads: ['DELETE', 'PARTIAL'] });
  const resolved = await commit('RESOLVED', ['C1', 'DELETE'], []);
  assert.deepEqual(await evaluate([resolved, deleted, c1, c0], [r0, r1], digest), { state: 'ready', head: 'RESOLVED', payloads: [] });
});

test('pending resolution exposes maximal complete conflicting ancestors', async () => {
  const { r0, r1, c0, c1 } = await generations();
  const deleted = await commit('DELETE', ['C0'], []);
  const r2 = await record('R2', 'resolution');
  const resolved = await commit('RESOLVED', ['DELETE', 'C1'], [r2]);
  assert.deepEqual(await evaluate([resolved, deleted, c0, c1], [r0, r1], digest), { state: 'pending', missing: ['R2'], previousHeads: ['C1', 'DELETE'] });
});

test('payload order follows record keys and snapshots never merge inherited records', async () => {
  const a = await record('A', 'a'), z = await record('Z', 'z');
  const c0 = await commit('C0', [], [z, a]);
  assert.deepEqual(await evaluate([c0], [z, a], digest), { state: 'ready', head: 'C0', payloads: ['a', 'z'] });
  const c1 = await commit('C1', ['C0'], [z]);
  assert.deepEqual(await evaluate([c1, c0], [a, z], digest), { state: 'ready', head: 'C1', payloads: ['z'] });
});

test('independent roots also conflict', async () => {
  assert.deepEqual(await evaluate([await commit('B', [], []), await commit('A', [], [])], [], digest), { state: 'conflict', heads: ['A', 'B'] });
});

test('rejects corrupt record payloads, corrupt commits and mismatched reference hashes', async () => {
  const { r0, c0 } = await generations();
  await assert.rejects(evaluate([c0], [{ ...r0, body: { ...r0.body, payload: 'corrupt' } }], digest), IntegrityError);
  await assert.rejects(evaluate([{ ...c0, body: { ...c0.body, parents: ['missing'] } }], [r0], digest), IntegrityError);
  const wrong = { key: 'WRONG', body: await makeCommit({ parents: [], records: [{ key: 'R0', hash: '0'.repeat(64) }] }, digest) };
  await assert.rejects(evaluate([wrong], [r0], digest), IntegrityError);
  await assert.rejects(evaluate([], [{ ...r0, body: { ...r0.body, hash: '0'.repeat(64) } }], digest), IntegrityError);
});

test('unsupported schemas fail explicitly for both note kinds', async () => {
  const { r0, c0 } = await generations();
  await assert.rejects(evaluate([c0], [{ ...r0, body: { ...r0.body, format: 'rr-feasibility-record/v2' } }], digest), UnsupportedSchemaError);
  await assert.rejects(evaluate([{ ...c0, body: { ...c0.body, format: 'rr-feasibility-commit/v2' } }], [r0], digest), UnsupportedSchemaError);
});

test('duplicate physical keys, including across note kinds, always fail', async () => {
  const { r0, c0 } = await generations();
  await assert.rejects(evaluate([c0, c0], [r0], digest), IntegrityError);
  await assert.rejects(evaluate([c0], [r0, r0], digest), IntegrityError);
  await assert.rejects(evaluate([{ ...c0, key: 'R0' }], [r0], digest), IntegrityError);
});

test('cycles fail even alongside missing dependencies', async () => {
  const a = await commit('A', ['B', 'MISSING'], []), b = await commit('B', ['A'], []);
  await assert.rejects(evaluate([a, b], [], digest), /cycle/i);
  await assert.rejects(evaluate([await commit('SELF', ['SELF'], [])], [], digest), /cycle/i);
});

test('rejects malformed snapshots, duplicate references and invalid numeric data', async () => {
  const hash = '0'.repeat(64);
  for (const input of [null, {}, { parents: [], records: [], extra: 1 }, { parents: ['A', 'A'], records: [] },
    { parents: [1], records: [] }, { parents: [''], records: [] }, { parents: [], records: [{ key: 'R', hash }, { key: 'R', hash }] },
    { parents: [], records: [{ key: 'R', hash: 'invalid' }] }, { parents: [], records: [{ key: 'R', hash, extra: 1 }] }]) {
    await assert.rejects(makeCommit(input, digest), IntegrityError);
  }
  await assert.rejects(makeRecord({ number: NaN }, digest), IntegrityError);
  await assert.rejects(evaluate(null, [], digest), IntegrityError);
  await assert.rejects(evaluate([], {}, digest), IntegrityError);
  await assert.rejects(evaluate([{ key: '', body: {} }], [], digest), IntegrityError);
  await assert.rejects(evaluate([{ key: 'K' }], [], digest), IntegrityError);
});

test('rejects unexpected envelope fields and malformed data in existing notes', async () => {
  const { r0, c0 } = await generations();
  await assert.rejects(evaluate([c0], [{ ...r0, body: { ...r0.body, extra: 1 } }], digest), IntegrityError);
  await assert.rejects(evaluate([{ ...c0, body: { ...c0.body, extra: 1 } }], [r0], digest), IntegrityError);
  await assert.rejects(evaluate([c0], [{ ...r0, body: { ...r0.body, payload: Infinity } }], digest), IntegrityError);
});

test('bounds canonical nesting, serialized size and observed note count explicitly', async () => {
  let nested = null;
  for (let i = 0; i < 70; i++) nested = [nested];
  assert.throws(() => canonicalJSON(nested), /limit/i);
  assert.throws(() => canonicalJSON('x'.repeat(1_048_576)), /limit/i);
  await assert.rejects(evaluate(Array(4097).fill(null), [], digest), /limit/i);
});

test('validates schemas before considering absent dependencies and normalizes downloaded strings', async () => {
  const r = await record('R', { text: 'é' }), c = await commit('C', [], [r]);
  const decomposed = { ...r, body: { ...r.body, payload: { text: 'e\u0301' } } };
  assert.deepEqual(await evaluate([c], [decomposed], digest), { state: 'ready', head: 'C', payloads: [{ text: 'é' }] });
  const pending = await commit('PENDING', ['ABSENT'], []);
  await assert.rejects(evaluate([pending], [{ ...r, body: { ...r.body, payload: 'corrupt' } }], digest), IntegrityError);
});

test('accepts plain JSON from another real JS realm while rejecting custom prototypes', async () => {
  const foreign = runInNewContext('JSON.parse(\'{"text":"e\\\\u0301","nested":[1,{"yes":true}]}\')');
  assert.equal(canonicalJSON(foreign), '{"nested":[1,{"yes":true}],"text":"é"}');
  const r = await record('R', foreign), c = await commit('C', [], [r]);
  const notes = runInNewContext(`JSON.parse(${JSON.stringify(JSON.stringify({ commits: [c], records: [r] }))})`);
  assert.deepEqual(await evaluate(notes.commits, notes.records, digest), { state: 'ready', head: 'C', payloads: [r.body.payload] });
  for (const value of [Object.prototype, Object.create(null), new (class Example {})(), new (class Extended extends Array {})()]) {
    assert.throws(() => canonicalJSON(value), IntegrityError);
  }
});
