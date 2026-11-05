/** Bounded deterministic rooted closure; computed relationships are never persisted authority. */
import { ContractError } from './values.mjs';
import { validateGraph, edgeKey } from './graph-contract.mjs';
import { Contributions } from './contributions.mjs';
import { matchesRoot, mapRoot } from './rule-values.mjs';
import { projectRoots } from './project-roots.mjs';

const TRANSITION_LIMIT = 100000;

/** Sort stable identifiers independent of locale. @param {object} a First entity. @param {object} b Second entity. @returns {number} Lexical ID order. */
function byID(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }

/** Index enabled rules by immutable root type and traversal input type in stable ID order. @param {object[]} rules Valid declarations. @returns {Map} rootType → inputType → Rule[]. */
function indexRules(rules) {
  const roots = new Map();
  for (const rule of [...rules].sort(byID)) {
    if (!rule.enabled) continue;
    if (!roots.has(rule.rootType)) roots.set(rule.rootType, new Map());
    const inputs = roots.get(rule.rootType);
    if (!inputs.has(rule.inputType)) inputs.set(rule.inputType, []);
    inputs.get(rule.inputType).push(rule);
  }
  return roots;
}

/**
 * Fully recompute validated traversal roots without mutating or caching them.
 * Expansion visits each root/edge once. Every producing support is collected before
 * visited-state checks, and failed predicates still consume a matching transition.
 * @param {object[]} input Physical or projected roots with independent original identities and metadata.
 * @param {object[]} declarations Validated rules from strict original authority.
 * @returns {object} Exact {relationships,transitions}; failures return no partial output.
 */
function evaluateRoots(input, declarations) {
  const contributions = new Contributions(), rules = indexRules(declarations);
  const roots = [...input].sort(byID);
  for (const root of roots) contributions.manual(root);
  let transitions = 0;
  for (const root of roots) {
    const visited = new Set(), pending = new Map([[edgeKey(root), root]]);
    while (pending.size) {
      const key = [...pending.keys()].sort()[0], current = pending.get(key);
      pending.delete(key); visited.add(key);
      const applicable = rules.get(root.type)?.get(current.type);
      if (!applicable) continue;
      for (const rule of applicable) {
        transitions++;
        if (transitions > TRANSITION_LIMIT) throw new ContractError('limit', 'Rule transition limit exceeded', { limit: TRANSITION_LIMIT, attempts: transitions });
        if (!matchesRoot(root, rule.conditions)) continue;
        const output = { source: rule.transform === 'reverse' ? current.target : current.source,
          target: rule.transform === 'reverse' ? current.source : current.target, type: rule.outputType };
        contributions.generated({ ...output, root: root.id, rule: rule.id, version: rule.version, metadata: mapRoot(root, rule.mapping) });
        const outputKey = edgeKey(output);
        if (!visited.has(outputKey)) pending.set(outputKey, output);
      }
    }
  }
  return { relationships: contributions.relationships(), transitions };
}

/** Validate complete physical authority and recompute its unchanged v1 closure contract. @param {object} input Strict complete schema-1 graph. @returns {object} Detached {relationships,transitions}; no partial result on failure. */
export function evaluateGraph(input) {
  const graph = validateGraph(input);
  return evaluateRoots(graph.assertions, graph.rules);
}

/** Recompute active native endpoint projections while preserving original assertion and support ownership. @param {object} snapshot Strict original authority. @param {object[]} resolutions Exact complete endpoint observations. @returns {object} Detached {relationships,transitions,diagnostics}; projected roots never pass through stored-snapshot validation. */
export function evaluateProjection(snapshot, resolutions) {
  const { graph, roots, diagnostics } = projectRoots(snapshot, resolutions);
  return { ...evaluateRoots(roots, graph.rules), diagnostics };
}
