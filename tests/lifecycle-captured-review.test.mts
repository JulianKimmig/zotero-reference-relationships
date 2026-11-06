/** Already-validated private authorities retain input capture, review parity and cancellation without repeating generic validation. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { LifecycleProjection } from '../src/application/lifecycle.mts';
import { validateGraph } from '../src/domain/graph-contract.mts';
import { graphFixture } from './fixtures/graph-contract.mts';
import type { EvaluationCooperation } from '../src/domain/cooperative-traversal.mts';
import type { ItemRef } from '../src/domain/contracts.mts';
import type { Graph } from '../src/domain/contracts.mts';

/** Compose real lifecycle logic using only an external inspection port and actual digest. @param cooperation Explicit host scheduling/liveness. @param inspected Optional native-I/O observer. @returns Production lifecycle projection. */
function lifecycle(cooperation: EvaluationCooperation, inspected = () => {}) {
  return new LifecycleProjection({ async inspect(original: ItemRef) { inspected();
    return { original, resolved: original, status: 'active', editable: true, title: original.key }; } },
  async text => createHash('sha256').update(text).digest('hex'), cooperation);
}

/** Produce normalized, independently owned graph inputs of the kind captured by application preview. @returns Before/after authorities with one real metadata update. */
function graphs() {
  const raw = graphFixture();
  raw.types.find(type => type.id === 'referencing')!.fields.push({ id: 'note', kind: 'string', label: 'Note', required: false, options: [] });
  raw.assertions[0].metadata.note = 'before';
  const before = validateGraph(raw), after = validateGraph(before); after.assertions[0].metadata.note = 'after';
  return { before, after: validateGraph(after) };
}

test('captured review matches strict raw review and detaches all public delta/projection data', async () => {
  const input = graphs(), cooperation = { batchSize: 16, assertActive() {}, yieldToHost: async () => {} };
  const projection = lifecycle(cooperation), expected = await projection.review(input.before, input.after);
  const result = await projection.reviewCaptured(input.before, input.after);
  assert.deepEqual(result, expected);
  result.changeSet.assertions.updated[0].before.metadata.note = 'public mutation';
  result.changeSet.assertions.updated[0].after.metadata.note = 'public mutation';
  assert.equal(input.before.assertions[0].metadata.note, 'before'); assert.equal(input.after.assertions[0].metadata.note, 'after');
  assert.equal(result.projection.before.state, 'ready');
  if (result.projection.before.state === 'ready') result.projection.before.relationships[0].metadata.note = 'public projection mutation';
  assert.equal(input.before.assertions[0].metadata.note, 'before');
});

test('private normalized inputs are fully captured before the first host suspension', async () => {
  const input = graphs(); let turns = 0;
  const projection = lifecycle({ batchSize: 16, assertActive() {}, async yieldToHost() {
    if (turns++ === 0) { input.before.assertions[0].metadata.note = 'changed at yield'; input.after.assertions[0].metadata.note = 'changed at yield'; }
  } });
  const result = await projection.reviewCaptured(input.before, input.after);
  assert.ok(turns > 0);
  assert.equal(result.changeSet.assertions.updated[0].before.metadata.note, 'before');
  assert.equal(result.changeSet.assertions.updated[0].after.metadata.note, 'after');
});

test('cancellation at the first host opportunity propagates before native endpoint inspection', async () => {
  const input = graphs(), sentinel = new Error('Stopped before native observation'); let active = true, inspected = 0;
  const projection = lifecycle({ batchSize: 16, async yieldToHost() { active = false; },
    assertActive() { if (!active) throw sentinel; } }, () => { inspected++; });
  await assert.rejects(projection.reviewCaptured(input.before, input.after), error => error === sentinel);
  assert.equal(inspected, 0);
});

test('validated private graphs from another builtin realm do not execute inherited serialization hooks', async () => {
  const input = graphs();
  const foreign = runInNewContext('Object.defineProperty(Object.prototype, "toJSON", { value() { throw Error("Inherited serialization hook executed"); } }); JSON.parse(text)',
    { text: JSON.stringify(input.before) }) as Graph;
  assert.deepEqual(validateGraph(foreign), input.before);
  const projection = lifecycle({ batchSize: 16, assertActive() {}, yieldToHost: async () => {} });
  const result = await projection.reviewCaptured(foreign, input.after);
  assert.equal(result.changeSet.assertions.updated[0].before.metadata.note, 'before');
  assert.equal(result.changeSet.assertions.updated[0].after.metadata.note, 'after');
});
