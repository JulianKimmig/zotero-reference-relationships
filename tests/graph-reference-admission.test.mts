/** Preserve strict reference admission, ordered-key compatibility and error precedence while eliminating repeated private copies. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGraph, validateItemRef, edgeKey } from '../src/domain/graph-contract.mts';
import { graphFixture, assertion } from './fixtures/graph-contract.mts';

test('ordered keys remain compatible regardless of reference property insertion order', () => {
  const root = assertion({ source: { key: 'AAAAAAAB', library: 'self' }, target: { key: 'BBBBBBBC', library: 'self' } });
  assert.equal(edgeKey(root), '["self","AAAAAAAB","referencing","self","BBBBBBBC"]');
  const graph = validateGraph(graphFixture({ assertions: [root] }));
  assert.deepEqual(Object.keys(graph.assertions[0].source), ['key', 'library']);
  assert.equal(edgeKey(graph.assertions[0]), edgeKey(root));
  assert.throws(() => validateGraph(graphFixture({ assertions: [root, { ...assertion(), id: 'other' }] })),
    { code: 'validation', message: 'Duplicate ordered relationship triple' });
});

test('shared input references become detached independent authority values', () => {
  const source = { library: 'self' as const, key: 'AAAAAAAB' }, first = assertion({ source });
  const input = graphFixture({ assertions: [first, assertion({ id: 'second', source, type: 'similar' })] });
  const graph = validateGraph(input);
  assert.notEqual(graph.assertions[0].source, source);
  assert.notEqual(graph.assertions[0].source, graph.assertions[1].source);
  graph.assertions[0].source.key = 'CCCCCCCD';
  assert.equal(source.key, 'AAAAAAAB'); assert.equal(graph.assertions[1].source.key, 'AAAAAAAB');
  assert.equal(input.assertions[0].source.key, 'AAAAAAAB');
});

for (const { patch, message } of [
  { patch: { source: { library: 'bad', key: 'short' }, target: { library: 'self', key: 'short' }, type: '!' }, message: 'Invalid library scope' },
  { patch: { target: { library: 'self', key: 'short' }, type: '!' }, message: 'Invalid item key' },
  { patch: { source: { library: 'group:2', key: 'AAAAAAAB' }, type: '!' }, message: 'Invalid stable identifier' },
  { patch: { source: { library: 'group:2', key: 'AAAAAAAB' } }, message: 'Cross-library relationship' },
]) test(`strict graph admission preserves reference/type diagnostic precedence: ${message}`, () => {
  assert.throws(() => validateGraph({ ...graphFixture(), assertions: [{ ...assertion(), ...patch }] }), { code: 'validation', message });
});

test('reference descriptors and extra fields remain rejected without invoking caller getters', () => {
  let reads = 0;
  const source = { library: 'self' };
  Object.defineProperty(source, 'key', { enumerable: true, get() { reads++; return 'AAAAAAAB'; } });
  assert.throws(() => validateItemRef(source), { code: 'validation' });
  assert.throws(() => validateGraph({ ...graphFixture(), assertions: [{ ...assertion(), source }] }), { code: 'validation' });
  assert.equal(reads, 0);
  for (const extra of [{ itemID: 7 }, { extra: false }]) {
    const reference = { library: 'self', key: 'AAAAAAAB', ...extra };
    assert.throws(() => validateItemRef(reference), { code: 'validation' });
    assert.throws(() => validateGraph({ ...graphFixture(), assertions: [{ ...assertion(), source: reference }] }), { code: 'validation' });
  }
});

test('group triple identity and graph scope remain distinct from same-key personal references', () => {
  const root = assertion({ source: { library: 'group:2', key: 'AAAAAAAB' }, target: { library: 'group:2', key: 'BBBBBBBC' } });
  assert.equal(edgeKey(root), '["group:2","AAAAAAAB","referencing","group:2","BBBBBBBC"]');
  assert.notEqual(edgeKey(root), edgeKey(assertion()));
  assert.equal(validateGraph(graphFixture({ library: 'group:2', assertions: [root] })).library, 'group:2');
  assert.throws(() => validateGraph(graphFixture({ assertions: [root] })), { code: 'validation' });
});

test('standalone ordered keys retain their broader contract while graph admission rejects self and cross-library links', () => {
  const first = assertion(), self = { ...first, target: first.source };
  const cross = { ...first, target: { library: 'group:2' as const, key: 'BBBBBBBC' } };
  assert.equal(edgeKey(self), '["self","AAAAAAAB","referencing","self","AAAAAAAB"]');
  assert.equal(edgeKey(cross), '["self","AAAAAAAB","referencing","group:2","BBBBBBBC"]');
  for (const root of [self, cross]) assert.throws(() => validateGraph(graphFixture({ assertions: [root] })), { code: 'validation' });
});
