/** Strict original evidence inspection when native merge resolution cannot establish a complete graph. */
import { check, exact, jsonCopy } from './values.mts';
import { validateGraph, validateItemRef } from './graph-contract.mts';
import { inspectProjection, inspectProjectionAsync } from './evaluate.mts';
import { validateCooperation } from './cooperative-traversal.mts';
import type { EvaluationCooperation } from './cooperative-traversal.mts';
import type { ItemRef } from './contracts.mts';
import type { EndpointResolution, ProjectionReport } from './projection-contracts.mts';

const unresolved = new Set(['ambiguous', 'cyclic', 'alias-limit']);

/** Validate and detach complete endpoint evidence before either synchronous or cooperative inspection. @param {object} snapshot Strict original graph. @param {object[]} input Complete observation DTOs. @returns {object} Valid graph/rows and any explicit unresolved report, with no inferred alias choice. */
function prepare(snapshot: unknown, input: unknown) {
  const graph = validateGraph(snapshot), rows = jsonCopy(input);
  const expected = new Map<string, { ref: ItemRef; assertions: Set<string> }>(), observed = new Set<string>();
  check(Array.isArray(rows), 'Expected explicit endpoint observations');
  for (const root of graph.assertions) for (const ref of [root.source, root.target]) {
    if (!expected.has(ref.key)) expected.set(ref.key, { ref, assertions: new Set() });
    expected.get(ref.key)!.assertions.add(root.id);
  }
  for (const row of rows) {
    exact(row, ['original', 'resolved', 'status']); const original = validateItemRef(row.original);
    check(original.library === graph.library && expected.has(original.key), 'Observation must name an original graph endpoint');
    check(!observed.has(original.key), 'Duplicate endpoint observation'); observed.add(original.key);
    check(typeof row.status === 'string' && ['active', 'trashed', 'missing', 'unsupported', ...unresolved].includes(row.status), 'Unknown endpoint state');
    const resolved = row.resolved === null ? null : validateItemRef(row.resolved);
    check(resolved === null || resolved.library === graph.library, 'Resolved endpoint crosses libraries');
    check(row.status === 'missing' || unresolved.has(row.status) ? resolved === null : resolved !== null,
      'Endpoint state requires an explicit compatible resolution');
  }
  check(observed.size === expected.size, 'Every original endpoint requires an observation');
  const validated = rows as EndpointResolution[];
  if (!validated.some(row => unresolved.has(row.status))) return { graph, rows: validated, conflict: null };
  const diagnostics = validated.filter(row => row.status !== 'active').sort((a, b) => a.original.key < b.original.key ? -1 : 1)
    .map(row => ({ code: unresolved.has(row.status) ? 'endpoint-conflict' : 'endpoint',
      message: unresolved.has(row.status) ? `Native endpoint is ${row.status}; choose an explicit repair` : `Relationship endpoint is ${row.status}`,
      details: { ref: row.original, resolved: row.resolved, status: row.status,
        assertions: [...expected.get(row.original.key)!.assertions].sort() } }));
  const conflict: ProjectionReport = { state: 'endpoint-conflict', relationships: null, clusters: null, transitions: null, diagnostics,
    originals: [...graph.assertions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
  return { graph, rows: validated, conflict };
}

/** Inspect complete native evidence synchronously, preserving all unresolved originals. @param snapshot Strict graph. @param input Complete endpoint observations. @returns Complete ready/conflict or endpoint-conflict report. */
export function inspectEndpoints(snapshot: unknown, input: unknown): ProjectionReport {
  const value = prepare(snapshot, input);
  return value.conflict === null ? inspectProjection(value.graph, value.rows) : value.conflict;
}

/** Inspect complete detached native evidence with explicit host scheduling and owner cancellation. @param snapshot Strict graph. @param input Complete endpoint observations. @param cooperation Required host/liveness/work-quantum controls. @returns Complete report equal to synchronous inspection, with no partial result on cancellation. */
export async function inspectEndpointsAsync(snapshot: unknown, input: unknown, cooperation: EvaluationCooperation): Promise<ProjectionReport> {
  validateCooperation(cooperation); cooperation.assertActive(); const value = prepare(snapshot, input);
  await cooperation.yieldToHost(); cooperation.assertActive();
  const report = value.conflict === null ? await inspectProjectionAsync(value.graph, value.rows, cooperation) : value.conflict;
  cooperation.assertActive(); return report;
}
