/** Private materialized endpoint indexes with detached pages independent of authority byte bounds. */
import { check, exact, jsonCopy } from '../domain/values.mts';
import { validateItemRef } from '../domain/graph-contract.mts';
import { evaluateGraph } from '../domain/evaluate.mts';
import { validateGraph } from '../domain/graph-contract.mts';
import { validatePage } from '../domain/pagination.mts';
import type { Graph } from '../domain/contracts.mts';
import type { Relationship } from '../domain/projection-contracts.mts';

/** Evaluate a validated graph once and index every effective relationship by endpoint. @param {object} snapshot Current complete authority. @returns {object} Private library/type/endpoint index. */
export function buildRelationshipIndex(snapshot: unknown) {
  const { relationships, transitions } = evaluateGraph(snapshot);
  return indexRelationships(validateGraph(snapshot), relationships, transitions);
}

/** Index an already validated complete projection without re-running physical closure. @param {object} snapshot Original authority. @param {object[]} relationships Ready complete effective entities. @param {number} transitions Completed work count. @returns {object} Private endpoint index. */
export function indexRelationships(snapshot: Graph, relationships: Relationship[], transitions: number) {
  const outgoing = new Map<string, Relationship[]>(), incoming = new Map<string, Relationship[]>();
  for (const edge of relationships) {
    for (const [map, key] of [[outgoing, edge.source.key], [incoming, edge.target.key]] as const) {
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(edge);
    }
  }
  return { library: snapshot.library, types: new Set(snapshot.types.map(type => type.id)), outgoing, incoming, transitions };
}

/** Clone one effective entity without reapplying the persisted 1 MiB graph limit. @param {object} edge Private validated effective edge. @returns {object} Fully detached ordinary entity. */
function clone(edge: Relationship): Relationship {
  return { ...edge, source: { ...edge.source }, target: { ...edge.target }, metadata: { ...edge.metadata },
    assertions: [...edge.assertions], supports: edge.supports.map(support => ({ ...support,
      source: { ...support.source }, target: { ...support.target }, metadata: { ...support.metadata } })) };
}

/** Query a private evaluated index without re-running inference or reading storage. @param {object} index Owned materialized index. @param {object} input ItemRef. @param {string} direction outgoing/incoming/both. @param {string|null} typeFilter Type or all. @param {object} page Exact offset/limit. @returns {object} Detached {relationships,total,nextOffset}. */
export function queryRelationships(index: ReturnType<typeof indexRelationships>, input: unknown, direction: string, typeFilter: string|null, page: unknown) {
  const ref = validateItemRef(input), pagination = validatePage(page);
  check(ref.library === index.library, 'Relationship query belongs to another library');
  check(['outgoing', 'incoming', 'both'].includes(direction), 'Invalid relationship direction');
  check(typeFilter === null || index.types.has(typeFilter), 'Unknown relationship type filter');
  const candidates = new Map<string, Relationship>();
  for (const map of direction === 'outgoing' ? [index.outgoing] : direction === 'incoming' ? [index.incoming] : [index.outgoing, index.incoming]) {
    for (const edge of map.get(ref.key) ?? []) if (typeFilter === null || edge.type === typeFilter) candidates.set(edge.key, edge);
  }
  const ordered = [...candidates.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const relationships = ordered.slice(pagination.offset, pagination.offset + pagination.limit).map(clone);
  const next = pagination.offset + relationships.length;
  return { relationships, total: ordered.length, nextOffset: next < ordered.length ? next : null };
}
