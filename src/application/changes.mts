/** Pure explicit projections and exact sorted review deltas with complete rooted recomputation. */
import { check } from '../domain/values.mts';
import { edgeKey, validateGraph } from '../domain/graph-contract.mts';
import { evaluateGraph } from '../domain/evaluate.mts';
import { finishTraversalAsync, validateCooperation } from '../domain/cooperative-traversal.mts';
import type { EvaluationCooperation } from '../domain/cooperative-traversal.mts';
import type { Graph, JsonValue } from '../domain/contracts.mts';
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
  const steps = deltaSteps(before, after, identity, false);
  let step = steps.next(); while (!step.done) step = steps.next(); return step.value;
}

/** Compare already-normalized finite JSON, preserving serialized property/array order. Objects have bounded domain shapes; each array element yields even inside one relationship's contributor list. @param before Detached normalized JSON. @param after Detached proposed JSON. @returns Exact equality with the existing JSON.stringify comparison on these normalized entities. */
function* equalNormalized(before: JsonValue, after: JsonValue): Generator<void, boolean, void> {
  if (before === after) return true;
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') return false;
  if (Array.isArray(before)) {
    if (!Array.isArray(after) || before.length !== after.length) return false;
    for (let index = 0; index < before.length; index++) {
      yield;
      if (!(yield* equalNormalized(before[index], after[index]))) return false;
    }
    return true;
  }
  if (Array.isArray(after)) return false;
  const keys = Object.keys(before), nextKeys = Object.keys(after);
  if (keys.length !== nextKeys.length) return false;
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (key !== nextKeys[index] || !(yield* equalNormalized(before[key], after[key]))) return false;
  }
  return true;
}

/** Share identity ordering and complete private collectors between synchronous and cooperative reviews. @param before Detached normalized old entities. @param after Detached normalized proposed entities. @param identity Stable id/key. @param cooperative Whether equality yields within contributor arrays. @returns Complete delta only after all comparisons succeed. */
function* deltaSteps<K extends string, T extends Record<K, string>>(before: T[], after: T[], identity: K, cooperative: boolean): Generator<void, EntityDelta<T>, void> {
  const old = new Map<string, T>(before.map(value => [value[identity], value]));
  const next = new Map<string, T>(after.map(value => [value[identity], value]));
  const result: EntityDelta<T> = { added: [], updated: [], removed: [] };
  for (const key of [...new Set([...old.keys(), ...next.keys()])].sort(compare)) {
    yield;
    if (!old.has(key)) result.added.push(next.get(key)!);
    else if (!next.has(key)) result.removed.push(old.get(key)!);
    else {
      const previous = old.get(key)!, proposed = next.get(key)!;
      const equal = cooperative
        ? yield* equalNormalized(previous as unknown as JsonValue, proposed as unknown as JsonValue)
        : JSON.stringify(previous) === JSON.stringify(proposed);
      if (!equal) result.updated.push({ before: previous, after: proposed });
    }
  }
  return result;
}

/** Compare privately owned normalized domain entities in bounded batches, including a single edge with a large supports array. Inputs must stay private throughout suspension, as in lifecycle/transfer review. @param before Detached normalized old entities. @param after Detached normalized proposed entities. @param identity Stable id/key. @param cooperation Required host scheduling, liveness and work quantum. @returns Exact sorted delta; cancellation/scheduler errors propagate without exposing partial collectors. */
export async function entityDeltaAsync<K extends string, T extends Record<K, string>>(before: T[], after: T[], identity: K, cooperation: EvaluationCooperation): Promise<EntityDelta<T>> {
  validateCooperation(cooperation); cooperation.assertActive();
  return finishTraversalAsync(deltaSteps(before, after, identity, true), cooperation);
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
