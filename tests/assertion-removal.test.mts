/** Exact explicit multi-original removal proposals preserve all unselected authority and never mutate inputs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeRemoval } from '../src/application/assertion-commands.mts';
import { initialGraph } from '../src/application/seed.mts';
import { assertion, inverseRule } from './fixtures/graph-contract.mts';

/** Build independent manual originals and a rule which must survive their explicit removal. @returns {object} Valid authority. */
function graph() {
  return { ...initialGraph('self'), assertions: [assertion({ id: 'first', metadata: { note: 'Café 你好' } }),
    assertion({ id: 'second', type: 'similar', metadata: { note: 'Keep me' } }),
    assertion({ id: 'third', source: { library: 'self', key: 'CCCCCCCD' } })], rules: [inverseRule()] };
}

test('proposes exactly selected original removals and preserves remaining order, values, types and rules', () => {
  const before = graph(), after = proposeRemoval(before, ['third', 'first']);
  assert.deepEqual(after, { ...before, assertions: [before.assertions[1]] });
  assert.deepEqual(before.assertions.map(root => root.id), ['first', 'second', 'third']);
  after.assertions[0].metadata.note = 'caller'; after.types[0].fields[0].label = 'caller'; after.rules[0].enabled = false;
  assert.equal(before.assertions[1].metadata.note, 'Keep me'); assert.equal(before.types[0].fields[0].label, 'Note');
  assert.equal(before.rules[0].enabled, true);
});

test('permits explicit removal of every root while retaining declarations', () => {
  const before = graph(); assert.deepEqual(proposeRemoval(before, ['first', 'second', 'third']), { ...before, assertions: [] });
});

test('single-root removal uses the same exact identity semantics', () => {
  const before = graph(); assert.deepEqual(proposeRemoval(before, ['second']).assertions, [before.assertions[0], before.assertions[2]]);
});

for (const ids of [[], ['first', 'first'], ['missing'], ['first', 'missing'], [null], ['first\n'], 'first', null]) {
  test(`rejects malformed, duplicate or absent requested identities: ${JSON.stringify(ids)}`, () => {
    // @ts-expect-error Deliberately exercise malformed external original-ID selections.
    const before = graph(); assert.throws(() => proposeRemoval(before, ids), { code: 'validation' });
    assert.equal(before.assertions.length, 3); assert.equal(before.assertions[0].metadata.note, 'Café 你好');
  });
}

test('rejects invalid authority before producing any removal proposal', () => {
  assert.throws(() => proposeRemoval({ ...graph(), schema: 2 }, ['first']), { code: 'unsupported-schema' });
});
