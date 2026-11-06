/** Real evaluator equivalence across rooted truth, projection conflicts and exact work limits. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGraph, evaluateGraphAsync, inspectProjection, inspectProjectionAsync } from '../src/domain/evaluate.mts';
import { ContractError } from '../src/domain/values.mts';
import type { Graph, ItemRef } from '../src/domain/contracts.mts';
import type { EndpointResolution } from '../src/domain/projection-contracts.mts';
import { assertion, graphFixture, ruleTruthCases } from './fixtures/graph-contract.mts';
import { diamond, independent, workGraph } from './fixtures/rules.mts';

/** Construct complete real endpoint observations, optionally merging sources. @param input Authority. @param merge Whether distinct sources alias the first source. @returns Complete observations. */
function observations(input: Graph, merge = false): EndpointResolution[] {
  const refs = new Map<string, ItemRef>(), sources = new Set(input.assertions.map(root => root.source.key));
  for (const root of input.assertions) for (const ref of [root.source, root.target]) refs.set(JSON.stringify(ref), ref);
  return [...refs.values()].map(original => ({ original, status: 'active',
    resolved: merge && sources.has(original.key) ? input.assertions[0].source : original }));
}

/** Use an explicit external scheduler for equivalence, without altering production code. @returns Required cooperation controls. */
function cooperation() { return { batchSize: 1000, yieldToHost: async () => {}, assertActive: () => {} }; }

for (const fixture of ruleTruthCases) {
  test(`async retains frozen ${fixture.name} truth, supports and ordering`, async () => {
    const input = graphFixture({ rules: fixture.rules }), rows = observations(input), before = structuredClone(input);
    assert.deepEqual(await evaluateGraphAsync(input, cooperation()), evaluateGraph(input));
    assert.deepEqual(await inspectProjectionAsync(input, rows, cooperation()), inspectProjection(input, rows));
    assert.deepEqual(input, before);
  });
}

for (const [name, input] of [['empty', graphFixture({ assertions: [], rules: [] })],
  ['sparse no-rule', workGraph(0, 30)], ['late diamond', diamond()], ['independent cycles', independent()]] as const) {
  test(`async deep equality for ${name} with detached deterministic results`, async () => {
    const rows = observations(input), before = structuredClone({ input, rows });
    const expected = inspectProjection(input, rows), actual = await inspectProjectionAsync(input, rows, cooperation());
    assert.deepEqual(actual, expected);
    assert.deepEqual(await evaluateGraphAsync(input, cooperation()), evaluateGraph(input));
    const reversed = structuredClone(input); reversed.assertions.reverse(); reversed.rules.reverse();
    assert.deepEqual(await inspectProjectionAsync(reversed, [...rows].reverse(), cooperation()), expected);
    if (actual.clusters.length) actual.clusters[0].source.key = 'ZZZZZZZZ';
    assert.deepEqual({ input, rows }, before);
  });
}

test('async inspection collects every conflicting witness while strict async evaluation rejects identically', async () => {
  const input = independent('different'), rows = observations(input), expected = inspectProjection(input, rows);
  assert.equal(expected.state, 'conflict'); assert.equal(expected.relationships, null);
  assert.deepEqual(await inspectProjectionAsync(input, rows, cooperation()), expected);
  let conflict: ContractError | undefined;
  try { evaluateGraph(input); } catch (error) { assert.ok(error instanceof ContractError); conflict = error; }
  assert.ok(conflict);
  await assert.rejects(evaluateGraphAsync(input, cooperation()), conflict);
});

for (const conflicting of [false, true]) {
  test(`async projected collisions retain independent roots (${conflicting ? 'conflict' : 'equal values'})`, async () => {
    const input = diamond();
    input.assertions.push(assertion({ ...input.assertions[0], id: 'other', source: { library: 'self', key: 'CCCCCCCD' },
      metadata: { value: conflicting ? 'other' : 'root value' } }));
    const rows = observations(input, true), before = structuredClone({ input, rows });
    const expected = inspectProjection(input, rows);
    assert.equal(expected.state, conflicting ? 'conflict' : 'ready');
    assert.deepEqual(await inspectProjectionAsync(input, rows, cooperation()), expected);
    assert.deepEqual({ input, rows }, before);
  });
}

test('async retains inactive and collapsed-root diagnostics exactly', async () => {
  const input = workGraph(2, 4), identity = observations(input);
  for (const rows of [identity.map(row => ({ ...row, resolved: input.assertions[0].source })),
    identity.map(row => row.original.key === input.assertions[0].source.key
      ? { ...row, resolved: null, status: 'missing' as const } : row)]) {
    const expected = inspectProjection(input, rows);
    assert.ok(expected.diagnostics.length); assert.deepEqual(expected.clusters, []);
    assert.deepEqual(await inspectProjectionAsync(input, rows, cooperation()), expected);
  }
});

test('exactly 100000 transitions produces a deep-equal complete report and strict result', async () => {
  const input = workGraph(50), rows = observations(input), expected = inspectProjection(input, rows);
  assert.equal(expected.transitions, 100000);
  assert.equal(expected.clusters.reduce((sum, cluster) => sum + cluster.supports.length, 0), 100000);
  assert.deepEqual(await inspectProjectionAsync(input, rows, cooperation()), expected);
  assert.deepEqual(await evaluateGraphAsync(input, cooperation()), evaluateGraph(input));
});

for (const falsePredicates of [false, true]) {
  test(`async attempt 100001 rejects with identical work details (${falsePredicates ? 'false predicates' : 'producing rules'})`, async () => {
    const input = workGraph(64, 782);
    if (falsePredicates) {
      input.types[0].fields = [{ id: 'note', label: 'Note', kind: 'string', required: false, options: [] }];
      for (const rule of input.rules.slice(1)) rule.conditions = [{ field: 'note', op: 'exists', value: true }];
    }
    const rows = observations(input), before = structuredClone({ input, rows });
    const expected = { code: 'limit', details: { limit: 100000, attempts: 100001 } };
    assert.throws(() => evaluateGraph(input), expected);
    assert.throws(() => inspectProjection(input, rows), expected);
    await assert.rejects(evaluateGraphAsync(input, cooperation()), expected);
    await assert.rejects(inspectProjectionAsync(input, rows, cooperation()), expected);
    assert.deepEqual({ input, rows }, before);
  });
}

test('merged independent projected roots retain the global attempt limit', async () => {
  const input = workGraph(64, 782), rows = observations(input).map(row => ({ ...row,
    resolved: row.original.key === input.assertions[0].source.key ? input.assertions[0].source : input.assertions[0].target }));
  const expected = { code: 'limit', details: { limit: 100000, attempts: 100001 } };
  assert.throws(() => inspectProjection(input, rows), expected);
  await assert.rejects(inspectProjectionAsync(input, rows, cooperation()), expected);
});

test('invalid authority and incomplete observations remain failures', async () => {
  for (const [input, code] of [[null, 'validation'], [{}, 'unsupported-schema'],
    [graphFixture({ assertions: [assertion(), assertion({ id: 'duplicate' })] }), 'validation']] as const) {
    assert.throws(() => evaluateGraph(input), { code });
    await assert.rejects(evaluateGraphAsync(input, cooperation()), { code });
    await assert.rejects(inspectProjectionAsync(input, [], cooperation()), { code });
  }
  await assert.rejects(inspectProjectionAsync(graphFixture(), [], cooperation()), { code: 'validation' });
});
