/** Cooperative differences preserve normalized JSON comparison semantics while yielding within large contributor arrays. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { entityDelta, entityDeltaAsync } from '../src/application/changes.mts';
import { ContractError } from '../src/domain/values.mts';

/** Explicit actual host scheduler with an external active-owner check. @returns Required cooperation. */
function cooperation() { return { batchSize: 64, yieldToHost: async () => { await immediate(); }, assertActive: () => {} }; }

test('cooperative differences retain sorted added/updated/removed entities and JSON property ordering', async () => {
  const before = [{ id: 'b', value: { first: false, second: 0 } }, { id: 'a', value: { first: true, second: 2 } }];
  const after = [{ id: 'c', value: { first: false, second: 3 } }, { id: 'b', value: { second: 0, first: false } }];
  assert.deepEqual(await entityDeltaAsync(before, after, 'id', cooperation()), entityDelta(before, after, 'id'));
});

test('large equal contributor arrays yield before comparison completes without serializing a giant entity', async () => {
  const before = [{ key: 'edge', supports: Array.from({ length: 10000 }, (_, id) => ({ id, metadata: { text: 'Café 你好', value: id % 2 === 0 } })) }];
  const after = structuredClone(before); let turns = 0;
  const actual = await entityDeltaAsync(before, after, 'key', { ...cooperation(), yieldToHost: async () => { await immediate(); turns++; } });
  assert.deepEqual(actual, entityDelta(before, after, 'key')); assert.ok(turns > 100, 'A single large relationship monopolized comparison');
});

test('a change near the end of nested contributors retains exact before/after values', async () => {
  const before = [{ id: 'root', payload: [null, true, false, 0, '', { nested: [1, 2, 3] }] }];
  const after = structuredClone(before); after[0].payload.push('changed');
  assert.deepEqual(await entityDeltaAsync(before, after, 'id', cooperation()), entityDelta(before, after, 'id'));
});

test('cancellation during comparison rejects without exposing a partial ChangeSet', async () => {
  const values = [{ id: 'edge', supports: Array.from({ length: 200 }, (_, id) => ({ id })) }]; let active = true;
  await assert.rejects(entityDeltaAsync(values, structuredClone(values), 'id', { batchSize: 1,
    async yieldToHost() { await immediate(); active = false; },
    assertActive() { if (!active) throw new ContractError('conflict', 'Review canceled'); } }), { code: 'conflict' });
});
