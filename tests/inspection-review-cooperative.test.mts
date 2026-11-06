/** Cooperative endpoint/import boundaries preserve their synchronous contracts and do not expose suspended mutable inputs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { inspectEndpoints, inspectEndpointsAsync } from '../src/domain/inspect-endpoints.mts';
import { reviewTransfer, reviewTransferAsync } from '../src/transfer/review.mts';
import { transferGraph } from './fixtures/transfer.mts';
import { ContractError } from '../src/domain/values.mts';
import type { Graph, ItemRef } from '../src/domain/contracts.mts';

/** Provide complete external endpoint facts and explicit mapping without substituting domain behavior. @param graph Exact graph. @returns Test-only native-fact DTOs and complete mapping. */
function facts(graph: Graph) {
  const refs = new Map<string, ItemRef>();
  for (const root of graph.assertions) for (const ref of [root.source, root.target]) refs.set(ref.key, ref);
  const rows = [...refs.values()].map(original => ({ original, resolved: original as ItemRef | null, status: 'active', editable: true }));
  return { rows, mapping: { source: { kind: 'user', id: '123' }, target: { kind: 'user', id: '456' }, library: graph.library,
    endpoints: [...refs.values()].map(source => ({ source, target: source, mode: 'reference' })) } };
}

/** Supply real host macroturns; the activity callback represents an active external owner. @returns Required explicit controls. */
function cooperation() { return { batchSize: 4, yieldToHost: async () => { await immediate(); }, assertActive: () => {} }; }

for (const status of ['active', 'missing', 'ambiguous', 'cyclic', 'alias-limit']) {
  test(`cooperative endpoint inspection retains exact ${status} evidence`, async () => {
    const graph = transferGraph(), { rows } = facts(graph); rows[0].status = status;
    if (status !== 'active') rows[0].resolved = null;
    const input = rows.map(({ original, resolved, status }) => ({ original, resolved, status }));
    assert.deepEqual(await inspectEndpointsAsync(graph, input, cooperation()), inspectEndpoints(graph, input));
  });
}

test('cooperative import review equals complete initial and no-op reviews', async () => {
  const graph = transferGraph(), { rows, mapping } = facts(graph);
  for (const before of [null, graph]) assert.deepEqual(await reviewTransferAsync(before, graph, mapping, rows, cooperation()), reviewTransfer(before, graph, mapping, rows));
});

test('import inputs are detached before the first host suspension', async () => {
  const graph = transferGraph(), { rows, mapping } = facts(graph), expected = reviewTransfer(null, graph, mapping, rows);
  const pending = reviewTransferAsync(null, graph, mapping, rows, { batchSize: 4, assertActive: () => {},
    async yieldToHost() { graph.assertions[0].metadata.note = 'Mutation after start'; await immediate(); } });
  assert.deepEqual(await pending, expected);
});

test('cancellation propagates through import inspection without a partial result', async () => {
  const graph = transferGraph(), { rows, mapping } = facts(graph); let active = true;
  await assert.rejects(reviewTransferAsync(null, graph, mapping, rows, { batchSize: 1,
    async yieldToHost() { await immediate(); active = false; },
    assertActive() { if (!active) throw new ContractError('conflict', 'Import owner stopped'); } }), { code: 'conflict' });
});
