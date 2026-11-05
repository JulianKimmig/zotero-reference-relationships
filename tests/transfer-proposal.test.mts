/** Import proposals preserve full histories under explicit merge/replace rather than ordinary creation version rules. */
import type { Graph } from '../src/domain/contracts.mts';
import { present } from './fixtures/evidence.mts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSnapshots } from '../src/transfer/proposal.mts';
import { transferGraph, maximumGraph } from './fixtures/transfer.mts';
import { assertion, relationshipType, inverseRule } from './fixtures/graph-contract.mts';
import { evaluateGraph } from '../src/domain/evaluate.mts';

test('uninitialized target imports its actual incoming catalog/versions without seeded defaults', () => {
  const graph = transferGraph();
  for (const operation of ['merge', 'replace']) {
    const result = mergeSnapshots(null, graph, operation);
    assert.deepEqual(result, graph); assert.equal(result.types[0].version, 7); assert.equal(result.rules[0].version, 9);
    result.assertions[0].metadata.note = 'caller'; assert.equal(graph.assertions[0].metadata.note, 'Café 你好 😀 <b>literal</b>');
  }
});

test('merge appends new explicit entities and retains unrelated authority without resetting versions', () => {
  const before = transferGraph(), incoming = transferGraph();
  incoming.types.push({ ...relationshipType('custom'), version: 12 });
  incoming.assertions.push(assertion({ id: 'foreign-root', source: { library: 'self', key: 'CCCCCCCD' }, type: 'custom' }));
  incoming.rules.push(inverseRule({ id: 'custom-inverse', version: 13, rootType: 'custom', inputType: 'custom', outputType: 'custom' }));
  const result = mergeSnapshots(before, incoming, 'merge'); assert.deepEqual(result, incoming);
  assert.equal(before.assertions.length, 1); assert.equal(present(result.rules.at(-1)).version, 13);
  assert.equal(evaluateGraph(result).relationships.length, 4);
  result.types[0].label = 'caller'; assert.equal(before.types[0].label, 'Referencing'); assert.equal(incoming.types[0].label, 'Referencing');
});

test('repeated identical normalized merge is idempotent and preserves current entity ordering', () => {
  const current = transferGraph(), imported = structuredClone(current);
  imported.types.reverse(); imported.assertions[0].metadata.note = 'Cafe\u0301 你好 😀 <b>literal</b>';
  assert.deepEqual(mergeSnapshots(current, imported, 'merge'), current);
  assert.deepEqual(mergeSnapshots(current, mergeSnapshots(current, imported, 'merge'), 'merge'), current);
});

for (const mutate of [(graph: Graph) => { graph.assertions[0].metadata.note = 'different'; },
  (graph: Graph) => { graph.assertions[0].updatedAt = '2026-11-06T00:00:00.000Z'; },
  (graph: Graph) => { graph.types[0].version++; }, (graph: Graph) => { graph.types[0].label = 'Different'; },
  (graph: Graph) => { graph.rules[0].version++; }, (graph: Graph) => { graph.rules[0].enabled = false; }]) {
  test(`same-ID different complete payload conflicts: ${mutate.toString()}`, () => {
    const before = transferGraph(), incoming = transferGraph(); mutate(incoming);
    assert.throws(() => mergeSnapshots(before, incoming, 'merge'), { code: 'conflict' });
    assert.equal(before.types[0].version, 7); assert.equal(before.rules[0].enabled, true);
  });
}

test('different IDs for one physical triple conflict even when metadata is equal', () => {
  const before = transferGraph(), incoming = transferGraph(); incoming.assertions[0].id = 'different-identity';
  assert.throws(() => mergeSnapshots(before, incoming, 'merge'), { code: 'conflict' });
  assert.equal(before.assertions[0].id, 'assertion-a');
});

test('replace preserves incoming lower/higher historical versions without mutating the old snapshot', () => {
  const before = transferGraph(), incoming = transferGraph(); incoming.types[0].version = 3; incoming.rules[0].version = 17;
  incoming.assertions[0].metadata.note = 'Explicit replacement';
  assert.deepEqual(mergeSnapshots(before, incoming, 'replace'), incoming);
  assert.equal(before.types[0].version, 7); assert.equal(before.assertions[0].metadata.note, 'Café 你好 😀 <b>literal</b>');
});

test('combined rule paths are validated before any complete proposal is returned', () => {
  const before = transferGraph(), incoming = transferGraph();
  incoming.rules = [inverseRule({ id: 'competing-route', version: 7, mapping: { note: { kind: 'constant', value: 'another route' } } })];
  assert.throws(() => mergeSnapshots(before, incoming, 'merge'), { code: 'validation' });
  assert.equal(before.rules.length, 1); assert.equal(incoming.rules.length, 1);
});

test('separately valid snapshots cannot exceed whole-graph count/byte budgets through merge', () => {
  const before = maximumGraph(); before.assertions = before.assertions.slice(0, 500);
  const incoming = structuredClone(before);
  for (const [index, root] of incoming.assertions.entries()) { root.id = `new-${index}`; root.source.key = `B${index.toString(36).toUpperCase().padStart(7, '0')}`; }
  assert.throws(() => mergeSnapshots(before, incoming, 'merge'), { code: 'limit' });
  assert.equal(before.assertions.length, 500); assert.equal(incoming.assertions.length, 500);
});

test('replacement/merge never cross scopes or accept unsupported operations and malformed authority', () => {
  for (const operation of ['merge', 'replace']) {
    assert.throws(() => mergeSnapshots(transferGraph(), transferGraph('group:456'), operation), { code: 'validation' });
    assert.throws(() => mergeSnapshots(transferGraph(), {}, operation), { code: 'unsupported-schema' });
  }
  assert.throws(() => mergeSnapshots(null, transferGraph(), 'automatic'), { code: 'validation' });
});
