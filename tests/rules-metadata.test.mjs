/** Root-only predicates, mapped primitive values, path independence and conflict diagnostics. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGraph } from '../src/domain/evaluate.mjs';
import { changesBetween } from '../src/application/changes.mjs';
import { edgeKey } from '../src/domain/graph-contract.mjs';
import { graphFixture, assertion, inverseRule } from './fixtures/graph-contract.mjs';
import { initialGraph } from '../src/application/seed.mjs';
import { diamond, independent } from './fixtures/rules.mjs';

/** Build the user's inverse with optional mapped note metadata. @param {object} metadata Root values. @returns {object} Valid graph. */
function mapped(metadata) {
  const graph = initialGraph('self'); graph.assertions = [assertion({ metadata })];
  graph.rules = [inverseRule({ mapping: { note: { kind: 'root', field: 'note' } } })];
  return graph;
}

test('absent optional root fields contribute nothing, while empty present text stays present', () => {
  for (const metadata of [{}, { note: '' }, { note: 'e\u0301' }]) {
    const result = evaluateGraph(mapped(metadata));
    const inverse = result.relationships.find(edge => edge.type === 'referenced-by');
    assert.deepEqual(inverse.metadata, Object.hasOwn(metadata, 'note') ? { note: metadata.note.normalize('NFC') } : {});
  }
});

test('eq and ne are false for absent values and exists checks own-key presence', () => {
  for (const [op, value, wanted] of [['eq', 'x', false], ['ne', 'x', false], ['exists', true, false], ['exists', false, true]]) {
    const graph = mapped({}); graph.rules[0].conditions = [{ field: 'note', op, value }];
    const result = evaluateGraph(graph);
    assert.equal(result.relationships.length, wanted ? 2 : 1); assert.equal(result.transitions, 1);
  }
  const graph = mapped({ note: '' }); graph.rules[0].conditions = [{ field: 'note', op: 'exists', value: true }];
  assert.equal(evaluateGraph(graph).relationships.length, 2);
});

test('AND conditions use immutable root metadata even on downstream generated values', () => {
  const graph = diamond();
  graph.rules.at(-1).conditions.push({ field: 'value', op: 'ne', value: 'generated value' }, { field: 'value', op: 'exists', value: true });
  assert.ok(evaluateGraph(graph).relationships.some(edge => edge.type === 'c-tail'));
  graph.rules.at(-1).conditions[0].value = 'generated value';
  assert.ok(!evaluateGraph(graph).relationships.some(edge => edge.type === 'c-tail'));
});

test('present false and numeric zero survive root mappings and typed comparisons', () => {
  const graph = mapped({});
  const fields = [{ id: 'flag', label: 'Flag', kind: 'boolean', required: true, options: [] },
    { id: 'count', label: 'Count', kind: 'number', required: true, options: [] }];
  graph.types.find(type => type.id === 'referencing').fields = fields;
  graph.types.find(type => type.id === 'referenced-by').fields = structuredClone(fields);
  graph.assertions[0].metadata = { flag: false, count: 0 };
  graph.rules[0].mapping = { count: { kind: 'root', field: 'count' }, flag: { kind: 'root', field: 'flag' } };
  graph.rules[0].conditions = [{ field: 'count', op: 'eq', value: 0 }, { field: 'flag', op: 'eq', value: false }];
  assert.deepEqual(evaluateGraph(graph).relationships.find(edge => edge.type === 'referenced-by').metadata, { count: 0, flag: false });
});

test('normalized constants and root values combine fieldwise without overwriting missing manual values', () => {
  const graph = mapped({ note: 'é' });
  graph.assertions.push(assertion({ id: 'manual-inverse', source: graph.assertions[0].target,
    target: graph.assertions[0].source, type: 'referenced-by', metadata: {} }));
  const before = structuredClone(graph);
  const edge = evaluateGraph(graph).relationships.find(edge => edge.type === 'referenced-by');
  assert.deepEqual(edge.metadata, { note: 'é' }); assert.deepEqual(edge.assertions, ['manual-inverse']);
  assert.deepEqual(graph, before); assert.deepEqual(graph.assertions[1].metadata, {});
  graph.assertions[1].metadata.note = 'e\u0301'; graph.rules[0].mapping = { note: { kind: 'constant', value: 'é' } };
  assert.equal(evaluateGraph(graph).relationships.length, 2);
});

test('manual/generated conflicts identify both contributors and never mutate the input', () => {
  const graph = mapped({ note: 'root value' });
  graph.assertions.push(assertion({ id: 'manual', source: graph.assertions[0].target,
    target: graph.assertions[0].source, type: 'referenced-by', metadata: { note: 'manual value' } }));
  const original = structuredClone(graph);
  assert.throws(() => evaluateGraph(graph), error => {
    assert.equal(error.code, 'conflict');
    assert.deepEqual(error.details, { key: edgeKey(graph.assertions[1]), field: 'note', contributors: [
      { kind: 'assertion', id: 'manual', value: 'manual value' },
      { kind: 'support', root: 'assertion-a', rule: 'inverse', version: 1, value: 'root value' },
    ] });
    return true;
  });
  assert.deepEqual(graph, original);
});

test('independent-root conflict diagnostics are stable under input ordering', () => {
  const graph = independent('different'), original = structuredClone(graph);
  let first;
  assert.throws(() => evaluateGraph(graph), error => { assert.equal(error.code, 'conflict'); first = error.details; return true; });
  graph.assertions.reverse(); graph.rules.reverse();
  assert.throws(() => evaluateGraph(graph), error => { assert.deepEqual(error.details, first); return true; });
  assert.equal(first.field, 'value');
  assert.deepEqual(first.contributors.map(value => value.root), ['a', 'b']);
  assert.deepEqual(original.assertions[0].metadata, { value: 'same' });
});

test('different mappings on diamond routes are rejected before any runtime result', () => {
  const graph = diamond(); graph.rules.find(rule => rule.id === 'right-join').mapping.value.value = 'other';
  assert.throws(() => evaluateGraph(graph), { code: 'validation' });
});

test('metadata updates recompute both manual and generated edges with exact before/after values', () => {
  const before = mapped({ note: 'before' }), after = structuredClone(before); after.assertions[0].metadata.note = 'after';
  const delta = changesBetween(before, after);
  assert.equal(delta.assertions.updated.length, 1); assert.equal(delta.derived.updated.length, 2);
  assert.deepEqual(delta.derived.updated.map(value => value.before.metadata.note), ['before', 'before']);
  assert.deepEqual(delta.derived.updated.map(value => value.after.metadata.note), ['after', 'after']);
});

test('unsupported grammar and invalid mapped metadata never become partial output', () => {
  const graph = graphFixture(); graph.rules[0].transform = 'execute';
  assert.throws(() => evaluateGraph(graph), { code: 'validation' });
  const invalid = mapped({ note: 'x' }); invalid.rules[0].mapping.note = { kind: 'constant', value: null };
  assert.throws(() => evaluateGraph(invalid), { code: 'validation' });
});
