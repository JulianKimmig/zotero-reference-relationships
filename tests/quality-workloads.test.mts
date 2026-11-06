/** Behavioral workload checks bind quality measurements to exact graph/rule shapes and visible work-limit failure. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { qualityGraph } from './fixtures/quality-workloads.mts';
import { evaluateGraph } from '../src/domain/evaluate.mts';
import { validateGraph } from '../src/domain/graph-contract.mts';

test('sparse quality workloads retain every original without generated relationships', () => {
  for (const count of [10, 100, 1000]) {
    const graph = validateGraph(qualityGraph('sparse', count));
    assert.equal(graph.assertions.length, count);
    assert.equal(graph.rules.length, 0);
    const result = evaluateGraph(graph);
    assert.equal(result.relationships.length, count); assert.equal(result.transitions, 0);
  }
});

test('reciprocal quality cycles terminate with both producing rules per original', () => {
  const result = evaluateGraph(qualityGraph('cycle', 10));
  assert.equal(result.transitions, 20); assert.equal(result.relationships.length, 20);
  assert.equal(result.relationships.reduce((total, edge) => total + edge.supports.length, 0), 20);
});

test('dense workload exercises exactly the allowed global transition boundary', () => {
  const result = evaluateGraph(qualityGraph('dense', 1000));
  assert.equal(result.transitions, 100000); assert.equal(result.relationships.length, 2000);
  assert.equal(result.relationships.reduce((total, edge) => total + edge.supports.length, 0), 100000);
});

test('over-limit workload rejects before publishing any partial result', () => {
  assert.throws(() => evaluateGraph(qualityGraph('over-limit', 1000)), error => {
    assert.ok(error !== null && typeof error === 'object' && 'code' in error && error.code === 'limit');
    assert.ok('details' in error && error.details !== null && typeof error.details === 'object'
      && 'attempts' in error.details && error.details.attempts === 100001); return true;
  });
});

test('measurement workloads reject empty, fractional and out-of-contract sizes', () => {
  for (const count of [0, -1, 1001, 1.5, NaN, Infinity]) assert.throws(() => qualityGraph('sparse', count));
});
