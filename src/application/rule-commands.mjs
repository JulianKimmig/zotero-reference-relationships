/** Detached, versioned declarative rule proposals; publication remains a separate reviewed command. */
import { check, exact, identifier, jsonCopy } from '../domain/values.mjs';
import { validateGraph } from '../domain/graph-contract.mjs';
import { validateRuleTransition } from './rule-transition.mjs';

/** Compare normalized definitions without their version. @param {object} rule Valid declaration. @returns {string} Stable definition signature. */
function signature(rule) {
  const { version, ...definition } = rule;
  return JSON.stringify(definition);
}

/**
 * Propose one exact create/update/delete without mutating authority or persisting generated edges.
 * Creation starts at version one; definition edits advance once, and normalized no-ops retain
 * their version. Complete graph validation applies even to disabled declarations.
 * @param {object} snapshot Current complete authority or an explicit proposed seed.
 * @param {object} input Exact {kind,rule} for create/update, rule omitting version; {kind:'delete',id} for deletion.
 * @returns {object} Independent validated graph for separate impact preview and atomic publication.
 */
export function proposeRuleChange(snapshot, input) {
  const graph = validateGraph(snapshot), change = jsonCopy(input);
  check(change !== null && typeof change === 'object' && !Array.isArray(change), 'Expected a rule change');
  check(['create', 'update', 'delete'].includes(change.kind), 'Unknown rule change kind');
  if (change.kind === 'delete') {
    exact(change, ['kind', 'id']); identifier(change.id);
    const index = graph.rules.findIndex(rule => rule.id === change.id);
    check(index >= 0, 'Unknown rule identity'); graph.rules.splice(index, 1);
  } else {
    exact(change, ['kind', 'rule']);
    exact(change.rule, ['id', 'enabled', 'rootType', 'inputType', 'outputType', 'transform', 'conditions', 'mapping']);
    identifier(change.rule.id);
    const index = graph.rules.findIndex(rule => rule.id === change.rule.id), previous = graph.rules[index];
    check(change.kind === 'create' ? index < 0 : index >= 0,
      change.kind === 'create' ? 'Duplicate rule identity' : 'Unknown rule identity');
    const candidate = { ...change.rule, version: 1 };
    if (previous) candidate.version = previous.version + (signature(previous) === signature(candidate) ? 0 : 1);
    if (previous) graph.rules[index] = candidate;
    else graph.rules.push(candidate);
  }
  const proposed = validateGraph(graph);
  validateRuleTransition(snapshot, proposed);
  return proposed;
}
