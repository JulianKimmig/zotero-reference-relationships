/** Explicit owner/endpoint mapping prevents automatic key matching and preserves imported original values. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSnapshot, validateChoices } from '../src/transfer/mapping.mjs';
import { transferGraph, maximumGraph } from './fixtures/transfer.mjs';
import { assertion } from './fixtures/graph-contract.mjs';
import { evaluateGraph } from '../src/domain/evaluate.mjs';

const source = { kind: 'user', id: '123' }, target = { kind: 'user', id: '456' };
const a = { library: 'self', key: 'AAAAAAAB' }, b = { library: 'self', key: 'BBBBBBBC' };
const c = { library: 'self', key: 'CCCCCCCD' }, d = { library: 'self', key: 'DDDDDDDE' };

/** Describe a complete explicit cross-owner binding, without relying on key equality. @returns {object} Independent mapping. */
function mapping() {
  return { source, target, library: 'self', endpoints: [
    { source: a, target: c, mode: 'reference' }, { source: b, target: d, mode: 'reference' },
  ] };
}

/** Provide semantic native facts as plain contract data, not a replacement for application code. @param {object} original Target reference. @param {string} status Observed availability. @param {boolean} editable Native permission. @returns {object} Exact observation. */
function observed(original, status = 'active', editable = status === 'active') {
  return { original, resolved: ['missing', 'ambiguous', 'cyclic', 'alias-limit'].includes(status) ? null : original, status, editable };
}

test('maps every original endpoint explicitly and preserves versions, metadata, IDs and derived direction', () => {
  const graph = transferGraph(), input = mapping(), result = mapSnapshot(graph, source, input);
  const expected = structuredClone(graph); expected.assertions[0].source = c; expected.assertions[0].target = d;
  assert.deepEqual(result.snapshot, expected); assert.deepEqual(result.mapping, input);
  assert.deepEqual(evaluateGraph(result.snapshot).relationships.map(edge => [edge.source.key, edge.type, edge.target.key]),
    [[c.key, 'referencing', d.key], [d.key, 'referenced-by', c.key]]);
  result.snapshot.assertions[0].metadata.note = 'caller'; result.mapping.endpoints[0].target.key = a.key;
  assert.equal(graph.assertions[0].metadata.note, 'Café 你好 😀 <b>literal</b>'); assert.equal(input.endpoints[0].target.key, c.key);
});

test('maps group ownership to personal scope without importing local runtime IDs', () => {
  const graph = transferGraph('group:789'), owner = { kind: 'group', id: '789' }, input = mapping(); input.source = owner;
  input.endpoints = input.endpoints.map(row => ({ ...row, source: { ...row.source, library: 'group:789' } }));
  const result = mapSnapshot(graph, owner, input);
  assert.equal(result.snapshot.library, 'self'); assert.equal(result.snapshot.types[0].version, 7); assert.equal(result.snapshot.rules[0].version, 9);
  assert.deepEqual(result.snapshot.assertions[0].source, c); assert.equal(graph.assertions[0].source.library, 'group:789');
});

test('same-key cross-owner mapping is accepted only as an explicit complete decision, never synthesized', () => {
  const input = mapping(); input.endpoints = [{ source: a, target: a, mode: 'reference' }, { source: b, target: b, mode: 'reference' }];
  assert.deepEqual(mapSnapshot(transferGraph(), source, input).snapshot, transferGraph());
  assert.throws(() => mapSnapshot(transferGraph(), source, { ...input, endpoints: [] }), { code: 'validation' });
  assert.throws(() => mapSnapshot(transferGraph(), source, { ...input, endpoints: input.endpoints.slice(0, 1) }), { code: 'validation' });
});

for (const mutate of [input => { input.source = target; }, input => { input.target = { kind: 'group', id: '456' }; },
  input => { input.library = 'other'; }, input => { input.extra = true; }, input => { delete input.target; },
  input => { input.endpoints.push(input.endpoints[0]); }, input => { input.endpoints[0].source = c; },
  input => { input.endpoints[0].target = { ...c, library: 'group:456' }; },
  input => { input.endpoints[0].mode = 'automatic'; }, input => { input.endpoints[0].extra = true; },
  input => { input.endpoints[0].source = { ...a, library: 'group:123' }; }]) {
  test(`rejects incomplete or inconsistent mapping: ${mutate.toString()}`, () => {
    const input = structuredClone(mapping()); mutate(input);
    assert.throws(() => mapSnapshot(transferGraph(), source, input), { code: 'validation' });
  });
}

