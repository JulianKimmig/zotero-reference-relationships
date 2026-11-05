/** Native-state-bound projected reads and complete conflict-aware change review without authority rewrites. */
import { ContractError, check, jsonCopy } from '../domain/values.mjs';
import { validateGraph, edgeKey } from '../domain/graph-contract.mjs';
import { inspectEndpoints } from '../domain/inspect-endpoints.mjs';
import { canonicalJSON } from '../storage/canonical.mjs';
import { entityDelta } from './changes.mjs';

/** Enumerate stable references from authorities or reviewed assertion collections. @param {object[]} snapshots Objects with validated assertion/entity arrays. @returns {object[]} Sorted independent endpoint references. */
function references(snapshots) {
  const refs = new Map();
  for (const graph of snapshots) for (const root of graph.assertions) for (const ref of [root.source, root.target]) refs.set(canonicalJSON(ref), ref);
  return [...refs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, ref]) => ({ ...ref }));
}

/** Inspect a complete graph using only its own original endpoint observations. @param {object} snapshot Valid graph. @param {object[]} rows Union of before/after native observations. @returns {object} Complete projection inspection. */
function inspect(snapshot, rows) {
  const keys = new Set(references([snapshot]).map(ref => canonicalJSON(ref)));
  return inspectEndpoints(snapshot, rows.filter(row => keys.has(canonicalJSON(row.original)))
    .map(({ original, resolved, status }) => ({ original, resolved, status })));
}

/** Reject aggregate ambiguity after a proposal with deterministic original contributor witnesses. @param {object} report Complete after inspection. @returns {void} */
function requireReady(report) {
  if (report.state === 'ready') return;
  if (report.state === 'endpoint-conflict') throw new ContractError('endpoint',
    'Native aliases remain unresolved; explicitly repair the affected original relationships', { diagnostics: report.diagnostics });
  const cluster = report.clusters.find(cluster => cluster.conflicts.length > 0), conflict = cluster.conflicts[0];
  const first = conflict.contributors[0], different = conflict.contributors.find(value => value.value !== first.value);
  throw new ContractError('conflict', `Conflicting relationship metadata for ${conflict.field}`,
    { key: cluster.key, field: conflict.field, contributors: [first, different] });
}

/** Validate new/moved explicit triples against actual native endpoints while preserving existing merge collisions. @param {object} before Valid current authority. @param {object} after Valid proposal. @param {object} delta Authority assertion delta. @param {object[]} rows Complete union observations. @returns {void} */
function validateWrites(before, after, delta, rows) {
  const observed = new Map(rows.map(row => [canonicalJSON(row.original), row]));
  const previous = new Map(before.assertions.map(root => [root.id, root]));
  const groups = new Map();
  /** Resolve one active logical assertion identity or return null for inactive historical roots. @param {object} root Original assertion. @returns {string|null} Projected ordered triple. */
  function key(root) {
    const source = observed.get(canonicalJSON(root.source)), target = observed.get(canonicalJSON(root.target));
    if (source.status !== 'active' || target.status !== 'active') return null;
    return edgeKey({ source: source.resolved, target: target.resolved, type: root.type });
  }
  for (const root of after.assertions) {
    const value = key(root); if (value === null) continue;
    if (!groups.has(value)) groups.set(value, []); groups.get(value).push(root.id);
  }
  for (const root of [...delta.added, ...delta.updated.map(pair => pair.after)]) {
    const source = observed.get(canonicalJSON(root.source)), target = observed.get(canonicalJSON(root.target));
    check(source.status === 'active' && target.status === 'active', 'Choose an available regular bibliographic reference', 'endpoint');
    const value = key(root), old = previous.get(root.id);
    check(source.resolved.key !== target.resolved.key || (old && edgeKey(old) === edgeKey(root)), 'Self-links through merged endpoints are not allowed');
    check(groups.get(value).length === 1 || (old && key(old) === value), 'Duplicate projected manual relationship');
  }
}

