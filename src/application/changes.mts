/** Pure explicit projections and exact sorted review deltas with complete rooted recomputation. */
import { check } from '../domain/values.mts';
import { edgeKey, validateGraph } from '../domain/graph-contract.mts';
import { evaluateGraph } from '../domain/evaluate.mts';
import type { Graph } from '../domain/contracts.mts';
import type { Relationship } from '../domain/projection-contracts.mts';
import type { ChangeSet, EntityDelta } from './contracts.mts';

/** Compare stable ASCII identities or serialized EdgeKeys. @param {string} a First key. @param {string} b Second key. @returns {number} Lexical order. */
function compare(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }

/** Project already detached validated assertions. @param {object} graph Valid graph. @returns {object[]} Sorted explicit review entities. */
function project(graph: Graph): Relationship[] {
  return graph.assertions.map(({ id, source, type, target, metadata }) => ({
    key: edgeKey({ source, type, target }), source, type, target, metadata, assertions: [id], supports: [],
  })).sort((a, b) => compare(a.key, b.key));
}

/**
 * Expose only explicit authority even when the graph contains enabled rule declarations.
 * @param {object} snapshot Complete schema-1 graph, validated before projection.
 * @returns {object[]} Detached derived-entity shaped manual edges, ordered by EdgeKey.
 */
export function explicitEdges(snapshot: unknown): Relationship[] { return project(validateGraph(snapshot)); }

/**
 * Compare detached normalized entities independent of collection order.
 * @param {object[]} before Old entities.
 * @param {object[]} after Proposed entities.
 * @param {string} identity Stable field, id or key.
 * @returns {object} Exact {added,updated,removed}, each ordered by identity.
 */
export function entityDelta<K extends string, T extends Record<K, string>>(before: T[], after: T[], identity: K): EntityDelta<T> {
  const old = new Map<string, T>(before.map(value => [value[identity], value]));
  const next = new Map<string, T>(after.map(value => [value[identity], value]));
  const result: EntityDelta<T> = { added: [], updated: [], removed: [] };
  for (const key of [...new Set([...old.keys(), ...next.keys()])].sort(compare)) {
    if (!old.has(key)) result.added.push(next.get(key)!);
    else if (!next.has(key)) result.removed.push(old.get(key)!);
    else if (JSON.stringify(old.get(key)) !== JSON.stringify(next.get(key))) {
      result.updated.push({ before: old.get(key)!, after: next.get(key)! });
    }
  }
  return result;
}

/**
 * Review complete validated graphs with full rooted recomputation and no authority writes.
 * Validation normalizes object property order and Unicode before comparison. Each
 * graph is copied separately so a review of two bounded graphs can exceed 1 MiB.
 * @param {object} before Current graph in the same containing library.
 * @param {object} after Proposed complete graph.
 * @returns {object} Exact frozen-contract ChangeSet, detached from both inputs.
 */
export function changesBetween(before: unknown, after: unknown): ChangeSet & { derived: EntityDelta<Relationship> } {
  const current = validateGraph(before), proposed = validateGraph(after);
  check(current.library === proposed.library, 'Cannot review graphs from different libraries');
  return { assertions: entityDelta(current.assertions, proposed.assertions, 'id'),
    types: entityDelta(current.types, proposed.types, 'id'), rules: entityDelta(current.rules, proposed.rules, 'id'),
    derived: entityDelta(evaluateGraph(current).relationships, evaluateGraph(proposed).relationships, 'key'), diagnostics: [] };
}
