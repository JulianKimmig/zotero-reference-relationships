/** Explicit complete transfer mapping and semantic native choice validation without inferred endpoint identity. */
import { check, exact, jsonCopy } from '../domain/values.mts';
import { validateGraph, validateItemRef } from '../domain/graph-contract.mts';
import { canonicalJSON } from '../storage/canonical.mts';
import { validateSourceOwner } from './format.mts';
import type { EndpointMapping, NativeFact, RetainedEndpoint, TransferMapping } from './contracts.mts';

const unresolved = new Set(['missing', 'ambiguous', 'cyclic', 'alias-limit']);
const inactive = new Set(['missing', 'trashed', 'unsupported']);

/** Derive an owner's portable scope only after requiring its exact data shape. @param {object} owner Detached owner candidate. @returns {string} Scope to validate against the shared owner grammar. */
function scope(owner: unknown): string { exact(owner, ['kind', 'id']); return owner.kind === 'group' ? `group:${owner.id}` : 'self'; }

/** Normalize a complete structurally explicit mapping without selecting native references. @param {object} input Exact owner/scope/endpoint decisions. @returns {object} Detached validated mapping; completeness against a graph is checked separately. */
function normalize(input: unknown): TransferMapping {
  const mapping = jsonCopy(input); exact(mapping, ['source', 'target', 'library', 'endpoints']);
  const source = validateSourceOwner(mapping.source, scope(mapping.source));
  const library = validateItemRef({ library: mapping.library, key: 'AAAAAAAA' }).library;
  const target = validateSourceOwner(mapping.target, library);
  check(Array.isArray(mapping.endpoints), 'Expected explicit endpoint mapping rows');
  check(mapping.endpoints.length <= 2000, 'Endpoint mapping exceeds the graph endpoint limit', 'limit');
  const seen = new Set<string>(), endpoints: EndpointMapping[] = [];
  for (const row of mapping.endpoints) {
    exact(row, ['source', 'target', 'mode']); const from = validateItemRef(row.source), to = validateItemRef(row.target);
    check(from.library === scope(source), 'Mapping source endpoint crosses owner scope');
    check(to.library === library, 'Mapping target endpoint crosses selected library');
    check(row.mode === 'reference' || row.mode === 'retain', 'Choose an explicit reference or retain decision');
    check(row.mode !== 'retain' || to.key === from.key, 'Retaining an unresolved original must preserve its key');
    const key = canonicalJSON(from); check(!seen.has(key), 'Duplicate source endpoint mapping'); seen.add(key);
    endpoints.push({ source: from, target: to, mode: row.mode });
  }
  return { source, target, library, endpoints };
}

/** Map every unique original endpoint exactly once while preserving all other authority fields and foreign versions. @param {object} snapshot Original validated graph candidate. @param {object} sourceOwner Verified document source owner. @param {object} input Exact complete explicit mapping. @returns {object} Detached {snapshot,mapping}; native owner/status/editability remain separately required. */
export function mapSnapshot(snapshot: unknown, sourceOwner: unknown, input: unknown) {
  const graph = validateGraph(snapshot), source = validateSourceOwner(sourceOwner, graph.library), mapping = normalize(input);
  check(canonicalJSON(source) === canonicalJSON(mapping.source), 'Mapping does not name the verified source owner');
  const originals = new Set<string>();
  for (const root of graph.assertions) for (const ref of [root.source, root.target]) originals.add(canonicalJSON(ref));
  const rows = new Map(mapping.endpoints.map(row => [canonicalJSON(row.source), row.target]));
  check(rows.size === originals.size && [...originals].every(key => rows.has(key)), 'Map every original endpoint exactly once without extra rows');
  graph.library = mapping.library;
  for (const root of graph.assertions) {
    root.source = rows.get(canonicalJSON(root.source))!; root.target = rows.get(canonicalJSON(root.target))!;
  }
  return { snapshot: validateGraph(graph), mapping };
}

/** Validate exact semantic observations supplied by the actual native inspection boundary. @param {object[]} input Complete current/proposed endpoint union. @param {string} library Selected target scope. @returns {Map<string,object>} Detached observations keyed by original ItemRef. */
function observations(input: unknown, library: string): Map<string, NativeFact> {
  const rows = jsonCopy(input); check(Array.isArray(rows), 'Expected native endpoint observations');
  const observed = new Map<string, NativeFact>();
  for (const row of rows) {
    exact(row, ['original', 'resolved', 'status', 'editable']); const original = validateItemRef(row.original);
    check(original.library === library, 'Native observation crosses target library');
    check(typeof row.status === 'string' && ['active', 'trashed', 'unsupported', ...unresolved].includes(row.status), 'Unknown native endpoint state');
    check(typeof row.editable === 'boolean' && (row.status === 'active' || !row.editable), 'Native endpoint permission must match its state');
    const resolved = row.resolved === null ? null : validateItemRef(row.resolved);
    check(resolved === null || resolved.library === library, 'Resolved endpoint crosses target library');
    check(unresolved.has(row.status) ? resolved === null : resolved !== null, 'Native endpoint state requires a compatible resolution');
    const key = canonicalJSON(original); check(!observed.has(key), 'Duplicate native endpoint observation');
    observed.set(key, { original, resolved, status: row.status, editable: row.editable } as NativeFact);
  }
  return observed;
}

/** Require real active writable targets or explicitly retained known-inactive originals; never treat key equality as native acceptance. @param {object} input Complete explicit mapping. @param {object[]} rows Actual semantic observations of current/proposed endpoints. @returns {object[]} Detached {source,target,status} report for every retained endpoint; native target-owner identity is checked by composition. */
export function validateChoices(input: unknown, rows: unknown): RetainedEndpoint[] {
  const mapping = normalize(input), observed = observations(rows, mapping.library), retained: RetainedEndpoint[] = [];
  for (const row of mapping.endpoints) {
    const fact = observed.get(canonicalJSON(row.target)); check(!!fact, 'Every selected endpoint requires a native observation');
    if (row.mode === 'retain') {
      check(fact.status === 'missing' || fact.status === 'trashed' || fact.status === 'unsupported', 'Retain only a known missing, trashed or unsupported original endpoint', 'endpoint');
      retained.push({ source: row.source, target: row.target, status: fact.status });
    } else {
      check(fact.status === 'active', 'Choose an available regular bibliographic reference', 'endpoint');
      check(fact.editable, 'A selected reference is not editable', 'permission');
    }
  }
  return retained;
}
