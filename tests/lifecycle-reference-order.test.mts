/** Lifecycle native observation order remains canonical and detached for already-normalized portable reference facts. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { LifecycleProjection } from '../src/application/lifecycle.mts';
import { canonicalJSON } from '../src/storage/canonical.mts';
import { graphFixture, assertion } from './fixtures/graph-contract.mts';
import type { ItemRef } from '../src/domain/contracts.mts';

test('native observation deduplicates and orders normalized reference identities exactly as canonical JSON', async () => {
  const refs: ItemRef[] = [{ library: 'self', key: 'ZZZZZZZZ' }, { library: 'group:2', key: 'AAAAAAAA' },
    { library: 'self', key: 'AAAAAAAA' }, { library: 'group:10', key: 'AAAAAAAA' }];
  const graph = graphFixture({ assertions: refs.map((source, index) => assertion({ id: `root-${index}`, source, target: refs[0] })) });
  const observed: ItemRef[] = [];
  const projection = new LifecycleProjection({ async inspect(original) { observed.push({ ...original });
    return { original, resolved: original, status: 'active', editable: true, title: 'Observed' }; } },
  async text => createHash('sha256').update(text).digest('hex'), { yieldToHost: async () => {}, assertActive() {}, batchSize: 2 });
  const expected = [...new Map(refs.map(ref => [canonicalJSON(ref), ref])).entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, ref]) => ref);
  await projection.observe([graph, graph]); assert.deepEqual(observed, expected);
  assert.deepEqual(refs[0], { library: 'self', key: 'ZZZZZZZZ' });
});
