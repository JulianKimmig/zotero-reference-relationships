/** Per-head recovery reviews bind all complete branches without inventing an aggregate authority. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolutionFixture, resolutionGraphs, refused, unionDigest } from './fixtures/resolution.mts';
import { assertion } from './fixtures/graph-contract.mts';
import { renderNote } from '../src/storage/chunks.mts';

test('resolution preview retains exact per-head effects, chosen versions and one complete native union without writes', async () => {
  const f = await resolutionFixture(), before = structuredClone(f.notes.notes);
  const review = await f.app.previewResolution(f.graphs.proposed, [...f.heads].reverse());
  assert.deepEqual(Object.keys(review).sort(), ['branches', 'endpointRevision', 'expectedHeads', 'snapshot']);
  assert.deepEqual(review.expectedHeads, f.heads); assert.deepEqual(review.branches.map(branch => branch.head), f.heads);
  assert.deepEqual(review.snapshot, f.graphs.proposed); assert.equal(review.snapshot.rules[0].version, 4);
  const [left, right] = review.branches;
  assert.deepEqual(left.changeSet.assertions, { added: [], updated: [], removed: [] });
  assert.deepEqual(left.changeSet.rules, { added: [], updated: [], removed: [] });
  assert.deepEqual(right.changeSet.assertions.updated.map(pair => [pair.before.metadata.note, pair.after.metadata.note]), [['right', 'left']]);
  assert.deepEqual(right.changeSet.assertions.removed.map(root => root.id), ['branch-only']);
  assert.deepEqual(right.changeSet.rules.updated.map(pair => [pair.before.version, pair.after.version]), [[7, 4]]);
  assert.equal(left.projection.before.state, 'ready'); assert.equal(right.projection.before.state, 'ready');
  if (left.projection.before.state === 'ready' && right.projection.before.state === 'ready') {
    assert.equal(left.projection.before.relationships.find(edge => edge.type === 'referencing')!.metadata.note, 'left');
    assert.equal(right.projection.before.relationships.find(edge => edge.type === 'referencing')!.metadata.note, 'right');
  }
  for (const branch of review.branches) { assert.equal(branch.projection.after.state, 'ready'); assert.equal(branch.projection.after.relationships.length, 2); }
  assert.deepEqual(f.inspected, ['AAAAAAAB', 'BBBBBBBC', 'CCCCCCCD', 'DDDDDDDE']);
  assert.equal(review.endpointRevision, await unionDigest(f.inspected));
  assert.deepEqual(f.notes.notes, before); assert.deepEqual(f.notes.boundaries, []); f.app.stop();
});

test('resolution captures caller snapshot and head array before suspension and detaches branch reports', async () => {
  const f = await resolutionFixture(), snapshot = structuredClone(f.graphs.proposed), heads = [...f.heads];
  const pending = f.app.previewResolution(snapshot, heads);
  snapshot.assertions[0].metadata.note = 'changed after call'; heads[0] = 'ZZZZZZZZ';
  const review = await pending; assert.equal(review.snapshot.assertions[0].metadata.note, 'left'); assert.deepEqual(review.expectedHeads, f.heads);
  review.branches[1].changeSet.assertions.updated[0].before.metadata.note = 'mutated display';
  review.branches[0].projection.after.relationships[0].metadata.note = 'mutated projection';
  assert.equal(review.branches[1].projection.after.relationships[0].metadata.note, 'left');
  assert.deepEqual((await f.notes.repository().readHead(f.heads[1])).snapshot, f.graphs.right); f.app.stop();
});

test('resolution preserves conflicted branch evidence and null derived delta while requiring a ready replacement', async () => {
  const graphs = resolutionGraphs();
  graphs.left.assertions.push(assertion({ id: 'collision', source: { library: 'self', key: 'CCCCCCCD' }, metadata: { note: 'different' } }));
  const f = await resolutionFixture(graphs);
  f.facts.set('CCCCCCCD', { resolved: { library: 'self', key: 'AAAAAAAB' } });
  const review = await f.app.previewResolution(graphs.proposed, f.heads);
  assert.equal(review.branches[0].projection.before.state, 'conflict');
  assert.equal(review.branches[0].changeSet.derived, null);
  assert.equal(review.branches[0].projection.after.state, 'ready'); f.app.stop();
});

test('resolution rejects malformed, duplicate and incomplete head sets without touching complete branches', async () => {
  const f = await resolutionFixture();
  for (const heads of [[], [f.heads[0]], [f.heads[0], f.heads[0]], ['lowercas', f.heads[1]]]) {
    await refused(f, () => f.app.previewResolution(f.graphs.proposed, heads), 'validation');
  }
  await refused(f, () => f.app.previewResolution(f.graphs.proposed, [f.heads[0], 'ZZZZZZZZ']), 'conflict'); f.app.stop();
});

test('resolution refuses pending authority rather than treating previous complete heads as current', async () => {
  const f = await resolutionFixture(), commit = f.notes.notes.get(f.heads[1])!;
  const records = commit.body.records as { key: string }[]; f.notes.notes.delete(records[0].key);
  const before = structuredClone(f.notes.notes);
  await assert.rejects(f.app.previewResolution(f.graphs.proposed, f.heads), { code: 'conflict' });
  assert.deepEqual(f.notes.notes, before); f.app.stop();
});

test('resolution propagates unknown-schema authority without writes', async () => {
  const f = await resolutionFixture(), note = f.notes.notes.get(f.heads[1])!;
  const body = { ...note.body, schema: 9 }; f.notes.notes.set(note.key, { ...note, body, html: renderNote(body) });
  const before = structuredClone(f.notes.notes);
  await assert.rejects(f.app.previewResolution(f.graphs.proposed, f.heads), { code: 'unsupported-schema' });
  assert.deepEqual(f.notes.notes, before); f.app.stop();
});

test('resolution preview requires library write permission even for removal of every assertion', async () => {
  const f = await resolutionFixture(), proposed = structuredClone(f.graphs.proposed); proposed.assertions = []; proposed.rules = [];
  f.notes.writable = false; await refused(f, () => f.app.previewResolution(proposed, f.heads), 'permission'); f.app.stop();
});

test('resolution rejects a changed assertion whose native endpoint is unavailable', async () => {
  const f = await resolutionFixture(); f.facts.set('AAAAAAAB', { resolved: null, status: 'missing' });
  await refused(f, () => f.app.previewResolution(f.graphs.proposed, f.heads), 'endpoint'); f.app.stop();
});

test('resolution preview stops at the first cooperative suspension without publishing or inspecting native items', async () => {
  const f = await resolutionFixture(); f.controls.yield = async () => { f.app.stop(); };
  await refused(f, () => f.app.previewResolution(f.graphs.proposed, f.heads), 'conflict'); assert.deepEqual(f.inspected, []);
});
