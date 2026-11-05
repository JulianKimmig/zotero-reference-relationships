/** Pure application catalog and explicit change review contracts; native service journeys belong to the parent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialGraph } from '../src/application/seed.mjs';
import { explicitEdges, changesBetween } from '../src/application/changes.mjs';
import { validateGraph, edgeKey } from '../src/domain/graph-contract.mjs';
import { assertion, graphFixture, inverseRule, relationshipType } from './fixtures/graph-contract.mjs';

/** Make a graph with a deliberately unordered explicit assertion set. @returns {object} Valid graph. */
function explicitGraph() {
  return graphFixture({ rules: [], assertions: [assertion({ id: 'z' }),
    assertion({ id: 'a', type: 'similar' })] });
}

/** Build the exact empty review delta. @returns {object} Independent arrays. */
function emptyDelta() { return { added: [], updated: [], removed: [] }; }

test('seed provides a valid explicit-only catalog in the requested containing library', () => {
  for (const scope of ['self', 'group:123']) {
    const graph = initialGraph(scope);
    assert.deepEqual(validateGraph(graph), graph);
    assert.equal(graph.library, scope);
    assert.equal(graph.schema, 1);
    assert.deepEqual(graph.assertions, []);
    assert.deepEqual(graph.rules, []);
    assert.deepEqual(graph.types.map(type => [type.id, type.label]), [
      ['referencing', 'Referencing'], ['referenced-by', 'Referenced by'], ['similar', 'Similar'],
    ]);
    for (const type of graph.types) {
      assert.equal(type.version, 1);
      assert.equal(type.retired, false);
      assert.ok(type.description.length > 20);
      assert.deepEqual(type.fields, [{ id: 'note', label: 'Note', kind: 'string', required: false, options: [] }]);
    }
    graph.assertions.push(assertion({ source: { library: scope, key: 'AAAAAAAB' },
      target: { library: scope, key: 'BBBBBBBC' }, metadata: { note: 'Plain text <b>é</b>' } }));
    assert.deepEqual(validateGraph(graph), graph);
  }
});

test('seed catalog calls and fields never share mutable state', () => {
  const graph = initialGraph('self');
  graph.types[0].fields[0].options.push('changed');
  graph.types[0].label = 'changed';
  assert.equal(graph.types[1].fields[0].options.length, 0);
  assert.equal(initialGraph('self').types[0].label, 'Referencing');
  assert.equal(initialGraph('self').types[0].fields[0].options.length, 0);
});

test('seed rejects malformed scope instead of creating a fallback graph', () => {
  for (const scope of [undefined, null, '', 'group:0', 'group:01', 'other']) {
    assert.throws(() => initialGraph(scope), { code: 'validation' });
  }
});

test('explicit edges have the exact frozen review shape in stable EdgeKey order', () => {
  const graph = explicitGraph();
  const edges = explicitEdges(graph);
  const ordered = [...graph.assertions].sort((a, b) => edgeKey(a) < edgeKey(b) ? -1 : 1);
  assert.deepEqual(edges, ordered.map(value => ({ key: edgeKey(value), source: value.source,
    type: value.type, target: value.target, metadata: value.metadata, assertions: [value.id], supports: [] })));
  edges[0].source.key = 'CCCCCCCD';
  edges[0].metadata.changed = true;
  assert.equal(graph.assertions[0].source.key, 'AAAAAAAB');
  assert.deepEqual(graph.assertions[0].metadata, {});
});

test('explicit projection does not evaluate enabled inverse declarations', () => {
  const graph = graphFixture();
  assert.equal(graph.rules[0].enabled, true);
  assert.equal(explicitEdges(graph).length, 1);
  assert.deepEqual(explicitEdges(graph)[0].supports, []);
  assert.deepEqual(explicitEdges(graph)[0].assertions, ['assertion-a']);
});

test('empty or reordered authorities produce exact empty deltas', () => {
  const graph = explicitGraph();
  const reordered = structuredClone(graph);
  reordered.assertions.reverse();
  reordered.types.reverse();
  assert.deepEqual(changesBetween(graph, reordered), { assertions: emptyDelta(), types: emptyDelta(),
    rules: emptyDelta(), derived: emptyDelta(), diagnostics: [] });
  assert.deepEqual(explicitEdges(initialGraph('self')), []);
});

test('review includes full sorted added and removed assertion/type/rule entities', () => {
  const before = graphFixture({ assertions: [], rules: [] });
  const after = explicitGraph();
  after.types.push(relationshipType('z-type'), relationshipType('a-type'));
  after.rules.push(inverseRule({ id: 'z-rule', enabled: false }), inverseRule({ id: 'a-rule', enabled: false }));
  const delta = changesBetween(before, after);
  assert.deepEqual(delta.assertions.added, [after.assertions[1], after.assertions[0]]);
  assert.deepEqual(delta.types.added, [after.types[4], after.types[3]]);
  assert.deepEqual(delta.rules.added, [after.rules[1], after.rules[0]]);
  assert.deepEqual(delta.derived.added, explicitEdges(after));
  assert.deepEqual(delta.diagnostics, []);
  const reverse = changesBetween(after, before);
  for (const kind of ['assertions', 'types', 'rules', 'derived']) {
    assert.deepEqual(reverse[kind], { added: [], updated: [], removed: delta[kind].added });
  }
});

