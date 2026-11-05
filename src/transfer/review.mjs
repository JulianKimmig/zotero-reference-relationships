/** Complete import review over exact supplied native facts; inactive authority stays inspectable and inferred supports are recomputed. */
import { check, jsonCopy } from '../domain/values.mjs';
import { validateGraph } from '../domain/graph-contract.mjs';
import { canonicalJSON } from '../storage/canonical.mjs';
import { entityDelta } from '../application/changes.mjs';
import { inspectObserved, requireReadyProjection } from '../application/lifecycle.mjs';
import { validateChoices } from './mapping.mjs';

/** Enumerate unique original references in deterministic canonical order. @param {object} graph Validated complete target graph. @returns {object[]} Detached endpoint references. */
function endpoints(graph) {
  const refs = new Map(); for (const root of graph.assertions) for (const ref of [root.source, root.target]) refs.set(canonicalJSON(ref), ref);
  return [...refs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, ref]) => ({ ...ref }));
}

/** Review specialized history-preserving import without applying ordinary creation/version guards or inventing current authority. @param {object|null} currentGraph Actual current graph or truly uninitialized null. @param {object} proposedGraph Complete mapped/merged valid proposal. @param {object} input Complete explicit mapping for imported endpoints. @param {object[]} inputRows Actual native observation DTOs over the current/proposed endpoint union. @returns {object} Detached {before,after,changeSet,projection,retained,refs}; native origin/owner/head/under-lock checks remain composition-owned. */
export function reviewTransfer(currentGraph, proposedGraph, input, inputRows) {
  const before = currentGraph === null ? null : validateGraph(currentGraph), after = validateGraph(proposedGraph);
  check(before === null || before.library === after.library, 'Cannot review graphs from different scopes');
  const mapping = jsonCopy(input), rows = jsonCopy(inputRows), retained = validateChoices(mapping, rows);
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
