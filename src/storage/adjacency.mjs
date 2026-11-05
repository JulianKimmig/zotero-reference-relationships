/** Pure explicit-assertion adjacency indexes and detached stable query pages. */
import { check, exact, jsonCopy } from '../domain/values.mjs';
import { validateGraph, validateItemRef, edgeKey } from '../domain/graph-contract.mjs';

/** Index a fully validated detached snapshot by endpoint key. @param {object} input Full graph. @returns {object} Private index with outgoing/incoming maps and type IDs. */
export function buildAdjacency(input) {
  const snapshot = validateGraph(input), outgoing = new Map(), incoming = new Map();
  for (const assertion of snapshot.assertions) {
    for (const [map, key] of [[outgoing, assertion.source.key], [incoming, assertion.target.key]]) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(assertion);
    }
  }
  return { library: snapshot.library, types: new Set(snapshot.types.map(type => type.id)), outgoing, incoming };
}

/**
 * Query an index without reading storage or executing rules. Both-direction
 * results deduplicate ordered triples and sort by the full stable EdgeKey.
 * @param {object} index Output of buildAdjacency, owned by the repository.
 * @param {object} input Exact ItemRef in the index's library.
 * @param {string} direction outgoing, incoming or both.
 * @param {string|null} typeFilter Declared type or null for all types.
 * @param {object} page Exact {offset,limit}; offset >=0 and limit 1..100 integers.
 * @returns {object} Detached {assertions,total,nextOffset} page.
 */
export function queryAdjacency(index, input, direction, typeFilter, page) {
  const ref = validateItemRef(input);
  check(ref.library === index.library, 'Adjacency query belongs to another library');
  check(['outgoing', 'incoming', 'both'].includes(direction), 'Invalid relationship direction');
  check(typeFilter === null || index.types.has(typeFilter), 'Unknown relationship type filter');
  exact(page, ['offset', 'limit']);
  check(Number.isSafeInteger(page.offset) && page.offset >= 0 && Number.isSafeInteger(page.limit)
    && page.limit >= 1 && page.limit <= 100, 'Invalid relationship page');
  const candidates = [];
  if (direction !== 'incoming') candidates.push(...(index.outgoing.get(ref.key) || []));
  if (direction !== 'outgoing') candidates.push(...(index.incoming.get(ref.key) || []));
  const matches = new Map();
  for (const assertion of candidates) {
    if (typeFilter === null || assertion.type === typeFilter) matches.set(edgeKey(assertion), assertion);
  }
  const ordered = [...matches].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const assertions = jsonCopy(ordered.slice(page.offset, page.offset + page.limit).map(([, assertion]) => assertion));
  const next = page.offset + assertions.length;
  return { assertions, total: ordered.length, nextOffset: next < ordered.length ? next : null };
}
