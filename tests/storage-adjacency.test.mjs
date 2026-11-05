/** Real snapshot adjacency indexes, detached results and stable explicit-assertion pagination. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdjacency, queryAdjacency } from '../src/storage/adjacency.mjs';
import { graphFixture, assertion } from './fixtures/graph-contract.mjs';

test('indexes outgoing and incoming assertions while retaining distinct types', () => {
  const graph = graphFixture({ assertions: [assertion(), assertion({ id: 'similar', type: 'similar' }),
    assertion({ id: 'reverse', source: assertion().target, target: assertion().source })] });
  const index = buildAdjacency(graph), page = { offset: 0, limit: 100 };
  assert.equal(queryAdjacency(index, assertion().source, 'outgoing', null, page).total, 2);
  assert.equal(queryAdjacency(index, assertion().source, 'incoming', null, page).total, 1);
  assert.equal(queryAdjacency(index, assertion().source, 'both', null, page).total, 3);
  assert.deepEqual(queryAdjacency(index, assertion().source, 'outgoing', 'similar', page).assertions.map(edge => edge.id), ['similar']);
});

test('returns stable pages and ordinary detached assertion values', () => {
  const graph = graphFixture({ assertions: Array.from({ length: 12 }, (_, i) => assertion({ id: `root-${i}`,
    target: { library: 'self', key: `B${String(i).padStart(7, '0')}` } })) });
  const index = buildAdjacency(graph);
  const first = queryAdjacency(index, assertion().source, 'both', null, { offset: 0, limit: 5 });
  assert.equal(first.total, 12); assert.equal(first.nextOffset, 5);
  const last = queryAdjacency(index, assertion().source, 'both', null, { offset: 10, limit: 5 });
  assert.equal(last.assertions.length, 2); assert.equal(last.nextOffset, null);
  const empty = queryAdjacency(index, assertion().source, 'both', null, { offset: 99, limit: 5 });
  assert.equal(empty.assertions.length, 0); assert.equal(empty.nextOffset, null);
  first.assertions[0].metadata.changed = true;
  graph.assertions.length = 0;
  assert.deepEqual(queryAdjacency(index, assertion().source, 'both', null, { offset: 0, limit: 1 }).assertions[0].metadata, {});
});

test('rejects unknown filters, mixed scopes and malformed direction/pages', () => {
  const index = buildAdjacency(graphFixture());
  for (const page of [{ offset: -1, limit: 10 }, { offset: 0, limit: 0 }, { offset: 0, limit: 101 },
    { offset: 0.5, limit: 5 }, { offset: 0, limit: 5, extra: true }]) {
    assert.throws(() => queryAdjacency(index, assertion().source, 'both', null, page), { code: 'validation' });
  }
  assert.throws(() => queryAdjacency(index, assertion().source, 'wrong', null, { offset: 0, limit: 5 }));
  assert.throws(() => queryAdjacency(index, assertion().source, 'both', 'missing', { offset: 0, limit: 5 }));
  assert.throws(() => queryAdjacency(index, { library: 'group:1', key: 'AAAAAAAB' }, 'both', null, { offset: 0, limit: 5 }));
});
