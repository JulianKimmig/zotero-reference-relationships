/** Detached materialized pagination, including computed supports larger than the stored authority limit. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRelationshipIndex, queryRelationships } from '../src/application/relationship-index.mjs';
import { graphFixture } from './fixtures/graph-contract.mjs';
import { workGraph } from './fixtures/rules.mjs';

const source = { library: 'self', key: 'AAAAAAAB' };

test('materialized reads include manual and generated edges in stable order', () => {
  const index = buildRelationshipIndex(graphFixture());
  const result = queryRelationships(index, source, 'both', null, { offset: 0, limit: 25 });
  assert.equal(result.total, 2); assert.equal(result.nextOffset, null);
  assert.deepEqual(result.relationships.map(edge => edge.type), ['referencing', 'referenced-by']);
  assert.equal(queryRelationships(index, source, 'outgoing', null, { offset: 0, limit: 25 }).total, 1);
  const incoming = queryRelationships(index, source, 'incoming', 'referenced-by', { offset: 0, limit: 25 });
  assert.deepEqual(incoming.relationships[0].assertions, []); assert.equal(incoming.relationships[0].supports.length, 1);
});

test('pagination and caller mutations never alter the private materialized index', () => {
  const index = buildRelationshipIndex(graphFixture());
  const first = queryRelationships(index, source, 'both', null, { offset: 0, limit: 1 });
  assert.equal(first.nextOffset, 1); assert.equal(first.total, 2);
  first.relationships[0].source.key = 'CCCCCCCD'; first.relationships[0].metadata.note = 'caller';
  const second = queryRelationships(index, source, 'both', null, { offset: 1, limit: 1 });
  assert.equal(second.nextOffset, null); second.relationships[0].supports[0].source.key = 'CCCCCCCD';
  assert.equal(queryRelationships(index, source, 'both', null, { offset: 0, limit: 25 }).relationships[0].source.key, source.key);
  assert.equal(queryRelationships(index, source, 'both', null, { offset: 1, limit: 25 }).relationships[0].supports[0].source.key, 'BBBBBBBC');
  assert.deepEqual(queryRelationships(index, source, 'both', null, { offset: 9, limit: 1 }), { relationships: [], total: 2, nextOffset: null });
});

test('invalid query arguments fail instead of returning misleading empty data', () => {
  const index = buildRelationshipIndex(graphFixture()), page = { offset: 0, limit: 25 };
  for (const bad of [{ offset: -1, limit: 25 }, { offset: 0, limit: 101 }, { offset: 0, limit: 25, extra: true }]) {
    assert.throws(() => queryRelationships(index, source, 'both', null, bad), { code: 'validation' });
  }
  assert.throws(() => queryRelationships(index, source, 'sideways', null, page), { code: 'validation' });
  assert.throws(() => queryRelationships(index, source, 'both', 'unknown', page), { code: 'validation' });
  assert.throws(() => queryRelationships(index, { ...source, library: 'group:123' }, 'both', null, page), { code: 'validation' });
});

test('computed support pages can exceed 1 MiB while stored authority remains bounded', () => {
  const input = workGraph(64, 50);
  input.types[0].fields = [{ id: 'note', label: 'Note', kind: 'string', required: false, options: [] }];
  for (const rule of input.rules) rule.mapping = { note: { kind: 'constant', value: 'x'.repeat(64) } };
  const index = buildRelationshipIndex(input);
  const page = queryRelationships(index, source, 'both', null, { offset: 0, limit: 100 });
  assert.equal(page.relationships.length, 100); assert.ok(JSON.stringify(page).length > 1_048_576);
  page.relationships[0].supports[0].metadata.note = 'caller';
  assert.equal(queryRelationships(index, source, 'both', null, { offset: 0, limit: 1 }).relationships[0].supports[0].metadata.note, 'x'.repeat(64));
});
