/** Complete import review uses supplied native observations without discarding inactive roots or guessing conflicted aggregates. */
import { present, completeProjection, originalProjection } from './fixtures/evidence.mts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewTransfer } from '../src/transfer/review.mts';
import { transferGraph, maximumGraph } from './fixtures/transfer.mts';
import { assertion } from './fixtures/graph-contract.mts';
import type { Graph, ItemRef } from '../src/domain/contracts.mts';

/** Enumerate unique original endpoints as plain contract data. @param {object} graph Complete graph. @returns {object[]} Endpoint references. */
function endpoints(graph: Graph): ItemRef[] {
  const refs = new Map<string, ItemRef>(); for (const root of graph.assertions) for (const ref of [root.source, root.target]) refs.set(ref.key, ref);
  return [...refs.values()];
}

/** Build explicit complete choices for the supplied mapped graph. @param {object} graph Target-scope authority. @returns {object} Detached cross-owner choices. */
function mapping(graph: Graph) {
  return { source: { kind: 'user', id: '123' }, target: { kind: 'user', id: '456' }, library: graph.library,
    endpoints: endpoints(graph).map(ref => ({ source: { ...ref }, target: { ...ref }, mode: 'reference' })) };
}

/** Describe active semantic endpoint facts; actual origin and under-lock comparison require separate native tests. @param {object} graph Complete mapped graph. @returns {object[]} Plain observations. */
function observations(graph: Graph): { original: ItemRef; resolved: ItemRef | null; status: string; editable: boolean }[] { return endpoints(graph).map(ref => ({ original: { ...ref }, resolved: { ...ref }, status: 'active', editable: true })); }

test('uninitialized review has an explicit null before, incoming histories and complete inverse effects', () => {
  const graph = transferGraph(), result = reviewTransfer(null, graph, mapping(graph), observations(graph));
  assert.equal(result.projection.before, null); assert.equal(result.projection.after.state, 'ready');
  assert.equal(present(result.changeSet.types.added.find(type => type.id === 'referencing')).version, 7); assert.equal(result.changeSet.rules.added[0].version, 9);
  assert.deepEqual(result.changeSet.assertions.added, graph.assertions); assert.equal(present(result.changeSet.derived).added.length, 2);
  assert.deepEqual(result.retained, []); assert.deepEqual(result.refs, endpoints(graph));
});

test('identical normalized authority reviews without fabricated changes or reset versions', () => {
  const graph = transferGraph(), same = structuredClone(graph); same.assertions[0].metadata.note = 'Cafe\u0301 你好 😀 <b>literal</b>';
  const result = reviewTransfer(graph, same, mapping(same), observations(same));
  for (const kind of ['assertions', 'types', 'rules', 'derived'] as const) assert.deepEqual(result.changeSet[kind], { added: [], updated: [], removed: [] });
  assert.equal(present(result.projection.before).state, 'ready'); assert.equal(result.projection.after.relationships.length, 2);
});

for (const status of ['missing', 'trashed', 'unsupported']) {
  test(`retained ${status} originals keep complete authority and diagnostics with no unavailable inference`, () => {
    const graph = transferGraph(), choices = mapping(graph), rows = observations(graph); choices.endpoints[0].mode = 'retain';
    rows[0] = { ...rows[0], status, editable: false, resolved: status === 'missing' ? null : rows[0].resolved };
    const result = reviewTransfer(null, graph, choices, rows);
    assert.deepEqual(result.changeSet.assertions.added, graph.assertions); assert.equal(result.after.assertions.length, 1);
    assert.equal(result.projection.after.relationships.length, 0); assert.equal(present(result.changeSet.derived).added.length, 0);
    assert.equal(result.retained[0].status, status); assert.equal(result.retained[0].target.key, graph.assertions[0].source.key);
    assert.ok(result.changeSet.diagnostics.some(value => value.details.status === status));
    assert.deepEqual(result.refs, [graph.assertions[0].target]);
  });
}

test('historical retired types stay representable under the specialized reviewed import boundary', () => {
  const graph = transferGraph(); graph.types[0].retired = true; graph.rules[0].enabled = false;
  const result = reviewTransfer(null, graph, mapping(graph), observations(graph));
  const retired = result.changeSet.types.added.find(type => type.id === 'referencing');
  assert.equal(present(retired).retired, true); assert.equal(present(retired).version, 7); assert.equal(result.changeSet.rules.added[0].version, 9);
  assert.equal(result.projection.after.relationships.length, 1);
});

test('specialized import still rejects an enabled rule using a retired type', () => {
  const graph = transferGraph(); graph.types[0].retired = true;
  assert.throws(() => reviewTransfer(null, graph, mapping(graph), observations(graph)), { code: 'validation' });
});

