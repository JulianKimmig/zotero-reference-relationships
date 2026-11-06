/** Shared resumable deterministic rooted closure; synchronous and cooperative consumers execute identical work. */
import { ContractError } from './values.mts';
import { edgeKey } from './graph-contract.mts';
import { matchesRoot, mapRoot } from './rule-values.mts';
import type { Contributions } from './contributions.mts';
import type { Assertion, Edge, Rule } from './contracts.mts';

const TRANSITION_LIMIT = 100000;

/** Sort stable identifiers independent of locale. @param a First entity. @param b Second entity. @returns Lexical UTF-16 ID order. */
function byID(a: { id: string }, b: { id: string }): number { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }

/** Index enabled rules in stable ID order. @param rules Valid declarations, bounded by graph validation. @returns Root type to input type to ordered rules. */
function indexRules(rules: Rule[]): Map<string, Map<string, Rule[]>> {
  const roots = new Map<string, Map<string, Rule[]>>();
  for (const rule of [...rules].sort(byID)) {
    if (!rule.enabled) continue;
    if (!roots.has(rule.rootType)) roots.set(rule.rootType, new Map());
    const inputs = roots.get(rule.rootType)!;
    if (!inputs.has(rule.inputType)) inputs.set(rule.inputType, []);
    inputs.get(rule.inputType)!.push(rule);
  }
  return roots;
}

/**
 * Recompute validated roots with a resumable boundary for each manual, root, edge and matching rule.
 * Every producing support is collected before visited-state checks; failed predicates still count.
 * Index creation and lexical sorts are synchronous and bounded by the validated declaration/root caps.
 * Each next() performs at most one contribution or matching transition between boundaries.
 * @param input Physical or projected roots retaining independent original identities and metadata.
 * @param declarations Validated rules from strict original authority.
 * @param contributions Explicit strict or inspection collector privately owned by one evaluation.
 * @returns Steps yielding no partial result, then the completed global matching-transition count.
 */
export function* traverseRoots(input: Assertion[], declarations: Rule[], contributions: Contributions): Generator<void, number, void> {
  const rules = indexRules(declarations), roots = [...input].sort(byID);
  for (const root of roots) { contributions.manual(root); yield; }
  let transitions = 0;
  for (const root of roots) {
    yield;
    const visited = new Set<string>(), pending = new Map<string, Edge>([[edgeKey(root), root]]);
    while (pending.size) {
      const key = [...pending.keys()].sort()[0], current = pending.get(key)!;
      pending.delete(key); visited.add(key);
      yield;
      const applicable = rules.get(root.type)?.get(current.type);
      if (!applicable) continue;
      for (const rule of applicable) {
        transitions++;
        if (transitions > TRANSITION_LIMIT) throw new ContractError('limit', 'Rule transition limit exceeded', { limit: TRANSITION_LIMIT, attempts: transitions });
        if (matchesRoot(root, rule.conditions)) {
          const output = { source: rule.transform === 'reverse' ? current.target : current.source,
            target: rule.transform === 'reverse' ? current.source : current.target, type: rule.outputType };
          contributions.generated({ ...output, root: root.id, rule: rule.id, version: rule.version, metadata: mapRoot(root, rule.mapping) });
          const outputKey = edgeKey(output);
          if (!visited.has(outputKey)) pending.set(outputKey, output);
        }
        yield;
      }
    }
  }
  return transitions;
}

/** Exhaust the actual rooted stepper synchronously. @param steps Private traversal generator. @returns Completed matching-transition count; throws without publishing partial state. */
export function finishTraversal(steps: Generator<void, number, void>): number {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
