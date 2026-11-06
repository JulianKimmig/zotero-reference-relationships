/** Explicit external scheduling, cancellation and bounded work against actual evaluator source. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { evaluateGraphAsync, inspectProjectionAsync, inspectProjection } from '../src/domain/evaluate.mts';
import { graphFixture } from './fixtures/graph-contract.mts';
import { workGraph } from './fixtures/rules.mts';

for (const batchSize of [0, -1, 1.5, NaN, Infinity, 1001, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid batch size ${batchSize} rejects before invoking the scheduler`, async () => {
    let calls = 0;
    const cooperation = { batchSize, yieldToHost: async () => { calls++; }, assertActive: () => {} };
    await assert.rejects(evaluateGraphAsync(graphFixture(), cooperation), { code: 'validation' });
    await assert.rejects(inspectProjectionAsync(graphFixture(), [], cooperation), { code: 'validation' });
    assert.equal(calls, 0);
  });
}

test('all cooperation controls are required at runtime without a scheduler fallback', async () => {
  // @ts-expect-error Missing controls deliberately exercise untyped runtime callers.
  await assert.rejects(evaluateGraphAsync(graphFixture()), { code: 'validation' });
  // @ts-expect-error A batch size alone must never choose an implicit scheduler.
  await assert.rejects(inspectProjectionAsync(graphFixture(), [], { batchSize: 1 }), { code: 'validation' });
  // @ts-expect-error Scheduler callbacks must be callable.
  await assert.rejects(evaluateGraphAsync(graphFixture(), { batchSize: 1, yieldToHost: null, assertActive: () => {} }), { code: 'validation' });
  // @ts-expect-error An activity callback is required even when the scheduler is explicit.
  await assert.rejects(evaluateGraphAsync(graphFixture(), { batchSize: 1, yieldToHost: async () => {} }), { code: 'validation' });
});

for (const batchSize of [1, 1000]) {
  test(`valid batch endpoint ${batchSize} yields during no-rule manual/root/edge work`, async () => {
    const input = workGraph(0, 20);
    const rows = [input.assertions[0].source, ...input.assertions.map(root => root.target)]
      .map(original => ({ original, resolved: original, status: 'active' as const }));
    let yields = 0;
    const actual = await inspectProjectionAsync(input, rows, { batchSize,
      yieldToHost: async () => { yields++; }, assertActive: () => {} });
    assert.deepEqual(actual, inspectProjection(input, rows));
    if (batchSize === 1) assert.ok(yields >= input.assertions.length * 3, 'manual collection, roots and edges all cooperate');
  });
}

test('false matching predicates yield even when they generate no output', async () => {
  const input = workGraph(64, 2);
  input.types[0].fields = [{ id: 'note', label: 'Note', kind: 'string', required: false, options: [] }];
  for (const rule of input.rules) rule.conditions = [{ field: 'note', op: 'exists', value: true }];
  let yields = 0;
  const actual = await evaluateGraphAsync(input, { batchSize: 1,
    yieldToHost: async () => { yields++; }, assertActive: () => {} });
  assert.equal(actual.transitions, 128); assert.equal(actual.relationships.length, 2);
  assert.ok(yields >= 128, 'each failed matching transition remains cooperative work');
});

test('an actual host macroturn runs before evaluation completes', async () => {
  let heartbeat = false, completed = false;
  const host = immediate().then(() => { heartbeat = true; assert.equal(completed, false); });
  const result = await evaluateGraphAsync(workGraph(4, 60), { batchSize: 16,
    yieldToHost: async () => { await immediate(); }, assertActive: () => {} });
  completed = true; await host;
  assert.equal(heartbeat, true); assert.equal(result.transitions, 480);
});

test('cancellation before validation rejects without a scheduler call or partial result', async () => {
  const cancelled = new Error('inactive before work'); let yields = 0;
  await assert.rejects(inspectProjectionAsync(null, null, { batchSize: 1,
    yieldToHost: async () => { yields++; }, assertActive: () => { throw cancelled; } }), error => error === cancelled);
  assert.equal(yields, 0);
});

test('cancellation during no-rule manual collection rejects unchanged authority', async () => {
  const input = workGraph(0, 40), before = structuredClone(input), cancelled = new Error('manual cancellation');
  let active = true, yields = 0;
  await assert.rejects(evaluateGraphAsync(input, { batchSize: 1,
    yieldToHost: async () => { yields++; active = false; },
    assertActive: () => { if (!active) throw cancelled; } }), error => error === cancelled);
  assert.equal(yields, 1); assert.deepEqual(input, before);
});

test('cancellation from a real macroturn interrupts dense matching work without publishing', async () => {
  const input = workGraph(64, 782), before = structuredClone(input), cancelled = new Error('cancelled by host');
  let active = true, returned = false;
  const evaluation = evaluateGraphAsync(input, { batchSize: 1000,
    yieldToHost: async () => { await immediate(); }, assertActive: () => { if (!active) throw cancelled; } });
  const cancellation = immediate().then(() => { active = false; });
  await assert.rejects(evaluation.then(result => { returned = true; return result; }), error => error === cancelled);
  await cancellation; assert.equal(returned, false); assert.deepEqual(input, before);
});

test('a controllable pending scheduler cannot allow cancellation to return a report', async () => {
  const input = workGraph(1, 2), cancelled = new Error('cancelled while awaiting scheduler');
  let active = true, release: (() => void) | undefined;
  const pending = evaluateGraphAsync(input, { batchSize: 1,
    yieldToHost: () => new Promise<void>(resolve => { release = resolve; }),
    assertActive: () => { if (!active) throw cancelled; } });
  assert.ok(release); active = false; release();
  await assert.rejects(pending, error => error === cancelled);
});

test('scheduler rejection is propagated unchanged without a partial report', async () => {
  const failure = new Error('external scheduler failed');
  await assert.rejects(evaluateGraphAsync(workGraph(1, 2), { batchSize: 1,
    yieldToHost: async () => { throw failure; }, assertActive: () => {} }), error => error === failure);
});

test('activity is checked between steps even if the host has not been yielded a batch', async () => {
  let checks = 0, yields = 0; const cancelled = new Error('inactive inside a batch');
  await assert.rejects(evaluateGraphAsync(workGraph(1, 20), { batchSize: 1000,
    yieldToHost: async () => { yields++; }, assertActive: () => { if (++checks === 12) throw cancelled; } }), error => error === cancelled);
  assert.equal(yields, 0); assert.equal(checks, 12);
});