test('retention keeps the exact original key in the explicitly mapped target scope', () => {
  const input = mapping(); input.endpoints[0] = { source: a, target: a, mode: 'retain' };
  const result = mapSnapshot(transferGraph(), source, input); assert.deepEqual(result.snapshot.assertions[0].source, a);
  input.endpoints[0].target = c;
  assert.throws(() => mapSnapshot(transferGraph(), source, input), { code: 'validation' });
});

test('mapping cannot create physical self-links or silently collapse different original identities', () => {
  const input = mapping(); input.endpoints[1].target = c;
  assert.throws(() => mapSnapshot(transferGraph(), source, input), { code: 'validation' });
  const graph = transferGraph(); graph.assertions.push(assertion({ id: 'second', source: c, target: b }));
  const collided = mapping(); collided.endpoints.push({ source: c, target: collided.endpoints[0].target, mode: 'reference' });
  assert.throws(() => mapSnapshot(graph, source, collided), { code: 'validation' });
});

test('mapping still enforces the complete target graph byte bound after a longer scope is selected', () => {
  const graph = maximumGraph(), refs = new Map();
  for (const root of graph.assertions) for (const ref of [root.source, root.target]) refs.set(ref.key, ref);
  const input = { source, target: { kind: 'group', id: '999999999999999' }, library: 'group:999999999999999',
    endpoints: [...refs.values()].map(ref => ({ source: ref, target: { ...ref, library: 'group:999999999999999' }, mode: 'reference' })) };
  assert.throws(() => mapSnapshot(graph, source, input), { code: 'limit' });
  assert.equal(graph.library, 'self');
});

test('native choice validation accepts explicit active references and returns every retained inactive endpoint', () => {
  assert.deepEqual(validateChoices(mapping(), [observed(c), observed(d)]), []);
  for (const status of ['missing', 'trashed', 'unsupported']) {
    const input = mapping(); input.endpoints[0] = { source: a, target: a, mode: 'retain' };
    const result = validateChoices(input, [observed(a, status), observed(d)]);
    assert.deepEqual(result, [{ source: a, target: a, status }]);
    result[0].source.key = c.key; assert.equal(input.endpoints[0].source.key, a.key);
  }
});

test('native validation rejects active retention, inactive references, ambiguous aliases and false write permission', () => {
  const retained = mapping(); retained.endpoints[0] = { source: a, target: a, mode: 'retain' };
  assert.throws(() => validateChoices(retained, [observed(a), observed(d)]), { code: 'endpoint' });
  for (const status of ['missing', 'trashed', 'unsupported', 'ambiguous', 'cyclic', 'alias-limit']) {
    assert.throws(() => validateChoices(mapping(), [observed(c, status), observed(d)]), { code: 'endpoint' });
  }
  for (const status of ['ambiguous', 'cyclic', 'alias-limit']) assert.throws(() => validateChoices(retained,
    [observed(a, status), observed(d)]), { code: 'endpoint' });
  assert.throws(() => validateChoices(mapping(), [observed(c, 'active', false), observed(d)]), { code: 'permission' });
});

test('native facts must be complete and exact; unrelated same-library observations may belong to the current graph', () => {
  assert.deepEqual(validateChoices(mapping(), [observed(c), observed(d), observed(a)]), []);
  for (const facts of [[observed(c)], [observed(c), observed(c), observed(d)],
    [{ ...observed(c), resolved: null }, observed(d)], [{ ...observed(c), editable: 'true' }, observed(d)],
    [{ ...observed(c), status: 'unknown' }, observed(d)], [{ ...observed(c), extra: true }, observed(d)],
    [observed({ ...c, library: 'group:123' }), observed(d)]]) {
    assert.throws(() => validateChoices(mapping(), facts), { code: 'validation' });
  }
});
