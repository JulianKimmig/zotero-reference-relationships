/** Private materialized endpoint indexes with detached pages independent of authority byte bounds. */
import { check, exact, jsonCopy } from '../domain/values.mjs';
import { validateItemRef } from '../domain/graph-contract.mjs';
import { evaluateGraph } from '../domain/evaluate.mjs';

/** Evaluate a validated graph once and index every effective relationship by endpoint. @param {object} snapshot Current complete authority. @returns {object} Private library/type/endpoint index. */
export function buildRelationshipIndex(snapshot) {
  const { relationships, transitions } = evaluateGraph(snapshot), outgoing = new Map(), incoming = new Map();
  for (const edge of relationships) {
    for (const [map, key] of [[outgoing, edge.source.key], [incoming, edge.target.key]]) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(edge);
    }
  }
  return { library: snapshot.library, types: new Set(snapshot.types.map(type => type.id)), outgoing, incoming, transitions };
}

/** Clone one effective entity without reapplying the persisted 1 MiB graph limit. @param {object} edge Private validated effective edge. @returns {object} Fully detached ordinary entity. */
function clone(edge) {
  return { ...edge, source: { ...edge.source }, target: { ...edge.target }, metadata: { ...edge.metadata },
    assertions: [...edge.assertions], supports: edge.supports.map(support => ({ ...support,
      source: { ...support.source }, target: { ...support.target }, metadata: { ...support.metadata } })) };
}

/** Query a private evaluated index without re-running inference or reading storage. @param {object} index Owned materialized index. @param {object} input ItemRef. @param {string} direction outgoing/incoming/both. @param {string|null} typeFilter Type or all. @param {object} page Exact offset/limit. @returns {object} Detached {relationships,total,nextOffset}. */
export function queryRelationships(index, input, direction, typeFilter, page) {
  const ref = validateItemRef(input), pagination = jsonCopy(page);
  check(ref.library === index.library, 'Relationship query belongs to another library');
  check(['outgoing', 'incoming', 'both'].includes(direction), 'Invalid relationship direction');
  check(typeFilter === null || index.types.has(typeFilter), 'Unknown relationship type filter');
  exact(pagination, ['offset', 'limit']);
  check(Number.isSafeInteger(pagination.offset) && pagination.offset >= 0 && Number.isSafeInteger(pagination.limit)
    && pagination.limit >= 1 && pagination.limit <= 100, 'Invalid relationship page');
  const candidates = new Map();
  for (const map of direction === 'outgoing' ? [index.outgoing] : direction === 'incoming' ? [index.incoming] : [index.outgoing, index.incoming]) {
    for (const edge of map.get(ref.key) ?? []) if (typeFilter === null || edge.type === typeFilter) candidates.set(edge.key, edge);
  }
  const ordered = [...candidates.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const relationships = ordered.slice(pagination.offset, pagination.offset + pagination.limit).map(clone);
  const next = pagination.offset + relationships.length;
  return { relationships, total: ordered.length, nextOffset: next < ordered.length ? next : null };
}
