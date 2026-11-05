/** Strict original evidence inspection when native merge resolution cannot establish a complete graph. */
import { check, exact, jsonCopy } from './values.mts';
import { validateGraph, validateItemRef } from './graph-contract.mts';
import { inspectProjection } from './evaluate.mts';
import type { ItemRef } from './contracts.mts';
import type { EndpointResolution, ProjectionReport } from './projection-contracts.mts';

const unresolved = new Set(['ambiguous', 'cyclic', 'alias-limit']);

/** Validate complete endpoint evidence and preserve unknown aggregate state without choosing aliases. @param {object} snapshot Strict original graph. @param {object[]} input Exactly one {original,resolved,status} observation per original endpoint. @returns {object} Existing complete projection report or endpoint-conflict with null aggregates and complete originals. */
export function inspectEndpoints(snapshot: unknown, input: unknown): ProjectionReport {
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
  if (!validated.some(row => unresolved.has(row.status))) return inspectProjection(graph, validated);
  const diagnostics = validated.filter(row => row.status !== 'active').sort((a, b) => a.original.key < b.original.key ? -1 : 1)
    .map(row => ({ code: unresolved.has(row.status) ? 'endpoint-conflict' : 'endpoint',
      message: unresolved.has(row.status) ? `Native endpoint is ${row.status}; choose an explicit repair` : `Relationship endpoint is ${row.status}`,
      details: { ref: row.original, resolved: row.resolved, status: row.status,
        assertions: [...expected.get(row.original.key)!.assertions].sort() } }));
  return { state: 'endpoint-conflict', relationships: null, clusters: null, transitions: null, diagnostics,
    originals: [...graph.assertions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
}
