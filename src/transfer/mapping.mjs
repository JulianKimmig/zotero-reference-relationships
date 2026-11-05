/** Explicit complete transfer mapping and semantic native choice validation without inferred endpoint identity. */
import { check, exact, jsonCopy } from '../domain/values.mjs';
import { validateGraph, validateItemRef } from '../domain/graph-contract.mjs';
import { canonicalJSON } from '../storage/canonical.mjs';
import { validateSourceOwner } from './format.mjs';

const unresolved = new Set(['missing', 'ambiguous', 'cyclic', 'alias-limit']);
const inactive = new Set(['missing', 'trashed', 'unsupported']);

/** Derive an owner's portable scope only after requiring its exact data shape. @param {object} owner Detached owner candidate. @returns {string} Scope to validate against the shared owner grammar. */
function scope(owner) { exact(owner, ['kind', 'id']); return owner.kind === 'group' ? `group:${owner.id}` : 'self'; }

/** Normalize a complete structurally explicit mapping without selecting native references. @param {object} input Exact owner/scope/endpoint decisions. @returns {object} Detached validated mapping; completeness against a graph is checked separately. */
function normalize(input) {
  const mapping = jsonCopy(input); exact(mapping, ['source', 'target', 'library', 'endpoints']);
  mapping.source = validateSourceOwner(mapping.source, scope(mapping.source));
  mapping.target = validateSourceOwner(mapping.target, mapping.library);
  check(Array.isArray(mapping.endpoints), 'Expected explicit endpoint mapping rows');
  check(mapping.endpoints.length <= 2000, 'Endpoint mapping exceeds the graph endpoint limit', 'limit');
  const seen = new Set();
  for (const row of mapping.endpoints) {
    exact(row, ['source', 'target', 'mode']); row.source = validateItemRef(row.source); row.target = validateItemRef(row.target);
    check(row.source.library === scope(mapping.source), 'Mapping source endpoint crosses owner scope');
    check(row.target.library === mapping.library, 'Mapping target endpoint crosses selected library');
    check(['reference', 'retain'].includes(row.mode), 'Choose an explicit reference or retain decision');
    check(row.mode !== 'retain' || row.target.key === row.source.key, 'Retaining an unresolved original must preserve its key');
    const key = canonicalJSON(row.source); check(!seen.has(key), 'Duplicate source endpoint mapping'); seen.add(key);
  }
  return mapping;
}

/** Map every unique original endpoint exactly once while preserving all other authority fields and foreign versions. @param {object} snapshot Original validated graph candidate. @param {object} sourceOwner Verified document source owner. @param {object} input Exact complete explicit mapping. @returns {object} Detached {snapshot,mapping}; native owner/status/editability remain separately required. */
export function mapSnapshot(snapshot, sourceOwner, input) {
  const graph = validateGraph(snapshot), source = validateSourceOwner(sourceOwner, graph.library), mapping = normalize(input);
  check(canonicalJSON(source) === canonicalJSON(mapping.source), 'Mapping does not name the verified source owner');
  const originals = new Set();
  for (const root of graph.assertions) for (const ref of [root.source, root.target]) originals.add(canonicalJSON(ref));
  const rows = new Map(mapping.endpoints.map(row => [canonicalJSON(row.source), row.target]));
  check(rows.size === originals.size && [...originals].every(key => rows.has(key)), 'Map every original endpoint exactly once without extra rows');
  graph.library = mapping.library;
  for (const root of graph.assertions) {
    root.source = rows.get(canonicalJSON(root.source)); root.target = rows.get(canonicalJSON(root.target));
  }
  return { snapshot: validateGraph(graph), mapping };
}

/** Validate exact semantic observations supplied by the actual native inspection boundary. @param {object[]} input Complete current/proposed endpoint union. @param {string} library Selected target scope. @returns {Map<string,object>} Detached observations keyed by original ItemRef. */
function observations(input, library) {
  const rows = jsonCopy(input); check(Array.isArray(rows), 'Expected native endpoint observations');
  const observed = new Map();
  for (const row of rows) {
    exact(row, ['original', 'resolved', 'status', 'editable']); row.original = validateItemRef(row.original);
    check(row.original.library === library, 'Native observation crosses target library');
    check(['active', 'trashed', 'unsupported', ...unresolved].includes(row.status), 'Unknown native endpoint state');
    check(typeof row.editable === 'boolean' && (row.status === 'active' || !row.editable), 'Native endpoint permission must match its state');
    if (row.resolved !== null) row.resolved = validateItemRef(row.resolved);
    check(row.resolved === null || row.resolved.library === library, 'Resolved endpoint crosses target library');
    check(unresolved.has(row.status) ? row.resolved === null : row.resolved !== null, 'Native endpoint state requires a compatible resolution');
    const key = canonicalJSON(row.original); check(!observed.has(key), 'Duplicate native endpoint observation'); observed.set(key, row);
  }
  return observed;
}

/** Require real active writable targets or explicitly retained known-inactive originals; never treat key equality as native acceptance. @param {object} input Complete explicit mapping. @param {object[]} rows Actual semantic observations of current/proposed endpoints. @returns {object[]} Detached {source,target,status} report for every retained endpoint; native target-owner identity is checked by composition. */
export function validateChoices(input, rows) {
  const mapping = normalize(input), observed = observations(rows, mapping.library), retained = [];
  for (const row of mapping.endpoints) {
    const fact = observed.get(canonicalJSON(row.target)); check(!!fact, 'Every selected endpoint requires a native observation');
    if (row.mode === 'retain') {
      check(inactive.has(fact.status), 'Retain only a known missing, trashed or unsupported original endpoint', 'endpoint');
      retained.push({ source: row.source, target: row.target, status: fact.status });
    } else {
      check(fact.status === 'active', 'Choose an available regular bibliographic reference', 'endpoint');
      check(fact.editable, 'A selected reference is not editable', 'permission');
    }
  }
  return retained;
}
