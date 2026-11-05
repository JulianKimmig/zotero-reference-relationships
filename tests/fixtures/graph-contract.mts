/** Concrete v1 graph inputs and manually specified rule outcomes, not an evaluator. */
import type { Assertion, Graph, RelationshipType, Rule } from '../../src/domain/contracts.mts';

/** Build an empty-schema type. @param {string} id Stable identity. @returns {object} Type. */
export function relationshipType(id: string): RelationshipType {
  return { id, label: id, description: '', version: 1, retired: false, fields: [] };
}

/** Build a rooted declarative rule. @param {object} changes Explicit overrides. @returns {object} Rule. */
export function inverseRule(changes: Partial<Rule> = {}): Rule {
  return { id: 'inverse', version: 1, enabled: true, rootType: 'referencing',
    inputType: 'referencing', outputType: 'referenced-by', transform: 'reverse',
    conditions: [], mapping: {}, ...changes };
}

/** Build one explicit same-library assertion. @param {object} changes Overrides. @returns {object} Assertion. */
export function assertion(changes: Partial<Assertion> = {}): Assertion {
  return { id: 'assertion-a', source: { library: 'self', key: 'AAAAAAAB' },
    target: { library: 'self', key: 'BBBBBBBC' }, type: 'referencing', metadata: {},
    createdAt: '2026-11-05T12:00:00.000Z', updatedAt: '2026-11-05T12:00:00.000Z', ...changes };
}

/** Build the user's exact inverse example. @param {object} changes Overrides. @returns {object} Snapshot. */
export function graphFixture(changes: Partial<Graph> = {}): Graph {
  return { schema: 1, library: 'self',
    types: ['referencing', 'referenced-by', 'similar'].map(relationshipType),
    assertions: [assertion()], rules: [inverseRule()], ...changes };
}

/** Manually enumerated closure cases for TASK-008; edge tuples are source/type/target. */
export const ruleTruthCases = [
  { name: 'inverse', rules: [inverseRule()],
    expectedEdges: [['AAAAAAAB', 'referencing', 'BBBBBBBC'], ['BBBBBBBC', 'referenced-by', 'AAAAAAAB']],
    expectedSupports: [{ root: 'assertion-a', rule: 'inverse', version: 1,
      source: 'BBBBBBBC', type: 'referenced-by', target: 'AAAAAAAB', metadata: {} }] },
  { name: 'disabled', rules: [inverseRule({ enabled: false })],
    expectedEdges: [['AAAAAAAB', 'referencing', 'BBBBBBBC']], expectedSupports: [] },
  { name: 'reciprocal-cycle', rules: [inverseRule(), inverseRule({ id: 'back',
    inputType: 'referenced-by', outputType: 'referencing' })],
    expectedEdges: [['AAAAAAAB', 'referencing', 'BBBBBBBC'], ['BBBBBBBC', 'referenced-by', 'AAAAAAAB']],
    expectedSupports: [
      { root: 'assertion-a', rule: 'back', version: 1, source: 'AAAAAAAB',
        type: 'referencing', target: 'BBBBBBBC', metadata: {} },
      { root: 'assertion-a', rule: 'inverse', version: 1, source: 'BBBBBBBC',
        type: 'referenced-by', target: 'AAAAAAAB', metadata: {} },
    ] },
];
