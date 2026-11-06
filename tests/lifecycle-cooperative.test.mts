/** Actual lifecycle projection must use its explicit host scheduler and honor service stop across native I/O and closure. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setImmediate as immediate } from 'node:timers/promises';
import { LifecycleProjection } from '../src/application/lifecycle.mts';
import { ContractError } from '../src/domain/values.mts';
import { qualityGraph } from './fixtures/quality-workloads.mts';
import type { ItemRef } from '../src/domain/contracts.mts';

/** Model only external native item inspection with actual supplied reference facts; production projection/evaluation remain real. @param onInspect Optional external event during native observation. @returns Explicit inspection port. */
function gateway(onInspect = () => {}) {
  return { async inspect(original: ItemRef) { onInspect(); return { original, resolved: original, status: 'active' as const, editable: true, title: original.key }; } };
}

/** Compute actual SHA-256 for semantic native binding. @param text Canonical native observations. @returns Real digest promise. */
async function digest(text: string): Promise<string> { return createHash('sha256').update(text).digest('hex'); }

test('lifecycle current projection yields real host turns for sparse and cyclic work', async () => {
  for (const shape of ['sparse', 'cycle'] as const) {
    let turns = 0;
    const lifecycle = new LifecycleProjection(gateway(), digest, { batchSize: 16,
      yieldToHost: async () => { await immediate(); turns++; }, assertActive: () => {} });
    const result = await lifecycle.current(qualityGraph(shape, 100));
    assert.equal(result.report.state, 'ready'); assert.ok(turns > 2, 'Actual lifecycle work ignored host scheduling');
  }
});

test('service stop during an actual native inspection rejects without returning a partial projection', async () => {
  let active = true, calls = 0;
  const lifecycle = new LifecycleProjection(gateway(() => { if (++calls === 5) active = false; }), digest, { batchSize: 16,
    yieldToHost: async () => { await immediate(); }, assertActive() { if (!active) throw new ContractError('conflict', 'Stopped during native observation'); } });
  await assert.rejects(lifecycle.current(qualityGraph('cycle', 100)), { code: 'conflict' });
});

test('lifecycle composition requires explicit scheduling rather than choosing an implicit fallback', () => {
  // @ts-expect-error Missing host cooperation must fail for untyped callers.
  assert.throws(() => new LifecycleProjection(gateway(), digest), { code: 'validation' });
});
