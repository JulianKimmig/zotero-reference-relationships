/** Ordinary rule-definition version transitions; explicit transfer has its own reviewed protocol. */
import { check } from '../domain/values.mts';
import { validateGraph } from '../domain/graph-contract.mts';
import type { Rule } from '../domain/contracts.mts';

/** Compare normalized rule definitions independent of their version counter. @param {object} rule Valid rule. @returns {string} Stable JSON signature. */
function signature(rule: Rule): string { const { version, ...definition } = rule; return JSON.stringify(definition); }

/** Require new version 1, changed definition +1, unchanged version retention; deletion retracts support. @param {object} before Current graph. @param {object} after Proposed graph. @returns {void} Throws before publication. */
export function validateRuleTransition(before: unknown, after: unknown): void {
  const current = validateGraph(before), proposed = validateGraph(after);
  check(current.library === proposed.library, 'Rule transition crosses libraries');
  const old = new Map(current.rules.map(rule => [rule.id, rule]));
  for (const rule of proposed.rules) {
    const previous = old.get(rule.id);
    const expected = previous ? previous.version + (signature(previous) === signature(rule) ? 0 : 1) : 1;
    check(rule.version === expected && Number.isSafeInteger(expected), 'Rule version must match its definition transition');
  }
}
