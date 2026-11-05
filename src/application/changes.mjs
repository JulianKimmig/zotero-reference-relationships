/** Pure detached explicit projections and exact sorted graph review deltas; no rule evaluation. */
import { check } from '../domain/values.mjs';
import { edgeKey, validateGraph } from '../domain/graph-contract.mjs';

/** Compare stable ASCII identities or serialized EdgeKeys. @param {string} a First key. @param {string} b Second key. @returns {number} Lexical order. */
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/** Project already detached validated assertions. @param {object} graph Valid graph. @returns {object[]} Sorted explicit review entities. */
function project(graph) {
  return graph.assertions.map(({ id, source, type, target, metadata }) => ({
    key: edgeKey({ source, type, target }), source, type, target, metadata, assertions: [id], supports: [],
  })).sort((a, b) => compare(a.key, b.key));
}

/**
 * Expose only explicit authority even when the graph contains enabled rule declarations.
 * @param {object} snapshot Complete schema-1 graph, validated before projection.
 * @returns {object[]} Detached derived-entity shaped manual edges, ordered by EdgeKey.
 */
export function explicitEdges(snapshot) { return project(validateGraph(snapshot)); }

/**
 * Compare detached normalized entities independent of collection order.
 * @param {object[]} before Old entities.
 * @param {object[]} after Proposed entities.
 * @param {string} identity Stable field, id or key.
 * @returns {object} Exact {added,updated,removed}, each ordered by identity.
 */
function delta(before, after, identity) {
  const old = new Map(before.map(value => [value[identity], value]));
  const next = new Map(after.map(value => [value[identity], value]));
  const result = { added: [], updated: [], removed: [] };
  for (const key of [...new Set([...old.keys(), ...next.keys()])].sort(compare)) {
    if (!old.has(key)) result.added.push(next.get(key));
    else if (!next.has(key)) result.removed.push(old.get(key));
    else if (JSON.stringify(old.get(key)) !== JSON.stringify(next.get(key))) {
      result.updated.push({ before: old.get(key), after: next.get(key) });
    }
  }
  return result;
}

/**
 * Review complete validated graphs without evaluating declarations or writing authority.
 * Validation normalizes object property order and Unicode before comparison. Each
 * graph is copied separately so a review of two bounded graphs can exceed 1 MiB.
 * @param {object} before Current graph in the same containing library.
 * @param {object} after Proposed complete graph.
 * @returns {object} Exact frozen-contract ChangeSet, detached from both inputs.
 */
export function changesBetween(before, after) {
  const current = validateGraph(before), proposed = validateGraph(after);
  check(current.library === proposed.library, 'Cannot review graphs from different libraries');
  return { assertions: delta(current.assertions, proposed.assertions, 'id'),
    types: delta(current.types, proposed.types, 'id'), rules: delta(current.rules, proposed.rules, 'id'),
    derived: delta(project(current), project(proposed), 'key'), diagnostics: [] };
}
