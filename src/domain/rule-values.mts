/** Root-only predicates and metadata mappings over already validated declarative rules. */
import { check } from './values.mts';
import type { Assertion, Metadata, RuleCondition, MappingExpression } from './contracts.mts';

/** Evaluate AND conditions solely on immutable explicit-root metadata. @param {object} root Valid assertion. @param {object[]} conditions Valid predicates. @returns {boolean} Whether every predicate passes. */
export function matchesRoot(root: Assertion, conditions: RuleCondition[]): boolean {
  return conditions.every(condition => {
    const present = Object.hasOwn(root.metadata, condition.field);
    if (condition.op === 'exists') return present === condition.value;
    if (!present) return false;
    if (condition.op === 'eq') return root.metadata[condition.field] === condition.value;
    check(condition.op === 'ne', 'Unsupported root condition');
    return root.metadata[condition.field] !== condition.value;
  });
}

/** Map validated primitive output values without reading generated metadata. @param {object} root Valid explicit assertion. @param {object} mapping Valid root/constant expressions. @returns {object} Detached metadata with absent optional roots omitted. */
export function mapRoot(root: Assertion, mapping: Record<string, MappingExpression>): Metadata {
  const metadata: Metadata = {};
  for (const [field, expression] of Object.entries(mapping)) {
    if (expression.kind === 'constant') metadata[field] = expression.value;
    else {
      check(expression.kind === 'root', 'Unsupported metadata expression');
      if (Object.hasOwn(root.metadata, expression.field)) metadata[field] = root.metadata[expression.field];
    }
  }
  return metadata;
}
