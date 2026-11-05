/** Fixed inference work limits and ordinary application rule-version transitions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGraph } from '../src/domain/evaluate.mjs';
import { validateRuleTransition } from '../src/application/rule-transition.mjs';
import { graphFixture, inverseRule } from './fixtures/graph-contract.mjs';
import { workGraph } from './fixtures/rules.mjs';

test('exactly 100000 matching transitions completes with all cyclic supports', () => {
  const input = workGraph(50), result = evaluateGraph(input);
  assert.equal(result.transitions, 100000); assert.equal(result.relationships.length, 2000);
  assert.equal(result.relationships.reduce((sum, edge) => sum + edge.supports.length, 0), 100000);
  assert.equal(input.assertions.length, 1000); assert.equal(input.rules.length, 50);
});

test('attempt 100001 aborts without returning or mutating partial state', () => {
  const input = workGraph(64), original = JSON.stringify(input);
  assert.throws(() => evaluateGraph(input), error => {
    assert.equal(error.code, 'limit'); assert.deepEqual(error.details, { limit: 100000, attempts: 100001 }); return true;
  });
  assert.equal(JSON.stringify(input), original);
});

test('failed predicates still count toward overflow rather than evading the bound', () => {
  const input = workGraph(64);
  input.types[0].fields = [{ id: 'note', label: 'Note', kind: 'string', required: false, options: [] }];
  for (const rule of input.rules.slice(1)) rule.conditions = [{ field: 'note', op: 'exists', value: true }];
  assert.throws(() => evaluateGraph(input), { code: 'limit' });
});

test('normal rule edits advance once while unchanged definitions retain version', () => {
  const before = graphFixture(), changed = structuredClone(before);
  changed.rules[0].enabled = false; changed.rules[0].version = 2;
  assert.doesNotThrow(() => validateRuleTransition(before, changed));
  assert.doesNotThrow(() => validateRuleTransition(before, before));
  assert.doesNotThrow(() => validateRuleTransition(before, { ...before, rules: [] }));
  for (const version of [1, 3]) {
    changed.rules[0].version = version;
    assert.throws(() => validateRuleTransition(before, changed), { code: 'validation' });
  }
});

test('new rules start at one and version-only or cross-library transitions fail', () => {
  const before = graphFixture({ rules: [] });
  assert.doesNotThrow(() => validateRuleTransition(before, graphFixture()));
  assert.throws(() => validateRuleTransition(before, graphFixture({ rules: [inverseRule({ version: 2 })] })), { code: 'validation' });
  const changed = graphFixture(); changed.rules[0].version = 2;
  assert.throws(() => validateRuleTransition(graphFixture(), changed), { code: 'validation' });
  assert.throws(() => validateRuleTransition(before, { ...before, library: 'group:123', assertions: [] }), { code: 'validation' });
});
