/** Exact multi-original removal proposals over strict stored authority, without native effects. */
import { check, identifier, jsonCopy } from '../domain/values.mjs';
import { validateGraph } from '../domain/graph-contract.mjs';

/** Remove only an explicit nonempty unique set of existing original identities. @param {object} snapshot Strict complete authority. @param {string[]} input Requested original IDs. @returns {object} Detached valid authority retaining all unselected values and declarations. */
export function proposeRemoval(snapshot, input) {
  const graph = validateGraph(snapshot), ids = jsonCopy(input);
  check(Array.isArray(ids) && ids.length > 0 && ids.length <= 1000, 'Choose one or more original relationships');
  ids.forEach(identifier); const selected = new Set(ids);
  check(selected.size === ids.length, 'Duplicate original relationship selection');
  const existing = new Set(graph.assertions.map(root => root.id));
  check(ids.every(id => existing.has(id)), 'Unknown explicit assertion');
  graph.assertions = graph.assertions.filter(root => !selected.has(root.id));
  return validateGraph(graph);
}
