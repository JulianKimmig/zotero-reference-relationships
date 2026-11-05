/** Validate library-scoped v1 authority; materialized inference and runtime IDs are excluded. */
import { check, exact, identifier, jsonCopy } from './values.mjs';
import { validateType, validateMetadata } from './metadata.mjs';
import { validateRules } from './rule-contract.mjs';

/** Validate containing-library scope. @param {*} value Scope. @returns {void} */
function libraryScope(value) {
  check(typeof value === 'string' && (value === 'self' || /^group:[1-9][0-9]{0,14}$/.test(value)), 'Invalid library scope');
}

/**
 * Validate a key within its containing personal/group library. Personal scope
 * intentionally survives first-account sign-in; external transfers must map the
 * source owner separately. A gateway must still validate native item existence,
 * regular bibliographic kind and permission at command commit.
 * @param {object} input Exact {library,key}; no numeric local IDs or embedded URI.
 * @returns {object} Detached normalized reference.
 */
export function validateItemRef(input) {
  const ref = jsonCopy(input);
  exact(ref, ['library', 'key']);
  libraryScope(ref.library);
  check(typeof ref.key === 'string' && /^[A-Z0-9]{8}$/.test(ref.key), 'Invalid item key');
  return ref;
}

/** Stable collision-free identity for an ordered triple. @param {object} assertion Source/type/target. @returns {string} JSON tuple. */
export function edgeKey(assertion) {
  const source = validateItemRef(assertion.source), target = validateItemRef(assertion.target);
  identifier(assertion.type);
  return JSON.stringify([source.library, source.key, assertion.type, target.library, target.key]);
}

/** Require a real Gregorian UTC timestamp with milliseconds. @param {*} value Timestamp. @returns {void} */
function timestamp(value) {
  check(typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value), 'Invalid UTC timestamp');
  const date = new Date(value);
  check(Number.isFinite(date.getTime()) && date.toISOString() === value && !value.startsWith('0000'), 'Invalid Gregorian timestamp');
}

export { timestamp as validateTimestamp };

/**
 * Validate a complete v1 snapshot, preserving historical retired types and
 * original assertions. Merge projection is a derived view and must never rewrite
 * this authority destructively. Item availability is adapter-owned, so missing
 * endpoints remain representable for recovery. No computed supports are stored.
 * @param {object} input Exact {schema:1,library,types,assertions,rules}.
 * @returns {object} Detached NFC-normalized snapshot; throws typed errors.
 */
export function validateGraph(input) {
  const graph = jsonCopy(input);
  check(graph !== null && typeof graph === 'object' && !Array.isArray(graph), 'Expected a graph');
  check(graph.schema === 1, 'Unsupported graph schema', 'unsupported-schema');
  exact(graph, ['schema', 'library', 'types', 'assertions', 'rules']);
  libraryScope(graph.library);
  check(Array.isArray(graph.types) && graph.types.length > 0, 'Expected a nonempty type catalog');
  check(graph.types.length <= 64, 'Type count exceeds the v1 limit', 'limit');
  graph.types = graph.types.map(validateType);
  const types = new Map(graph.types.map(type => [type.id, type]));
  check(types.size === graph.types.length, 'Duplicate type identities');
  check(Array.isArray(graph.assertions), 'Expected assertions');
  check(graph.assertions.length <= 1000, 'Assertion count exceeds the v1 limit', 'limit');
  const ids = new Set(), edges = new Set();
  for (const assertion of graph.assertions) {
    exact(assertion, ['id', 'source', 'target', 'type', 'metadata', 'createdAt', 'updatedAt']);
    identifier(assertion.id);
    check(!ids.has(assertion.id), 'Duplicate assertion identity'); ids.add(assertion.id);
    const key = edgeKey(assertion);
    check(!edges.has(key), 'Duplicate ordered relationship triple'); edges.add(key);
    check(assertion.source.library === graph.library && assertion.target.library === graph.library, 'Cross-library relationship');
    check(assertion.source.key !== assertion.target.key, 'Self-links are not allowed');
    const type = types.get(assertion.type);
    check(!!type, 'Unknown relationship type');
    assertion.metadata = validateMetadata(type, assertion.metadata);
    timestamp(assertion.createdAt); timestamp(assertion.updatedAt);
    check(assertion.updatedAt >= assertion.createdAt, 'Update predates creation');
  }
  graph.rules = validateRules(graph.types, graph.rules);
  return graph;
}
