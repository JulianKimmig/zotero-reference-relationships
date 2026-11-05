/** Validate bounded declarative rules without evaluating graph closure or using platform APIs. */
import { check, exact, identifier, jsonCopy } from './values.mts';
import { validateType, validateFieldValue } from './metadata.mts';
import type { MetadataField, RelationshipType, Rule } from './contracts.mts';

/** Resolve a declared metadata field. @param {object} type Catalog type. @param {string} id Field identity. @returns {object} Field definition. */
function field(type: RelationshipType, id: unknown): MetadataField {
  identifier(id);
  const result = type.fields.find(candidate => candidate.id === id);
  check(!!result, `Unknown metadata field ${id} on type ${type.id}`);
  return result;
}

/** Validate one root-only predicate. @param {object} condition Predicate. @param {object} root Explicit-root type. @returns {void} */
function conditionContract(condition: unknown, root: RelationshipType): void {
  exact(condition, ['field', 'op', 'value']);
  const definition = field(root, condition.field);
  check(typeof condition.op === 'string' && ['eq', 'ne', 'exists'].includes(condition.op), 'Unsupported condition operator');
  if (condition.op === 'exists') check(typeof condition.value === 'boolean', 'Exists requires an explicit boolean');
  else validateFieldValue(definition, condition.value);
}

/** Validate path-independent mapping from a root or a constant. @param {object} mapping Output-field expressions. @param {object} root Root type. @param {object} output Output type. @returns {void} */
function mappingContract(mapping: unknown, root: RelationshipType, output: RelationshipType): void {
  check(mapping !== null && typeof mapping === 'object' && !Array.isArray(mapping), 'Expected a metadata mapping');
  for (const [id, expression] of Object.entries(mapping)) {
    const target = field(output, id);
    check(expression !== null && typeof expression === 'object', 'Expected a mapping expression');
    if (expression.kind === 'constant') {
      exact(expression, ['kind', 'value']);
      validateFieldValue(target, expression.value);
    } else {
      exact(expression, ['kind', 'field']);
      check(expression.kind === 'root', 'Mappings may read only explicit-root metadata');
      const source = field(root, expression.field);
      check(source.kind === target.kind, 'Mapped field kinds differ');
      check(!target.required || source.required, 'An optional root field cannot supply a required output');
      if (source.kind === 'enum') check(source.options.every(value => target.options.includes(value)), 'Mapped enum domain is not a subset');
    }
  }
  for (const definition of output.fields) {
    check(!definition.required || Object.hasOwn(mapping, definition.id), `Required output field ${definition.id} is not mapped`);
  }
}

/**
 * Validate and detach v1 rules, checking every declaration, even disabled rules.
 * All routes for one root type/output type use the exact same normalized mapping.
 * Conditions always inspect the selected explicit-root type; they never inspect
 * generated values. Each root selects only rules bearing its rootType identity.
 * @param {object[]} types Full type catalog, including retired definitions.
 * @param {object[]} input Rules, at most 64 with at most 16 AND predicates each.
 * @returns {object[]} Detached NFC-normalized rules in their original order.
 */
export function validateRules(types: unknown, input: unknown): Rule[] {
  check(Array.isArray(types), 'Expected a type catalog');
  const catalog = new Map(types.map(type => { const valid = validateType(type); return [valid.id, valid]; }));
  check(catalog.size === types.length, 'Duplicate type identities');
  const rules = jsonCopy(input);
  check(Array.isArray(rules), 'Expected a rule array');
  check(rules.length <= 64, 'Rule count exceeds the v1 limit', 'limit');
  const ids = new Set<string>(), mappings = new Map<string, string>();
  for (const rule of rules) {
    exact(rule, ['id', 'version', 'enabled', 'rootType', 'inputType', 'outputType', 'transform', 'conditions', 'mapping']);
    identifier(rule.id);
    check(!ids.has(rule.id), 'Duplicate rule identity'); ids.add(rule.id);
    check(typeof rule.version === 'number' && Number.isSafeInteger(rule.version) && rule.version > 0, 'Invalid rule version');
    check(typeof rule.enabled === 'boolean', 'Rule enabled must be boolean');
    check(typeof rule.transform === 'string' && ['same', 'reverse'].includes(rule.transform), 'Unsupported endpoint transform');
    const selected = [rule.rootType, rule.inputType, rule.outputType].map(id => {
      identifier(id);
      const type = catalog.get(id);
      check(!!type, `Unknown rule type ${id}`);
      check(!rule.enabled || !type.retired, 'An enabled rule cannot use a retired type');
      return type;
    });
    check(Array.isArray(rule.conditions), 'Expected AND conditions');
    check(rule.conditions.length <= 16, 'Predicate count exceeds the v1 limit', 'limit');
    rule.conditions.forEach(condition => conditionContract(condition, selected[0]));
    mappingContract(rule.mapping, selected[0], selected[2]);
    const key = JSON.stringify([rule.rootType, rule.outputType]), mapping = JSON.stringify(rule.mapping);
    check(!mappings.has(key) || mappings.get(key) === mapping,
      'Competing routes to an output type have different root metadata mappings');
    mappings.set(key, mapping);
  }
  return rules as Rule[];
}
