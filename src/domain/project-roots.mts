/** Reversible native endpoint projection over strict original stored authority. */
import { ContractError, check, exact, jsonCopy } from './values.mts';
import { validateGraph, validateItemRef } from './graph-contract.mts';
import type { Assertion, Graph, ItemRef } from './contracts.mts';
import type { Diagnostic, EndpointResolution } from './projection-contracts.mts';

/** Normalize one complete native endpoint observation without inferring missing facts. @param {object} input Exact resolution row. @param {string} library Containing scope. @returns {object} Detached validated row. */
function resolution(input: unknown, library: string): EndpointResolution {
  exact(input, ['original', 'resolved', 'status']);
  const original = validateItemRef(input.original);
  check(original.library === library, 'Endpoint observation crosses libraries');
  check(typeof input.status === 'string' && ['active', 'trashed', 'missing', 'unsupported', 'ambiguous'].includes(input.status), 'Unknown endpoint state');
  const resolved = input.resolved === null ? null : validateItemRef(input.resolved);
  check(resolved === null || resolved.library === library, 'Resolved endpoint crosses libraries');
  check(['missing', 'ambiguous'].includes(input.status) ? resolved === null : resolved !== null,
    'Endpoint state requires an explicit compatible resolution');
  return { original, resolved, status: input.status } as EndpointResolution;
}

/**
 * Validate physical authority and observations before deriving eligible traversal roots.
 * Distinct original IDs/metadata are preserved when projected triples collide; self-edges
 * and inactive endpoints generate explicit diagnostics instead of destructive rewrites.
 * @param {object} snapshot Strict complete schema-1 graph with original endpoint keys.
 * @param {object[]} input Exactly one {original,resolved,status} row per unique endpoint.
 * @returns {object} Detached {graph,roots,diagnostics}; projected roots are not stored GraphSnapshots.
 */
export function projectRoots(snapshot: unknown, input: unknown): { graph: Graph; roots: Assertion[]; diagnostics: Diagnostic[] } {
  const graph = validateGraph(snapshot), observations = jsonCopy(input);
  check(Array.isArray(observations), 'Expected explicit endpoint observations');
  const endpoints = new Map<string, { ref: ItemRef; assertions: Set<string> }>();
  for (const root of graph.assertions) for (const ref of [root.source, root.target]) {
    const key = JSON.stringify(ref);
    if (!endpoints.has(key)) endpoints.set(key, { ref, assertions: new Set() });
    endpoints.get(key)!.assertions.add(root.id);
  }
  const resolved = new Map<string, EndpointResolution>();
  for (const value of observations) {
    const row = resolution(value, graph.library), key = JSON.stringify(row.original);
    check(endpoints.has(key), 'Observation must name an original graph endpoint');
    check(!resolved.has(key), 'Duplicate endpoint observation'); resolved.set(key, row);
  }
  check(resolved.size === endpoints.size, 'Every original endpoint requires an observation');
  const diagnostics: Diagnostic[] = [];
  for (const key of [...endpoints.keys()].sort()) {
    const row = resolved.get(key)!;
    if (row.status === 'ambiguous') throw new ContractError('endpoint', 'Ambiguous native merge aliases', { ref: row.original });
    if (row.status !== 'active') diagnostics.push({ code: 'endpoint', message: `Relationship endpoint is ${row.status}`,
      details: { ref: row.original, resolved: row.resolved, status: row.status, assertions: [...endpoints.get(key)!.assertions].sort() } });
  }
  const roots: Assertion[] = [];
  for (const root of [...graph.assertions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const source = resolved.get(JSON.stringify(root.source))!, target = resolved.get(JSON.stringify(root.target))!;
    if (source.status !== 'active' || target.status !== 'active') continue;
    if (source.resolved.key === target.resolved.key) {
      diagnostics.push({ code: 'self-edge', message: 'Relationship collapsed by a native merge',
        details: { id: root.id, source: root.source, target: root.target, resolved: source.resolved } });
    } else roots.push({ ...root, source: { ...source.resolved }, target: { ...target.resolved }, metadata: { ...root.metadata } });
  }
  return { graph, roots, diagnostics };
}
