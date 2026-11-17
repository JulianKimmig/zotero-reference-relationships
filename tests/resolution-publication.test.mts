/** Actual graph-repository recovery publication with native guard, receipt ownership, rollback and lifecycle boundaries. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolutionFixture, refused } from './fixtures/resolution.mts';

test('direct resolution publishes one immutable all-head generation through the strict factory', async () => {
  const f = await resolutionFixture(), before = f.notes.notes.size;
  const result = await f.app.applyResolution(f.graphs.proposed, f.heads);
  assert.deepEqual(Object.keys(result).sort(), ['branches', 'revision']);
  assert.deepEqual(result.branches.map(branch => branch.head), f.heads);
  assert.deepEqual(f.notes.boundaries, ['strict']); assert.equal(f.notes.notes.size, before + 2);
  assert.deepEqual(f.notes.notes.get(result.revision)!.body.parents, f.heads);
  assert.deepEqual(await f.notes.repository().read(), { state: 'ready', head: result.revision, snapshot: f.graphs.proposed });
  assert.ok(f.permissions.some(call => call.locked));
  for (const head of f.heads) await f.notes.repository().readHead(head); f.app.stop();
});

test('issued resolution receipt uses the independent event factory and returns per-head reviewed effects', async () => {
  const f = await resolutionFixture(), review = await f.app.previewResolution(f.graphs.proposed, f.heads);
  const expected = review.branches.map(({ head, changeSet }) => ({ head, changeSet: structuredClone(changeSet) }));
  f.notes.enclosing = true; const result = await f.app.applyReviewed(review);
  assert.deepEqual(result.branches, expected); assert.deepEqual(f.notes.boundaries, ['event']); f.app.stop();
});

test('direct resolution retains strict external-transaction rejection', async () => {
  const f = await resolutionFixture(); f.notes.enclosing = true;
  await refused(f, () => f.app.applyResolution(f.graphs.proposed, f.heads), 'storage'); f.app.stop();
});

test('resolution refuses cloned and foreign-generation receipts without publishing', async () => {
  const f = await resolutionFixture(), other = await resolutionFixture();
  const review = await f.app.previewResolution(f.graphs.proposed, f.heads);
  await refused(f, () => f.app.applyReviewed(structuredClone(review)), 'conflict');
  await refused(other, () => other.app.applyReviewed(review), 'conflict'); f.app.stop(); other.app.stop();
});

test('resolution refuses mutations to the issued snapshot, head set and native revision', async () => {
  const f = await resolutionFixture();
  for (const field of ['snapshot', 'heads', 'native']) {
    const review = await f.app.previewResolution(f.graphs.proposed, f.heads);
    if (field === 'snapshot') review.snapshot.assertions[0].metadata.note = 'unreviewed';
    if (field === 'heads') review.expectedHeads[0] = 'ZZZZZZZZ';
    if (field === 'native') review.endpointRevision = '0'.repeat(64);
    await refused(f, () => f.app.applyReviewed(review), 'conflict');
  }
  f.app.stop();
});

test('resolution display mutations never become private publication authority', async () => {
  const f = await resolutionFixture(), review = await f.app.previewResolution(f.graphs.proposed, f.heads);
  review.branches[1].changeSet.assertions.updated[0].after.metadata.note = 'display mutation';
  const result = await f.app.applyReviewed(review);
  assert.equal(result.branches[1].changeSet.assertions.updated[0].after.metadata.note, 'left');
  assert.deepEqual((await f.notes.repository().readHead(result.revision)).snapshot, f.graphs.proposed); f.app.stop();
});

test('changed conflict heads invalidate a previously issued review', async () => {
  const f = await resolutionFixture(), review = await f.app.previewResolution(f.graphs.proposed, f.heads);
  await f.notes.deliver(f.graphs.right, [f.heads[1]]);
  await refused(f, () => f.app.applyReviewed(review), 'conflict'); f.app.stop();
});

test('repository exact-head CAS refuses a branch arriving after fresh preflight but before the write lock', async () => {
  const f = await resolutionFixture(); let advanced = '';
  f.notes.beforeLock = async () => { advanced = await f.notes.deliver(f.graphs.right, [f.heads[1]]); f.notes.beforeLock = null; };
  const before = f.notes.notes.size;
  await assert.rejects(f.app.applyResolution(f.graphs.proposed, f.heads), { code: 'conflict' });
  assert.equal(f.notes.notes.size, before + 2);
  assert.deepEqual(await f.notes.repository().read(), { state: 'conflict', heads: [f.heads[0], advanced].sort() });
  for (const head of f.heads) await f.notes.repository().readHead(head); f.app.stop();
});

test('removed branch-only endpoints participate in fresh reviewed native-state rejection', async () => {
  const f = await resolutionFixture(), review = await f.app.previewResolution(f.graphs.proposed, f.heads);
  f.facts.set('CCCCCCCD', { resolved: null, status: 'missing' });
  await refused(f, () => f.app.applyReviewed(review), 'conflict'); f.app.stop();
});

test('removed branch-only endpoints are rechecked under the actual transaction guard', async () => {
  const f = await resolutionFixture(), review = await f.app.previewResolution(f.graphs.proposed, f.heads);
  f.notes.beforeLock = async () => { f.facts.set('CCCCCCCD', { resolved: null, status: 'missing' }); };
  await refused(f, () => f.app.applyReviewed(review), 'conflict'); assert.ok(f.permissions.some(call => call.locked)); f.app.stop();
});

test('resolution repeats native library permissions before and inside publication', async () => {
  const f = await resolutionFixture(), review = await f.app.previewResolution(f.graphs.proposed, f.heads);
  f.notes.writable = false; await refused(f, () => f.app.applyReviewed(review), 'permission');
  f.notes.writable = true; f.notes.beforeLock = async () => { f.notes.writable = false; };
  await refused(f, () => f.app.applyReviewed(review), 'permission'); f.app.stop();
});

test('resolution repeats changed endpoint permissions under the lock', async () => {
  const f = await resolutionFixture();
  f.notes.beforeLock = async () => { f.facts.set('AAAAAAAB', { editable: false }); };
  await refused(f, () => f.app.applyResolution(f.graphs.proposed, f.heads), 'permission'); f.app.stop();
});

test('failed manifest publication rolls back staged records and preserves both complete branches', async () => {
  const f = await resolutionFixture(), review = await f.app.previewResolution(f.graphs.proposed, f.heads);
  f.notes.staged = []; f.notes.failManifest = true;
  await refused(f, () => f.app.applyReviewed(review), 'storage');
  assert.ok(f.notes.staged.length > 0); for (const key of f.notes.staged) assert.equal(f.notes.notes.has(key), false);
  assert.deepEqual(await f.notes.repository().read(), { state: 'conflict', heads: f.heads }); f.app.stop();
});

test('stopping the owning generation expires its resolution receipts', async () => {
  const f = await resolutionFixture(), review = await f.app.previewResolution(f.graphs.proposed, f.heads); f.app.stop();
  await refused(f, () => f.app.applyReviewed(review), 'conflict');
});

test('stopping during inside-lock native inspection aborts without publishing', async () => {
  const f = await resolutionFixture(); f.controls.inspect = () => { if (f.notes.inLock) f.app.stop(); };
  await refused(f, () => f.app.applyResolution(f.graphs.proposed, f.heads), 'conflict');
});

test('teardown after native commit cannot turn committed recovery into a rejected result', async () => {
  const f = await resolutionFixture(); f.notes.afterCommit = () => f.app.stop();
  const result = await f.app.applyResolution(f.graphs.proposed, f.heads);
  assert.deepEqual((await f.notes.repository().readHead(result.revision)).snapshot, f.graphs.proposed);
});