/** Bind native observations and complete projections to the existing guarded application transaction. */
export class LifecycleProjection {
  /** Require actual gateway resolution and real SHA-256 composition. @param {object} gateway Native item gateway. @param {Function} digest Async SHA-256 over UTF-8. */
  constructor(gateway, digest) { check(typeof gateway.inspect === 'function' && typeof digest === 'function', 'Explicit lifecycle dependencies required'); this.gateway = gateway; this.digest = digest; }

  /** Observe all semantic endpoint facts without storing titles or native numeric IDs. @param {object[]} snapshots Current/proposed authority. @returns {Promise<object>} Detached {rows,endpointRevision}. */
  async observe(snapshots) {
    const rows = [];
    for (const ref of references(snapshots)) {
      const { original, resolved, status, editable } = await this.gateway.inspect(ref);
      check(typeof editable === 'boolean', 'Native endpoint permission must be explicit');
      rows.push({ original, resolved, status, editable });
    }
    return { rows: jsonCopy(rows), endpointRevision: await this.digest(canonicalJSON(rows)) };
  }

  /** Inspect one current authority for a native-state-dependent application view. @param {object} snapshot Current valid graph. @returns {Promise<object>} Complete report and endpoint binding. */
  async current(snapshot) {
    const observation = await this.observe([snapshot]);
    return { ...observation, report: inspect(snapshot, observation.rows) };
  }

  /** Review complete current/proposed projections; conflicted before-state remains explicit. @param {object} before Current valid authority. @param {object} after Proposed valid authority. @returns {Promise<object>} ChangeSet, complete projection sides, endpoint binding and commit-time eligibility references. */
  async review(before, after) {
    const current = validateGraph(before), proposed = validateGraph(after), observation = await this.observe([current, proposed]);
    check(current.library === proposed.library, 'Cannot review graphs from different libraries');
    const assertions = entityDelta(current.assertions, proposed.assertions, 'id'); validateWrites(current, proposed, assertions, observation.rows);
    const previous = inspect(current, observation.rows), next = inspect(proposed, observation.rows); requireReady(next);
    const rules = entityDelta(current.rules, proposed.rules, 'id');
    const derived = previous.state === 'ready' ? entityDelta(previous.relationships, next.relationships, 'key') : null;
    const diagnostics = new Map([...previous.diagnostics, ...next.diagnostics].map(value => [canonicalJSON(value), value]));
    if (previous.state === 'conflict') diagnostics.set('projection-conflict', { code: 'projection-conflict',
      message: 'Current projected relationships have conflicting contributors; review the complete before and after states', details: {} });
    const changeSet = { assertions, types: entityDelta(current.types, proposed.types, 'id'), rules, derived, diagnostics: [...diagnostics.values()] };
    const refs = references([{ assertions: [...assertions.added, ...assertions.updated.map(pair => pair.after),
      ...(derived ? [...derived.added, ...derived.updated.map(pair => pair.after)] : next.relationships)] }]);
    const affected = [...rules.added, ...rules.updated.map(pair => pair.after)].filter(rule => rule.enabled);
    const roots = proposed.assertions.filter(root => affected.some(rule => rule.rootType === root.type));
    const allRefs = new Map([...refs, ...references([{ assertions: roots }])].map(ref => [canonicalJSON(ref), ref]));
    return { changeSet, projection: { before: previous, after: next }, endpointRevision: observation.endpointRevision,
      refs: [...allRefs.values()], before: current };
  }

  /** Recheck exact semantic native facts under the repository's owned DB lock. @param {object} before Reviewed current authority. @param {object} after Reviewed proposal. @param {string} expected Endpoint SHA-256. @returns {Promise<void>} */
  async assertBinding(before, after, expected) {
    check((await this.observe([before, after])).endpointRevision === expected, 'Native endpoints changed; review again', 'conflict');
  }
}
