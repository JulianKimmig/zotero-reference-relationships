/** Explicit rooted inference inputs with manually chosen paths, metadata and work counts. */
import { assertion, relationshipType, inverseRule } from './graph-contract.mjs';

/** Define an optional text value schema. @param {string} id Stable type ID. @returns {object} RelationshipType. */
export function valueType(id) {
  return { ...relationshipType(id), fields: [{ id: 'value', label: 'Value', kind: 'string', required: false, options: [] }] };
}

/** Construct an exact root-based mapping rule. @param {string} id Rule identity. @param {string} input Input type. @param {string} output Output type. @param {object} changes Overrides. @returns {object} Rule. */
export function route(id, input, output, changes = {}) {
  return inverseRule({ id, rootType: 'root', inputType: input, outputType: output, transform: 'same',
    mapping: { value: { kind: 'root', field: 'value' } }, ...changes });
}

/** Make a diamond where join expands before the second route reaches it. @returns {object} Complete valid graph. */
export function diamond() {
  return { schema: 1, library: 'self', types: ['root', 'a-left', 'z-right', 'b-join', 'c-tail'].map(valueType),
    assertions: [assertion({ id: 'root-one', type: 'root', metadata: { value: 'root value' } })],
    rules: [route('root-left', 'root', 'a-left'), route('root-right', 'root', 'z-right'),
      route('left-join', 'a-left', 'b-join', { mapping: { value: { kind: 'constant', value: 'generated value' } } }),
      route('right-join', 'z-right', 'b-join', { mapping: { value: { kind: 'constant', value: 'generated value' } } }),
      route('join-tail', 'b-join', 'c-tail', { conditions: [{ field: 'value', op: 'eq', value: 'root value' }] })] };
}

/** Make independent root types supporting one shared output and their own cycles. @param {string} secondValue Other root's metadata. @returns {object} Complete graph. */
export function independent(secondValue = 'same') {
  return { schema: 1, library: 'self', types: ['root-a', 'root-b', 'join'].map(valueType),
    assertions: [assertion({ id: 'a', type: 'root-a', metadata: { value: 'same' } }),
      assertion({ id: 'b', type: 'root-b', metadata: { value: secondValue } })],
    rules: [route('a-join', 'root-a', 'join', { rootType: 'root-a' }),
      route('a-back', 'join', 'root-a', { rootType: 'root-a' }),
      route('b-join', 'root-b', 'join', { rootType: 'root-b' }),
      route('b-back', 'join', 'root-b', { rootType: 'root-b' })] };
}

/** Generate bounded authority whose matching rules visit both endpoint orientations. @param {number} ruleCount Enabled reverse rules. @param {number} roots Number of manual roots. @returns {object} Valid compact graph. */
export function workGraph(ruleCount, roots = 1000) {
  return { schema: 1, library: 'self', types: ['referencing'].map(relationshipType),
    assertions: Array.from({ length: roots }, (_, index) => assertion({ id: `root-${String(index).padStart(4, '0')}`,
      target: { library: 'self', key: String(index).padStart(8, '0') } })),
    rules: Array.from({ length: ruleCount }, (_, index) => inverseRule({ id: `rule-${String(index).padStart(2, '0')}`,
      outputType: 'referencing' })) };
}
