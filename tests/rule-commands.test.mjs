/** Versioned rule proposals preserve authority and reject invalid declarations before review. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeRuleChange } from '../src/application/rule-commands.mjs';
import { initialGraph } from '../src/application/seed.mjs';
import { changesBetween } from '../src/application/changes.mjs';
import { assertion, inverseRule } from './fixtures/graph-contract.mjs';

/** Make an editable rule without a caller-controlled version. @param {object} overrides Declaration edits. @returns {object} Exact editable definition. */
function definition(overrides = {}) {
  const { version, ...rule } = inverseRule({ mapping: { note: { kind: 'root', field: 'note' } }, ...overrides });
  return rule;
}

/** Seed real typed authority with one explicit root and optional rule. @param {boolean} withRule Include inverse declaration. @returns {object} Complete graph. */
function current(withRule = true) {
  const graph = initialGraph('self');
  graph.assertions.push(assertion({ metadata: { note: 'Root Café 你好' } }));
  if (withRule) graph.rules.push({ ...definition(), version: 1 });
  return graph;
}

test('creating a custom inverse starts at one and detaches input and authority', () => {
  const before = current(false), original = structuredClone(before), rule = definition();
  const after = proposeRuleChange(before, { kind: 'create', rule });
  assert.deepEqual(after.rules, [{ ...rule, version: 1 }]);
  assert.deepEqual(after.assertions, before.assertions);
  assert.deepEqual(after.types, before.types);
  assert.deepEqual(before, original);
  after.rules[0].mapping.note.field = 'detached';
  assert.equal(rule.mapping.note.field, 'note');
  assert.equal(before.rules.length, 0);
});

test('inverse review contains exact generated contribution and no assertion changes', () => {
  const before = current(false), after = proposeRuleChange(before, { kind: 'create', rule: definition() });
  const review = changesBetween(before, after);
  assert.deepEqual(review.assertions, { added: [], updated: [], removed: [] });
  assert.deepEqual(review.types, { added: [], updated: [], removed: [] });
  assert.equal(review.derived.added.length, 1);
  const edge = review.derived.added[0];
  assert.deepEqual([edge.source, edge.type, edge.target], [before.assertions[0].target, 'referenced-by', before.assertions[0].source]);
  assert.deepEqual(edge.assertions, []);
  assert.deepEqual(edge.metadata, { note: 'Root Café 你好' });
  assert.deepEqual(edge.supports, [{ root: 'assertion-a', rule: 'inverse', version: 1,
    source: edge.source, type: edge.type, target: edge.target, metadata: edge.metadata }]);
});

test('disable and re-enable advance once, with no authority promotion', () => {
  const before = current(), disabled = proposeRuleChange(before, { kind: 'update', rule: definition({ enabled: false }) });
  assert.equal(disabled.rules[0].version, 2);
  const removal = changesBetween(before, disabled);
  assert.equal(removal.derived.removed.length, 1);
  assert.deepEqual(disabled.assertions, before.assertions);
  const enabled = proposeRuleChange(disabled, { kind: 'update', rule: definition() });
  assert.equal(enabled.rules[0].version, 3);
  assert.equal(changesBetween(disabled, enabled).derived.added[0].supports[0].version, 3);
});

test('manual inverse survives disable and delete with original metadata and timestamp', () => {
  const before = current();
  before.assertions.push(assertion({ id: 'manual-inverse', source: before.assertions[0].target,
    type: 'referenced-by', target: before.assertions[0].source, metadata: {} }));
  for (const change of [{ kind: 'update', rule: definition({ enabled: false }) }, { kind: 'delete', id: 'inverse' }]) {
    const after = proposeRuleChange(before, change), review = changesBetween(before, after);
    assert.deepEqual(after.assertions, before.assertions);
    assert.equal(review.derived.removed.length, 0);
    assert.equal(review.derived.updated.length, 1);
    assert.deepEqual(review.derived.updated[0].after.assertions, ['manual-inverse']);
    assert.deepEqual(review.derived.updated[0].after.supports, []);
    assert.deepEqual(review.derived.updated[0].after.metadata, {});
  }
});

test('retype and transform are explicit versioned declaration edits', () => {
  const before = current(), rule = definition({ outputType: 'similar', transform: 'same' });
  const after = proposeRuleChange(before, { kind: 'update', rule });
  assert.equal(after.rules[0].version, 2);
  const review = changesBetween(before, after);
  assert.equal(review.derived.removed[0].type, 'referenced-by');
  assert.equal(review.derived.added[0].type, 'similar');
  assert.deepEqual(review.derived.added[0].source, before.assertions[0].source);
});

test('same definition in different key order and Unicode composition retains version', () => {
  const before = current();
  before.rules[0].mapping = { note: { kind: 'constant', value: 'é' } };
  const rule = Object.fromEntries(Object.entries(definition({ mapping: { note: { value: 'e\u0301', kind: 'constant' } } })).reverse());
  assert.deepEqual(proposeRuleChange(before, { kind: 'update', rule }), before);
});