test('conflicted before remains complete while reviewed replacement provides a ready after', () => {
  const before = transferGraph(), after = transferGraph(); before.assertions.push(assertion({ id: 'independent',
    source: { library: 'self', key: 'CCCCCCCD' }, metadata: { note: 'Independent original' } }));
  const rows = observations(before); present(rows.find(row => row.original.key === 'CCCCCCCD')).resolved = { ...after.assertions[0].source };
  const result = reviewTransfer(before, after, mapping(after), rows);
  assert.equal(present(result.projection.before).state, 'conflict'); assert.equal(present(result.before).assertions.length, 2);
  assert.equal(present(completeProjection(present(result.projection.before)).clusters.find(cluster => cluster.conflicts.length)).conflicts[0].contributors.length, 2);
  assert.equal(result.changeSet.derived, null); assert.equal(result.projection.after.state, 'ready');
  assert.deepEqual(result.changeSet.assertions.removed.map(root => root.id), ['independent']);
  assert.ok(result.changeSet.diagnostics.some(value => value.code === 'projection-conflict'));
});

test('unknown before aliases remain inspectable when explicitly removed by the complete replacement', () => {
  const before = transferGraph(), after = transferGraph(); before.assertions.push(assertion({ id: 'unknown', source: { library: 'self', key: 'CCCCCCCD' } }));
  const rows = observations(before), row = rows.find(row => row.original.key === 'CCCCCCCD'); present(row).status = 'ambiguous'; present(row).resolved = null; present(row).editable = false;
  const result = reviewTransfer(before, after, mapping(after), rows);
  assert.equal(present(result.projection.before).state, 'endpoint-conflict'); assert.equal(originalProjection(present(result.projection.before)).originals.length, 2);
  assert.equal(result.changeSet.derived, null); assert.equal(result.projection.after.state, 'ready');
});

test('native alias conflicts or mapped metadata disagreement never produce an accepted partial after graph', () => {
  const graph = transferGraph(), rows = observations(graph); rows[0] = { ...rows[0], status: 'cyclic', resolved: null, editable: false };
  assert.throws(() => reviewTransfer(null, graph, mapping(graph), rows), { code: 'endpoint' });
  const conflicting = transferGraph(); conflicting.assertions.push(assertion({ id: 'other', source: { library: 'self', key: 'CCCCCCCD' }, metadata: { note: 'Other' } }));
  const aliases = observations(conflicting); present(aliases.find(row => row.original.key === 'CCCCCCCD')).resolved = { ...graph.assertions[0].source };
  assert.throws(() => reviewTransfer(null, conflicting, mapping(conflicting), aliases), { code: 'conflict' });
  assert.equal(conflicting.assertions.length, 2); assert.equal(graph.assertions.length, 1);
});

test('native collapsed historical roots remain explicit with self-edge diagnostics and original keys', () => {
  const graph = transferGraph(), rows = observations(graph); rows[1].resolved = { ...present(rows[0].resolved) };
  const result = reviewTransfer(null, graph, mapping(graph), rows);
  assert.deepEqual(result.changeSet.assertions.added, graph.assertions); assert.equal(result.projection.after.relationships.length, 0);
  assert.ok(result.changeSet.diagnostics.some(value => value.code === 'self-edge'));
});

test('review rejects inconsistent scopes, missing native observations and mapping targets outside the proposal', () => {
  const graph = transferGraph(), wrong = mapping(graph); wrong.endpoints[0].target.key = 'CCCCCCCD';
  assert.throws(() => reviewTransfer(transferGraph('group:123'), graph, mapping(graph), observations(graph)), { code: 'validation' });
  assert.throws(() => reviewTransfer(null, graph, mapping(graph), observations(graph).slice(0, 1)), { code: 'validation' });
  assert.throws(() => reviewTransfer(null, graph, wrong, [...observations(graph), { original: wrong.endpoints[0].target,
    resolved: wrong.endpoints[0].target, status: 'active', editable: true }]), { code: 'validation' });
});

test('all review DTOs detach from supplied graphs, choices and observations', () => {
  const graph = transferGraph(), choices = mapping(graph), rows = observations(graph), result = reviewTransfer(null, graph, choices, rows);
  result.changeSet.assertions.added[0].metadata.note = 'caller'; result.after.assertions[0].source.key = 'CCCCCCCD'; result.refs[0].key = 'DDDDDDDE';
  assert.equal(graph.assertions[0].metadata.note, 'Café 你好 😀 <b>literal</b>'); assert.equal(choices.endpoints[0].target.key, 'AAAAAAAB');
  assert.equal(present(rows[0].resolved).key, 'AAAAAAAB');
});

test('complete review DTOs can exceed one graph byte bound without losing or truncating contributors', () => {
  const graph = maximumGraph(), result = reviewTransfer(null, graph, mapping(graph), observations(graph));
  assert.equal(result.changeSet.assertions.added.length, 1000); assert.equal(present(result.changeSet.derived).added.length, 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) > 1_048_576); assert.equal(result.after.assertions.length, 1000);
});
