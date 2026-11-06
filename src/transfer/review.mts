/** Complete import review over exact supplied native facts; inactive authority stays inspectable and inferred supports are recomputed. */
import { check, jsonCopy } from '../domain/values.mts';
import { validateGraph } from '../domain/graph-contract.mts';
import { canonicalJSON } from '../storage/canonical.mts';
import { entityDelta, entityDeltaAsync } from '../application/changes.mts';
import { inspectObserved, inspectObservedAsync, requireReadyProjection } from '../application/lifecycle.mts';
import { validateCooperation } from '../domain/cooperative-traversal.mts';
import type { EvaluationCooperation } from '../domain/cooperative-traversal.mts';
import type { ProjectionReport } from '../domain/projection-contracts.mts';
import type { Relationship } from '../domain/projection-contracts.mts';
import type { EntityDelta } from '../application/contracts.mts';
import { validateChoices } from './mapping.mts';
import type { Graph, ItemRef } from '../domain/contracts.mts';
import type { NativeFact, TransferMapping } from './contracts.mts';

/** Enumerate unique original references in deterministic canonical order. @param {object} graph Validated complete target graph. @returns {object[]} Detached endpoint references. */
function endpoints(graph: Graph): ItemRef[] {
  const refs = new Map<string, ItemRef>(); for (const root of graph.assertions) for (const ref of [root.source, root.target]) refs.set(canonicalJSON(ref), ref);
  return [...refs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, ref]) => ({ ...ref }));
}

/** Validate and detach complete authority, mapping and native evidence before review can suspend. @param currentGraph Existing graph or true uninitialized null. @param proposedGraph Complete proposed graph. @param input Exact explicit mapping. @param inputRows Native observation union. @returns Private normalized review inputs. */
function prepare(currentGraph: unknown, proposedGraph: unknown, input: unknown, inputRows: unknown) {
  const before = currentGraph === null ? null : validateGraph(currentGraph), after = validateGraph(proposedGraph);
  check(before === null || before.library === after.library, 'Cannot review graphs from different scopes');
  const suppliedMapping = jsonCopy(input), suppliedRows = jsonCopy(inputRows), retained = validateChoices(suppliedMapping, suppliedRows);
  const mapping = suppliedMapping as TransferMapping, rows = suppliedRows as NativeFact[];
  check(mapping.library === after.library, 'Mapping does not select the proposed graph library');
  const refs = endpoints(after), keys = new Set(refs.map(ref => canonicalJSON(ref)));
  check(mapping.endpoints.every(row => keys.has(canonicalJSON(row.target))), 'Mapped target does not belong to the complete proposal');
  return { before, after, retained, refs, rows };
}

/** Assemble unchanged complete review semantics from fully computed projection reports. @param value Private detached inputs. @param previous Complete old report or true uninitialized null. @param next Complete proposed report. @param derived Fully compared ready relationships, or null for conflicted old state. @returns Detached review and its exact ChangeSet. */
function complete(value: ReturnType<typeof prepare>, previous: ProjectionReport | null, next: ProjectionReport, derived: EntityDelta<Relationship> | null) {
  const { before, after, retained, refs, rows } = value;
  requireReadyProjection(next);
  const diagnostics = new Map([...(previous === null ? [] : previous.diagnostics), ...next.diagnostics]
    .map(value => [canonicalJSON(value), value]));
  if (previous !== null && previous.state !== 'ready') diagnostics.set('projection-conflict', { code: 'projection-conflict',
    message: 'Current projected relationships cannot be aggregated; review the complete before and after states', details: { state: previous.state } });
  const changeSet = { assertions: entityDelta(before === null ? [] : before.assertions, after.assertions, 'id'),
    types: entityDelta(before === null ? [] : before.types, after.types, 'id'), rules: entityDelta(before === null ? [] : before.rules, after.rules, 'id'),
    derived,
    diagnostics: [...diagnostics.values()] };
  const active = new Set(rows.filter(row => row.status === 'active').map(row => canonicalJSON(row.original)));
  return structuredClone({ before, after, changeSet, projection: { before: previous, after: next }, retained,
    refs: refs.filter(ref => active.has(canonicalJSON(ref))) });
}

/** Review complete transfer authority synchronously without ordinary history/version guards. @param currentGraph Current graph or uninitialized null. @param proposedGraph Complete proposal. @param input Explicit mapping. @param inputRows Actual native observations. @returns Complete detached before/after review without publication. */
export function reviewTransfer(currentGraph: unknown, proposedGraph: unknown, input: unknown, inputRows: unknown) {
  const value = prepare(currentGraph, proposedGraph, input, inputRows);
  const previous = value.before === null ? null : inspectObserved(value.before, value.rows), next = inspectObserved(value.after, value.rows);
  requireReadyProjection(next);
  const derived = previous !== null && previous.state !== 'ready' ? null
    : entityDelta(previous === null ? [] : previous.relationships, next.relationships, 'key');
  return complete(value, previous, next, derived);
}

/** Review detached complete transfer authority through explicit host yields and owner liveness. @param currentGraph Current graph or uninitialized null. @param proposedGraph Complete proposal. @param input Explicit mapping. @param inputRows Actual native observation union. @param cooperation Required host scheduler/liveness/work quantum. @returns Same complete review as synchronous review, rejecting cancellation without partial results. */
export async function reviewTransferAsync(currentGraph: unknown, proposedGraph: unknown, input: unknown, inputRows: unknown, cooperation: EvaluationCooperation) {
  validateCooperation(cooperation); cooperation.assertActive();
  const value = prepare(currentGraph, proposedGraph, input, inputRows);
  const previous = value.before === null ? null : await inspectObservedAsync(value.before, value.rows, cooperation);
  const next = await inspectObservedAsync(value.after, value.rows, cooperation);
  requireReadyProjection(next);
  const derived = previous !== null && previous.state !== 'ready' ? null
    : await entityDeltaAsync(previous === null ? [] : previous.relationships, next.relationships, 'key', cooperation);
  cooperation.assertActive(); const report = complete(value, previous, next, derived); cooperation.assertActive(); return report;
}