test('conditions and explicit constant mappings retain false zero and empty values', () => {
  const before = current(false);
  before.types[0].fields.push({ id: 'flag', label: 'Flag', kind: 'boolean', required: false, options: [] });
  before.assertions[0].metadata.flag = false;
  before.types[1].fields.push({ id: 'number', label: 'Number', kind: 'number', required: true, options: [] });
  const rule = definition({ conditions: [{ field: 'flag', op: 'eq', value: false }, { field: 'note', op: 'exists', value: true }],
    mapping: { note: { kind: 'constant', value: '' }, number: { kind: 'constant', value: 0 } } });
  const after = proposeRuleChange(before, { kind: 'create', rule });
  assert.deepEqual(changesBetween(before, after).derived.added[0].metadata, { note: '', number: 0 });
});

test('symmetric reverse declaration reaches finite supports on the manual edge', () => {
  const before = current(false); before.assertions[0].type = 'similar';
  const after = proposeRuleChange(before, { kind: 'create', rule: definition({ rootType: 'similar', inputType: 'similar', outputType: 'similar' }) });
  const review = changesBetween(before, after);
  assert.equal(review.derived.added.length, 1);
  assert.equal(review.derived.updated.length, 1);
  assert.deepEqual(review.derived.updated[0].after.assertions, ['assertion-a']);
  assert.equal(review.derived.updated[0].after.supports.length, 1);
});

test('unknown update or delete and duplicate create reject without modifying callers', () => {
  const before = current(), original = structuredClone(before);
  for (const change of [{ kind: 'create', rule: definition() }, { kind: 'update', rule: definition({ id: 'missing' }) },
    { kind: 'delete', id: 'missing' }]) assert.throws(() => proposeRuleChange(before, change), { code: 'validation' });
  assert.deepEqual(before, original);
});

test('delete removes only the named declaration and supports', () => {
  const before = current();
  before.rules.push({ ...definition({ id: 'other' }), version: 1 });
  const after = proposeRuleChange(before, { kind: 'delete', id: 'inverse' });
  assert.deepEqual(after.rules, [before.rules[1]]);
  assert.deepEqual(after.assertions, before.assertions);
  const review = changesBetween(before, after);
  assert.equal(review.derived.updated.length, 1);
  assert.deepEqual(review.derived.updated[0].after.supports.map(support => support.rule), ['other']);
});

test('malformed commands and caller-controlled versions never enter authority', () => {
  const before = current(false), original = structuredClone(before);
  const invalid = [null, {}, { kind: 'toggle', rule: definition() }, { kind: 'create', rule: { ...definition(), version: 1 } },
    { kind: 'create', rule: definition(), extra: true }, { kind: 'delete', id: 'inverse', rule: definition() },
    { kind: 'create', rule: definition({ id: '' }) }, { kind: 'delete', id: '../bad' }];
  for (const change of invalid) assert.throws(() => proposeRuleChange(before, change), { code: 'validation' });
  assert.deepEqual(before, original);
});

test('unknown types and root fields, unsupported predicates and scripts fail even disabled', () => {
  const before = current(false), original = structuredClone(before);
  for (const overrides of [{ rootType: 'missing' }, { inputType: 'missing' }, { outputType: 'missing' },
    { conditions: [{ field: 'missing', op: 'eq', value: 'x' }] }, { conditions: [{ field: 'note', op: 'regex', value: '.*' }] },
    { conditions: [{ field: 'note', op: 'exists', value: 'true' }] }, { mapping: { note: { kind: 'eval', value: '1+1' } } },
    { transform: 'transitive' }]) {
    for (const enabled of [true, false]) assert.throws(() => proposeRuleChange(before,
      { kind: 'create', rule: definition({ ...overrides, enabled }) }), { code: 'validation' });
  }
  assert.deepEqual(before, original);
});

test('conflicting route mappings and required output omissions reject the proposal', () => {
  const before = current();
  assert.throws(() => proposeRuleChange(before, { kind: 'create', rule: definition({ id: 'competing', mapping: {} }) }), { code: 'validation' });
  before.types[1].fields[0].required = true;
  before.rules = [];
  for (const mapping of [{}, { note: { kind: 'root', field: 'note' } }]) {
    assert.throws(() => proposeRuleChange(before, { kind: 'create', rule: definition({ mapping }) }), { code: 'validation' });
  }
});

test('retired types require disabling and version overflow fails without mutation', () => {
  const before = current(false); before.types[1].retired = true;
  assert.throws(() => proposeRuleChange(before, { kind: 'create', rule: definition() }), { code: 'validation' });
  const disabled = proposeRuleChange(before, { kind: 'create', rule: definition({ enabled: false }) });
  disabled.rules[0].version = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(proposeRuleChange(disabled, { kind: 'update', rule: definition({ enabled: false }) }), disabled);
  const original = structuredClone(disabled);
  assert.throws(() => proposeRuleChange(disabled, { kind: 'update', rule: definition({ enabled: false, transform: 'same' }) }), { code: 'validation' });
  assert.deepEqual(disabled, original);
});

test('rule and condition limits apply to proposals and leave input untouched', () => {
  const before = current(false);
  for (let index = 0; index < 64; index++) before.rules.push({ ...definition({ id: `rule-${index}` }), version: 1 });
  const original = structuredClone(before);
  assert.throws(() => proposeRuleChange(before, { kind: 'create', rule: definition() }), { code: 'limit' });
  assert.deepEqual(before, original);
  assert.throws(() => proposeRuleChange(current(false), { kind: 'create', rule: definition({
    conditions: Array.from({ length: 17 }, () => ({ field: 'note', op: 'exists', value: true })),
  }) }), { code: 'limit' });
});
