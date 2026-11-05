/** Exact rule truth, support preservation, cycle termination and derived review behavior. */
import { present } from './fixtures/evidence.mts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGraph } from '../src/domain/evaluate.mts';
import { changesBetween } from '../src/application/changes.mts';
import { edgeKey } from '../src/domain/graph-contract.mts';
import { graphFixture, assertion, inverseRule, ruleTruthCases } from './fixtures/graph-contract.mts';
import { diamond, independent } from './fixtures/rules.mts';

for (const fixture of ruleTruthCases) {
  test(`frozen truth fixture: ${fixture.name}`, () => {
    const input = graphFixture({ rules: fixture.rules }), original = structuredClone(input);
    const result = evaluateGraph(input);
    assert.deepEqual(Object.keys(result).sort(), ['relationships', 'transitions']);
    assert.deepEqual(result.relationships.map(edge => [edge.source.key, edge.type, edge.target.key]).sort(), [...fixture.expectedEdges].sort());
    const supports = result.relationships.flatMap(edge => edge.supports).sort((a, b) => a.rule < b.rule ? -1 : 1);
    assert.deepEqual(supports, fixture.expectedSupports.map(support => ({ ...support,
      source: { library: 'self', key: support.source }, target: { library: 'self', key: support.target } })));
    for (const edge of result.relationships) {
      assert.deepEqual(Object.keys(edge).sort(), ['assertions', 'key', 'metadata', 'source', 'supports', 'target', 'type']);
      assert.equal(edge.key, edgeKey(edge));
    }
    assert.deepEqual(input, original);
    assert.ok(result.transitions <= 2);
  });
}

test('a symmetric similar rule creates only the reverse edge and finite producing supports', () => {
  const input = graphFixture({ assertions: [assertion({ type: 'similar' })],
    rules: [inverseRule({ rootType: 'similar', inputType: 'similar', outputType: 'similar' })] });
  const result = evaluateGraph(input);
  assert.equal(result.relationships.length, 2); assert.equal(result.transitions, 2);
  assert.equal(result.relationships.flatMap(edge => edge.supports).length, 2);
  assert.equal(present(result.relationships.find(edge => edge.source.key === 'AAAAAAAB')).assertions[0], 'assertion-a');
});

test('two rules produce one derived edge with both supports instead of duplicate relationships', () => {
  const result = evaluateGraph(graphFixture({ rules: [inverseRule({ id: 'z' }), inverseRule({ id: 'a' })] }));
  const edge = result.relationships.find(edge => edge.type === 'referenced-by');
  assert.equal(result.relationships.length, 2); assert.equal(result.transitions, 2);
  assert.deepEqual(present(edge).supports.map(support => support.rule), ['a', 'z']);
});

test('manual inverse survives root retraction independently of its generated support', () => {
  const inverse = assertion({ id: 'manual-inverse', source: { library: 'self', key: 'BBBBBBBC' },
    target: { library: 'self', key: 'AAAAAAAB' }, type: 'referenced-by' });
  const before = graphFixture({ assertions: [assertion(), inverse] });
  const combined = evaluateGraph(before).relationships.find(edge => edge.type === 'referenced-by');
  assert.deepEqual(present(combined).assertions, ['manual-inverse']); assert.equal(present(combined).supports.length, 1);
  const after = { ...before, assertions: [inverse] }, remaining = evaluateGraph(after).relationships;
  assert.equal(remaining.length, 1); assert.deepEqual(remaining[0].assertions, ['manual-inverse']);
  assert.deepEqual(remaining[0].supports, []);
  const delta = changesBetween(before, after);
  assert.equal(delta.derived.removed.length, 1); assert.equal(delta.derived.updated.length, 1);
});

test('independent roots preserve their shared edge until every supporting root is removed', () => {
  const before = independent(), initial = evaluateGraph(before);
  assert.equal(initial.relationships.length, 3);
  assert.deepEqual(present(initial.relationships.find(edge => edge.type === 'join')).supports.map(value => value.root), ['a', 'b']);
  const one = { ...before, assertions: [before.assertions[1]] }, remaining = evaluateGraph(one);
  assert.deepEqual(remaining.relationships.map(edge => edge.type).sort(), ['join', 'root-b']);
  assert.deepEqual(present(remaining.relationships.find(edge => edge.type === 'join')).supports.map(value => value.root), ['b']);
  assert.deepEqual(evaluateGraph({ ...before, assertions: [] }), { relationships: [], transitions: 0 });
  const delta = changesBetween(before, one);
  assert.equal(delta.derived.removed.length, 1); assert.equal(delta.derived.updated.length, 1);
});

test('a late diamond route contributes after join expansion without losing its support', () => {
  const graph = diamond(), result = evaluateGraph(graph);
  assert.equal(result.relationships.length, 5); assert.equal(result.transitions, 5);
  const join = result.relationships.find(edge => edge.type === 'b-join');
  assert.deepEqual(present(join).supports.map(support => support.rule), ['left-join', 'right-join']);
  assert.equal(present(result.relationships.find(edge => edge.type === 'c-tail')).supports.length, 1);
  assert.equal(present(join).metadata.value, 'generated value');
  assert.equal(present(result.relationships.find(edge => edge.type === 'c-tail')).metadata.value, 'root value');
});

test('rule versions, edits, disabling and deletion produce complete deterministic deltas', () => {
  const before = graphFixture(), edited = structuredClone(before);
  edited.rules[0].version = 2;
  const changed = changesBetween(before, edited);
  assert.equal(changed.derived.updated.length, 1);
  assert.equal(changed.derived.updated[0].after.supports[0].version, 2);
  for (const rules of [[inverseRule({ enabled: false, version: 2 })], []]) {
    const delta = changesBetween(before, { ...before, rules });
    assert.equal(delta.derived.removed.length, 1); assert.equal(delta.derived.added.length, 0);
  }
});

test('rule and assertion array order never affect result or caller-owned objects', () => {
  const input = independent(), reordered = structuredClone(input);
  reordered.assertions.reverse(); reordered.rules.reverse(); reordered.types.reverse();
  assert.deepEqual(evaluateGraph(reordered), evaluateGraph(input));
  assert.deepEqual(changesBetween(input, reordered).derived, { added: [], updated: [], removed: [] });
  const first = evaluateGraph(input); first.relationships[0].metadata.value = 'caller mutation';
  first.relationships[0].source.key = 'CCCCCCCD';
  assert.equal(evaluateGraph(input).relationships[0].source.key, 'AAAAAAAB');
  assert.equal(input.assertions[0].metadata.value, 'same');
});

test('invalid and duplicate authoritative assertions are rejected without partial evaluation', () => {
  for (const input of [null, {}, graphFixture({ assertions: [assertion(), assertion({ id: 'duplicate' })] })]) {
    assert.throws(() => evaluateGraph(input));
  }
});

test('retargeting and retyping preserve manual identity while retracting obsolete closure', () => {
  const before = graphFixture(), moved = structuredClone(before);
  moved.assertions[0].target.key = 'CCCCCCCD';
  const delta = changesBetween(before, moved);
  assert.equal(delta.assertions.updated[0].after.id, before.assertions[0].id);
  assert.equal(delta.derived.removed.length, 2); assert.equal(delta.derived.added.length, 2);
  assert.deepEqual(delta.derived.updated, []);
  moved.assertions[0].type = 'similar';
  const retyped = evaluateGraph(moved);
  assert.equal(retyped.relationships.length, 1); assert.equal(retyped.relationships[0].type, 'similar');
  assert.deepEqual(retyped.relationships[0].supports, []);
});