test('metadata update preserves edge identity and reviews exact before/after entities', () => {
  const before = initialGraph('self');
  before.assertions.push(assertion({ metadata: { note: 'before' } }));
  const after = structuredClone(before);
  after.assertions[0].metadata.note = 'after';
  after.assertions[0].updatedAt = '2026-11-05T13:00:00.000Z';
  const delta = changesBetween(before, after);
  assert.deepEqual(delta.assertions, { added: [], updated: [{ before: before.assertions[0], after: after.assertions[0] }], removed: [] });
  assert.deepEqual(delta.derived, { added: [], updated: [{ before: explicitEdges(before)[0], after: explicitEdges(after)[0] }], removed: [] });
  delta.assertions.updated[0].before.metadata.note = 'detached';
  delta.derived.updated[0].after.target.key = 'CCCCCCCD';
  assert.equal(before.assertions[0].metadata.note, 'before');
  assert.equal(after.assertions[0].target.key, 'BBBBBBBC');
});

test('timestamp-only edits affect authority without changing derived review', () => {
  const before = explicitGraph(), after = structuredClone(before);
  after.assertions[0].updatedAt = '2026-11-05T13:00:00.000Z';
  assert.equal(changesBetween(before, after).assertions.updated.length, 1);
  assert.deepEqual(changesBetween(before, after).derived, emptyDelta());
});

test('moving an assertion retracts the previous edge and adds the replacement atomically', () => {
  const before = explicitGraph(), after = structuredClone(before);
  after.assertions[0].target.key = 'CCCCCCCD';
  const delta = changesBetween(before, after);
  assert.equal(delta.assertions.updated.length, 1);
  assert.equal(delta.derived.updated.length, 0);
  assert.deepEqual(delta.derived.removed, [explicitEdges(before)[0]]);
  assert.deepEqual(delta.derived.added, [explicitEdges(after)[0]]);
});

test('replacing the manual identity updates edge contributors without inventing supports', () => {
  const before = explicitGraph(), after = structuredClone(before);
  after.assertions[0].id = 'replacement';
  const delta = changesBetween(before, after);
  assert.deepEqual(delta.assertions.removed, [before.assertions[0]]);
  assert.deepEqual(delta.assertions.added, [after.assertions[0]]);
  assert.equal(delta.derived.updated.length, 1);
  assert.deepEqual(delta.derived.updated[0].after.assertions, ['replacement']);
});

test('type and rule edits are full entities sorted by stable ID', () => {
  const before = graphFixture({ rules: [inverseRule({ id: 'z-rule' }), inverseRule({ id: 'a-rule' })] });
  const after = structuredClone(before);
  for (const type of after.types) type.description = 'Updated description';
  for (const rule of after.rules) { rule.enabled = false; rule.version = 2; }
  const delta = changesBetween(before, after);
  assert.deepEqual(delta.types.updated.map(entry => entry.after.id), ['referenced-by', 'referencing', 'similar']);
  assert.deepEqual(delta.rules.updated.map(entry => entry.after.id), ['a-rule', 'z-rule']);
  assert.deepEqual(delta.rules.updated[0], { before: before.rules[1], after: after.rules[1] });
  assert.deepEqual(delta.derived, emptyDelta());
});

test('normalized JSON equality ignores object key insertion and Unicode composition', () => {
  const before = initialGraph('self');
  before.assertions.push(assertion({ metadata: { note: 'é' } }));
  const after = structuredClone(before);
  after.assertions[0] = Object.fromEntries(Object.entries(after.assertions[0]).reverse());
  after.assertions[0].metadata.note = 'e\u0301';
  assert.deepEqual(changesBetween(before, after).assertions, emptyDelta());
  assert.deepEqual(changesBetween(before, after).derived, emptyDelta());
});

test('invalid graphs fail rather than yielding partial reviews or inferred empty state', () => {
  const duplicate = explicitGraph();
  duplicate.assertions.push(assertion({ id: 'duplicate' }));
  for (const invalid of [null, {}, { ...explicitGraph(), schema: 2 }, duplicate]) {
    assert.throws(() => explicitEdges(invalid));
    assert.throws(() => changesBetween(explicitGraph(), invalid));
    assert.throws(() => changesBetween(invalid, explicitGraph()));
  }
});

test('change review rejects different containing libraries', () => {
  assert.throws(() => changesBetween(initialGraph('self'), initialGraph('group:123')), { code: 'validation' });
});
