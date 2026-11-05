/** Declarative rule grammar and path-independent mapping contract checks. */
import { constantMapping } from './fixtures/evidence.mts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRules } from '../src/domain/rule-contract.mts';
import { graphFixture, inverseRule, relationshipType } from './fixtures/graph-contract.mts';

/** Metadata-aware root/output types. @returns {object[]} Catalog fixture. */
function types() {
  const result = graphFixture().types;
  for (const type of result) type.fields = [
    { id: 'score', label: 'Score', kind: 'number', required: false, options: [] },
    { id: 'text', label: 'Text', kind: 'string', required: false, options: [] },
  ];
  return result;
}

test('inverse and reciprocal cycle rules are valid declarations without executing them', () => {
  const rules = [inverseRule(), inverseRule({ id: 'back', inputType: 'referenced-by', outputType: 'referencing' })];
  assert.deepEqual(validateRules(types(), rules), rules);
});

test('conditions read explicit-root fields and mappings copy root values or typed constants', () => {
  const rule = inverseRule({ conditions: [{ field: 'score', op: 'eq', value: 2 }],
    mapping: { score: { kind: 'root', field: 'score' }, text: { kind: 'constant', value: 'e\u0301' } } });
  const valid = validateRules(types(), [rule]);
  assert.equal(constantMapping(valid[0].mapping.text).value, 'é');
  assert.equal(constantMapping(rule.mapping.text).value, 'e\u0301');
});

test('exists is explicit and accepts only a boolean, including optional root fields', () => {
  assert.equal(validateRules(types(), [inverseRule({ conditions: [{ field: 'score', op: 'exists', value: false }] })]).length, 1);
  // @ts-expect-error Deliberately malformed runtime input must still fail validation.
  assert.throws(() => validateRules(types(), [inverseRule({ conditions: [{ field: 'score', op: 'exists', value: null }] })]));
});

test('rejects path metadata, executable grammar, missing fields and invalid typed constants', () => {
  for (const changes of [
    { transform: 'eval' }, { sourceCode: 'return true' }, { rootType: 'missing' },
    { conditions: [{ field: 'missing', op: 'eq', value: 2 }] },
    { conditions: [{ field: 'score', op: 'eq', value: '2' }] },
    { conditions: [{ field: 'score', op: 'script', value: 2 }] },
    { mapping: { score: { kind: 'generated', field: 'score' } } },
    { mapping: { score: { kind: 'root', field: 'text' } } },
    { mapping: { score: { kind: 'constant', value: null } } },
    { mapping: { missing: { kind: 'constant', value: 2 } } },
  // @ts-expect-error Deliberately malformed runtime input must still fail validation.
  ]) assert.throws(() => validateRules(types(), [inverseRule(changes)]));
});

test('diamond paths require identical mappings per root and output type', () => {
  const catalog = [...types(), relationshipType('path-left'), relationshipType('path-right')];
  const rules = [
    inverseRule({ id: 'left', outputType: 'path-left', transform: 'same' }),
    inverseRule({ id: 'right', outputType: 'path-right', transform: 'same' }),
    inverseRule({ id: 'from-left', inputType: 'path-left', mapping: { score: { kind: 'root', field: 'score' } } }),
    inverseRule({ id: 'from-right', inputType: 'path-right', mapping: { score: { kind: 'root', field: 'score' } } }),
  ];
  assert.equal(validateRules(catalog, rules).length, 4);
  rules[3].mapping.score = { kind: 'constant', value: 3 };
  assert.throws(() => validateRules(catalog, rules), { code: 'validation' });
});

test('mapping equivalence ignores key insertion order and conditions remain root-only downstream', () => {
  const a = inverseRule({ mapping: { score: { kind: 'constant', value: 2 }, text: { kind: 'constant', value: 'é' } } });
  const b = inverseRule({ id: 'downstream', inputType: 'similar',
    conditions: [{ field: 'score', op: 'ne', value: 7 }],
    mapping: { text: { kind: 'constant', value: 'e\u0301' }, score: { kind: 'constant', value: 2 } } });
  assert.equal(validateRules(types(), [a, b]).length, 2);
});

test('required output fields must be mapped, duplicate identities and retired active types fail', () => {
  const catalog = types(); catalog[1].fields[0].required = true;
  assert.throws(() => validateRules(catalog, [inverseRule()]));
  assert.throws(() => validateRules(types(), [inverseRule(), inverseRule()]));
  const retired = types(); retired[1].retired = true;
  assert.throws(() => validateRules(retired, [inverseRule()]));
  assert.equal(validateRules(retired, [inverseRule({ enabled: false })]).length, 1);
});

test('root-to-output enum copies require a subset of allowed values', () => {
  const catalog = types();
  catalog[0].fields[0] = { id: 'score', label: 'Score', kind: 'enum', required: false, options: ['a', 'b'] };
  catalog[1].fields[0] = { id: 'score', label: 'Score', kind: 'enum', required: false, options: ['a'] };
  const rule = inverseRule({ mapping: { score: { kind: 'root', field: 'score' } } });
  assert.throws(() => validateRules(catalog, [rule]));
  catalog[1].fields[0].options.push('b');
  assert.equal(validateRules(catalog, [rule]).length, 1);
});

test('optional root fields cannot supply required outputs and excessive rules fail explicitly', () => {
  const catalog = types(); catalog[1].fields[0].required = true;
  assert.throws(() => validateRules(catalog, [inverseRule({ mapping: { score: { kind: 'root', field: 'score' } } })]));
  catalog[0].fields[0].required = true;
  assert.equal(validateRules(catalog, [inverseRule({ mapping: { score: { kind: 'root', field: 'score' } } })]).length, 1);
  assert.throws(() => validateRules(types(), Array.from({ length: 65 }, (_, i) => inverseRule({ id: `r-${i}` }))), { code: 'limit' });
});
