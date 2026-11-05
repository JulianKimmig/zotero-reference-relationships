/** Complete import review over exact supplied native facts; inactive authority stays inspectable and inferred supports are recomputed. */
import { check, jsonCopy } from '../domain/values.mts';
import { validateGraph } from '../domain/graph-contract.mts';
import { canonicalJSON } from '../storage/canonical.mts';
import { entityDelta } from '../application/changes.mts';
import { inspectObserved, requireReadyProjection } from '../application/lifecycle.mts';
import { validateChoices } from './mapping.mts';
import type { Graph, ItemRef } from '../domain/contracts.mts';
import type { NativeFact, TransferMapping } from './contracts.mts';

/** Enumerate unique original references in deterministic canonical order. @param {object} graph Validated complete target graph. @returns {object[]} Detached endpoint references. */
function endpoints(graph: Graph): ItemRef[] {
  const refs = new Map<string, ItemRef>(); for (const root of graph.assertions) for (const ref of [root.source, root.target]) refs.set(canonicalJSON(ref), ref);
  return [...refs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, ref]) => ({ ...ref }));
}

/** Review specialized history-preserving import without applying ordinary creation/version guards or inventing current authority. @param {object|null} currentGraph Actual current graph or truly uninitialized null. @param {object} proposedGraph Complete mapped/merged valid proposal. @param {object} input Complete explicit mapping for imported endpoints. @param {object[]} inputRows Actual native observation DTOs over the current/proposed endpoint union. @returns {object} Detached {before,after,changeSet,projection,retained,refs}; native origin/owner/head/under-lock checks remain composition-owned. */
export function reviewTransfer(currentGraph: unknown, proposedGraph: unknown, input: unknown, inputRows: unknown) {
  const before = currentGraph === null ? null : validateGraph(currentGraph), after = validateGraph(proposedGraph);
  check(before === null || before.library === after.library, 'Cannot review graphs from different scopes');
  const suppliedMapping = jsonCopy(input), suppliedRows = jsonCopy(inputRows), retained = validateChoices(suppliedMapping, suppliedRows);
  const mapping = suppliedMapping as TransferMapping, rows = suppliedRows as NativeFact[];
  check(mapping.library === after.library, 'Mapping does not select the proposed graph library');
  const refs = endpoints(after), keys = new Set(refs.map(ref => canonicalJSON(ref)));
  check(mapping.endpoints.every(row => keys.has(canonicalJSON(row.target))), 'Mapped target does not belong to the complete proposal');
  const previous = before === null ? null : inspectObserved(before, rows), next = inspectObserved(after, rows);
  requireReadyProjection(next);
  const diagnostics = new Map([...(previous === null ? [] : previous.diagnostics), ...next.diagnostics]
    .map(value => [canonicalJSON(value), value]));
  if (previous !== null && previous.state !== 'ready') diagnostics.set('projection-conflict', { code: 'projection-conflict',
    message: 'Current projected relationships cannot be aggregated; review the complete before and after states', details: { state: previous.state } });
  const changeSet = { assertions: entityDelta(before === null ? [] : before.assertions, after.assertions, 'id'),
    types: entityDelta(before === null ? [] : before.types, after.types, 'id'), rules: entityDelta(before === null ? [] : before.rules, after.rules, 'id'),
    derived: previous !== null && previous.state !== 'ready' ? null : entityDelta(previous === null ? [] : previous.relationships, next.relationships, 'key'),
    diagnostics: [...diagnostics.values()] };
  const active = new Set(rows.filter(row => row.status === 'active').map(row => canonicalJSON(row.original)));
  return structuredClone({ before, after, changeSet, projection: { before: previous, after: next }, retained,
    refs: refs.filter(ref => active.has(canonicalJSON(ref))) });
}
