/** Behavioral validation of portable v1 graphs before any persistence implementation. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGraph, edgeKey, validateItemRef } from '../src/domain/graph-contract.mts';
import { graphFixture, assertion, ruleTruthCases } from './fixtures/graph-contract.mts';

test('accepts the inverse example without storing computed support as authority', () => {
  const input = graphFixture();
  const valid = validateGraph(input);
  assert.deepEqual(valid, input);
  assert.notEqual(valid, input);
  valid.assertions[0].metadata.changed = true;
  assert.deepEqual(input.assertions[0].metadata, {});
});

test('item identities use containing-library scope and survive first account assignment', () => {
  assert.deepEqual(validateItemRef({ library: 'self', key: 'AAAAAAAB' }), { library: 'self', key: 'AAAAAAAB' });
  assert.equal(edgeKey(assertion()), edgeKey(assertion({ id: 'another' })));
  assert.notEqual(edgeKey(assertion()), edgeKey(assertion({ type: 'similar' })));
  assert.notEqual(edgeKey(assertion()), edgeKey(assertion({ source: assertion().target, target: assertion().source })));
});

test('group identities are explicit and cannot join a personal key by coincidence', () => {
  const edge = assertion({ source: { library: 'group:6749379', key: 'AAAAAAAB' },
    target: { library: 'group:6749379', key: 'BBBBBBBC' } });
  assert.equal(validateGraph(graphFixture({ library: 'group:6749379', assertions: [edge] })).library, 'group:6749379');
  assert.throws(() => validateGraph(graphFixture({ assertions: [edge] })), { code: 'validation' });
});

test('allows different types per pair and rejects duplicate logical triples', () => {
  const a = assertion(), b = assertion({ id: 'assertion-b', type: 'similar' });
  assert.equal(validateGraph(graphFixture({ assertions: [a, b] })).assertions.length, 2);
  assert.throws(() => validateGraph(graphFixture({ assertions: [a, { ...a, id: 'assertion-b' }] })), { code: 'validation' });
});

test('rejects self-links, mixed libraries, numeric runtime identities and malformed item keys', () => {
  for (const ref of [{ library: 'self', key: 12 }, { library: 'self', key: 'short' },
    { library: 'self', key: 'AAAAAAAB\n' }, { library: 'group:1\r', key: 'AAAAAAAB' },
    { library: 1, key: 'AAAAAAAB' }, { library: 'group:0', key: 'AAAAAAAB' },
    { library: 'self', key: 'AAAAAAAB', itemID: 3 }]) assert.throws(() => validateItemRef(ref));
  assert.throws(() => validateGraph(graphFixture({ assertions: [assertion({ target: assertion().source })] })));
  assert.throws(() => validateGraph(graphFixture({ assertions: [assertion({ target: { library: 'group:6749379', key: 'BBBBBBBC' } })] })));
});

test('preserves Unicode labels and rejects unknown types, IDs and envelope fields', () => {
  const graph = graphFixture();
  graph.types[0].label = 'Re\u0301fe\u0301rences 你好';
  assert.equal(validateGraph(graph).types[0].label, 'Références 你好');
  // @ts-expect-error Deliberately malformed runtime input must still fail validation.
  for (const input of [graphFixture({ computed: [] }), graphFixture({ types: [] }),
    graphFixture({ assertions: [assertion({ type: 'missing' })] }),
    graphFixture({ assertions: [assertion(), assertion({ type: 'similar' })] })]) {
    assert.throws(() => validateGraph(input));
  }
});

test('unknown schemas fail explicitly and invalid timestamps are rejected', () => {
  // @ts-expect-error Deliberately malformed runtime input must still fail validation.
  assert.throws(() => validateGraph(graphFixture({ schema: 2 })), { code: 'unsupported-schema' });
  for (const time of ['today', '2026-02-30T12:00:00.000Z', '2026-11-05', '2026-11-05T12:00:00+00:00']) {
    assert.throws(() => validateGraph(graphFixture({ assertions: [assertion({ createdAt: time })] })));
  }
  assert.throws(() => validateGraph(graphFixture({ assertions: [assertion({ updatedAt: '2020-01-01T00:00:00.000Z' })] })));
});

test('retired types preserve existing assertions while enabled rules cannot use them', () => {
  const graph = graphFixture({ rules: [] }); graph.types[0].retired = true;
  assert.equal(validateGraph(graph).assertions.length, 1);
  graph.rules = graphFixture().rules;
  assert.throws(() => validateGraph(graph));
});

test('frozen truth examples validate and their expected supports identify roots and rules', () => {
  for (const fixture of ruleTruthCases) {
    const graph = validateGraph(graphFixture({ rules: fixture.rules }));
    for (const support of fixture.expectedSupports) {
      assert.ok(graph.assertions.some(root => root.id === support.root));
      assert.ok(graph.rules.some(rule => rule.id === support.rule && rule.version === support.version));
      assert.ok(fixture.expectedEdges.some(([source, type, target]) => source === support.source && type === support.type && target === support.target));
    }
  }
});

test('rejects excessive assertion catalogs before publication', () => {
  const assertions = Array.from({ length: 1001 }, (_, i) => assertion({ id: `a-${i}`,
    source: { library: 'self', key: `A${String(i).padStart(7, '0')}` } }));
  assert.throws(() => validateGraph(graphFixture({ assertions })), { code: 'limit' });
});
