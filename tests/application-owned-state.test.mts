/** Public reads and drafts detach from validated private state while repository admission retains strict external-data checks. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { RelationshipApplication } from '../src/application/service.mts';
import { initialGraph } from '../src/application/seed.mts';
import { assertion } from './fixtures/graph-contract.mts';
import type { ApplicationGateway, RepositoryPort } from '../src/application/contracts.mts';
import type { Graph, ItemRef } from '../src/domain/contracts.mts';

/** Model only external repository/native-item resources; all application admission and review code remains real. @param graph External repository authority. @returns Production application, external graph and read counter. */
function fixture(graph?: Graph) {
  const stored = graph ?? initialGraph('self');
  if (!graph) stored.assertions.push(assertion({ metadata: { note: 'before' } }));
  let reads = 0;
  const repository: RepositoryPort = {
    async read() { reads++; return { state: 'ready', head: 'ABCDEFGH', snapshot: stored }; },
    async compareAndCommit() { throw new Error('Read/draft tests must not publish'); },
    async readHead() { throw new Error('Read/draft tests must not read recovery branches'); },
    async resolve() { throw new Error('Read/draft tests must not resolve conflicts'); },
    invalidate() { reads = 0; },
  };
  const gateway: ApplicationGateway = {
    ref() { throw new Error('Unexpected native-item conversion'); },
    async inspect(original) { return { original, resolved: original, status: 'active', editable: true, title: original.key }; },
    async resolve(original) { return { original, resolved: original, status: 'active' }; },
    async describe(ref) { return { ref, status: 'active', editable: true, title: ref.key }; },
    async assertWritable(_scope: string, refs: ItemRef[]) { assert.ok(refs.every(ref => ref.library === 'self')); },
  };
  const app = new RelationshipApplication({ gateway, repositoryFor: () => repository, repositoryForEvent: () => repository,
    now: () => '2026-11-06T00:00:00.000Z', newID: () => 'new-root', yieldToHost: async () => {},
    async digest(text) { return createHash('sha256').update(text).digest('hex'); } });
  return { app, stored, reads: () => reads };
}

test('external and public mutations do not change the privately admitted cached authority', async () => {
  const { app, stored, reads } = fixture(), first = await app.read('self');
  assert.equal(first.state, 'ready'); if (first.state !== 'ready') throw Error('Expected fixture authority');
  first.snapshot.assertions[0].metadata.note = 'public change'; stored.assertions[0].metadata.note = 'external change';
  const second = await app.read('self'); assert.equal(second.state, 'ready');
  if (second.state === 'ready') assert.equal(second.snapshot.assertions[0].metadata.note, 'before');
  assert.equal(reads(), 1); app.stop();
});

test('drafts and preview deltas are independent of the private current state and external repository', async () => {
  const { app, stored } = fixture(), root = stored.assertions[0];
  const draft = await app.draftUpdate(root.id, { source: root.source, target: root.target, type: root.type, metadata: { note: 'after' } }, 'self');
  const review = await app.preview(draft.command, draft.expectedRevision);
  review.changeSet.assertions.updated[0].before.metadata.note = 'mutated delta';
  review.snapshot.assertions[0].metadata.note = 'mutated preview';
  const state = await app.read('self'); assert.equal(state.state, 'ready');
  if (state.state === 'ready') assert.equal(state.snapshot.assertions[0].metadata.note, 'before');
  assert.equal(stored.assertions[0].metadata.note, 'before'); app.stop();
});

test('a repository accessor still fails strict admission without executing its hook', async () => {
  const raw = initialGraph('self'); raw.assertions.push(assertion()); let called = false;
  Object.defineProperty(raw.assertions[0].metadata, 'note', { enumerable: true, get() { called = true; return 'unsafe'; } });
  const { app } = fixture(raw); await assert.rejects(app.read('self'), { code: 'validation' });
  assert.equal(called, false); app.stop();
});
