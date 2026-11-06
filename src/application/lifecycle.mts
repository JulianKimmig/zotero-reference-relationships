/** Native-state-bound projected reads and complete conflict-aware change review without authority rewrites. */
import { ContractError, check, jsonCopy } from '../domain/values.mts';
import { validateGraph, edgeKey } from '../domain/graph-contract.mts';
import { inspectEndpoints, inspectEndpointsAsync } from '../domain/inspect-endpoints.mts';
import { validateCooperation } from '../domain/cooperative-traversal.mts';
import type { EvaluationCooperation } from '../domain/cooperative-traversal.mts';
import { canonicalJSON } from '../storage/canonical.mts';
import { entityDelta, entityDeltaAsync } from './changes.mts';
import type { Assertion, Digest, Edge, Graph, ItemRef } from '../domain/contracts.mts';
import type { EndpointResolution, ProjectionReport } from '../domain/projection-contracts.mts';
import type { ApplicationGateway, EntityDelta } from './contracts.mts';

/** Enumerate stable references from authorities or reviewed assertion collections. @param {object[]} snapshots Objects with validated assertion/entity arrays. @returns {object[]} Sorted independent endpoint references. */
function references(snapshots: { assertions: readonly Edge[] }[]): ItemRef[] {
  const refs = new Map<string, ItemRef>();
  for (const graph of snapshots) for (const root of graph.assertions) for (const ref of [root.source, root.target]) refs.set(canonicalJSON(ref), ref);
  return [...refs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, ref]) => ({ ...ref }));
}

/** Inspect a complete graph using only its own original endpoint observations. @param {object} snapshot Valid graph. @param {object[]} rows Union of before/after native observations. @returns {object} Complete projection inspection. */
function inspect(snapshot: Graph, rows: EndpointResolution[]): ProjectionReport {
  const keys = new Set(references([snapshot]).map(ref => canonicalJSON(ref)));
  return inspectEndpoints(snapshot, rows.filter(row => keys.has(canonicalJSON(row.original)))
    .map(({ original, resolved, status }) => ({ original, resolved, status })));
}

/** Inspect only one graph's detached endpoint subset while cooperating with the real host. @param snapshot Valid authority. @param rows Complete observation union. @param cooperation Explicit owner scheduling/liveness. @returns Complete projected inspection without a synchronous closure fallback. */
export async function inspectObservedAsync(snapshot: Graph, rows: EndpointResolution[], cooperation: EvaluationCooperation): Promise<ProjectionReport> {
  const keys = new Set(references([snapshot]).map(ref => canonicalJSON(ref)));
  return inspectEndpointsAsync(snapshot, rows.filter(row => keys.has(canonicalJSON(row.original)))
    .map(({ original, resolved, status }) => ({ original, resolved, status })), cooperation);
}

/** Reject aggregate ambiguity after a proposal with deterministic original contributor witnesses. @param {object} report Complete after inspection. @returns {void} */
function requireReady(report: ProjectionReport): asserts report is Extract<ProjectionReport, { state: 'ready' }> {
  if (report.state === 'ready') return;
  if (report.state === 'endpoint-conflict') throw new ContractError('endpoint',
    'Native aliases remain unresolved; explicitly repair the affected original relationships', { diagnostics: report.diagnostics });
  const cluster = report.clusters.find(cluster => cluster.conflicts.length > 0)!, conflict = cluster.conflicts[0];
  const first = conflict.contributors[0], different = conflict.contributors.find(value => value.value !== first.value);
  throw new ContractError('conflict', `Conflicting relationship metadata for ${conflict.field}`,
    { key: cluster.key, field: conflict.field, contributors: [first, different] });
}

export { inspect as inspectObserved, requireReady as requireReadyProjection };

/** Validate new/moved explicit triples against actual native endpoints while preserving existing merge collisions. @param {object} before Valid current authority. @param {object} after Valid proposal. @param {object} delta Authority assertion delta. @param {object[]} rows Complete union observations. @returns {void} */
function validateWrites(before: Graph, after: Graph, delta: EntityDelta<Assertion>, rows: EndpointResolution[]): void {
  const observed = new Map(rows.map(row => [canonicalJSON(row.original), row]));
  const previous = new Map(before.assertions.map(root => [root.id, root]));
  const groups = new Map<string, string[]>();
  /** Resolve one active logical assertion identity or return null for inactive historical roots. @param {object} root Original assertion. @returns {string|null} Projected ordered triple. */
  function key(root: Assertion): string | null {
    const source = observed.get(canonicalJSON(root.source))!, target = observed.get(canonicalJSON(root.target))!;
    if (source.status !== 'active' || target.status !== 'active') return null;
    return edgeKey({ source: source.resolved, target: target.resolved, type: root.type });
  }
  for (const root of after.assertions) {
    const value = key(root); if (value === null) continue;
    if (!groups.has(value)) groups.set(value, []); groups.get(value)!.push(root.id);
  }
  for (const root of [...delta.added, ...delta.updated.map(pair => pair.after)]) {
    const source = observed.get(canonicalJSON(root.source))!, target = observed.get(canonicalJSON(root.target))!;
    check(source.status === 'active' && target.status === 'active', 'Choose an available regular bibliographic reference', 'endpoint');
    const value = key(root), old = previous.get(root.id);
    check(source.resolved.key !== target.resolved.key || (old && edgeKey(old) === edgeKey(root)), 'Self-links through merged endpoints are not allowed');
    check(groups.get(value!)!.length === 1 || (old && key(old) === value), 'Duplicate projected manual relationship');
  }
}

/** Bind native observations and complete projections to the existing guarded application transaction. */
export class LifecycleProjection {
  readonly gateway: Pick<ApplicationGateway, 'inspect'>;
  readonly digest: Digest;
  readonly cooperation: EvaluationCooperation;
  /** Require actual native inspection, SHA-256 and explicit host scheduling/liveness. @param gateway Native observation port. @param digest Actual SHA-256. @param cooperation Host work quantum and throwing lifetime check. */
  constructor(gateway: Pick<ApplicationGateway, 'inspect'>, digest: Digest, cooperation: EvaluationCooperation) {
    check(typeof gateway.inspect === 'function' && typeof digest === 'function', 'Explicit lifecycle dependencies required');
    validateCooperation(cooperation); this.gateway = gateway; this.digest = digest; this.cooperation = cooperation;
  }

  /** Observe all semantic endpoint facts without storing titles or native numeric IDs. @param {object[]} snapshots Current/proposed authority. @returns {Promise<object>} Detached {rows,endpointRevision}. */
  async observe(snapshots: { assertions: readonly Edge[] }[]) {
    this.cooperation.assertActive(); let count = 0;
    const rows: (EndpointResolution & { editable: boolean })[] = [];
    for (const ref of references(snapshots)) {
      this.cooperation.assertActive();
      const { original, resolved, status, editable } = await this.gateway.inspect(ref);
      this.cooperation.assertActive();
      check(typeof editable === 'boolean', 'Native endpoint permission must be explicit');
      rows.push({ original, resolved, status, editable } as EndpointResolution & { editable: boolean });
      if (++count % this.cooperation.batchSize === 0) { await this.cooperation.yieldToHost(); this.cooperation.assertActive(); }
    }
    const endpointRevision = await this.digest(canonicalJSON(rows)); this.cooperation.assertActive();
    return { rows: jsonCopy(rows), endpointRevision };
  }

  /** Inspect one current authority for a native-state-dependent application view. @param {object} snapshot Current valid graph. @returns {Promise<object>} Complete report and endpoint binding. */
  async current(snapshot: Graph) {
    const observation = await this.observe([snapshot]);
    return { ...observation, report: await inspectObservedAsync(snapshot, observation.rows, this.cooperation) };
  }

  /** Review complete current/proposed projections; conflicted before-state remains explicit. @param {object} before Current valid authority. @param {object} after Proposed valid authority. @returns {Promise<object>} ChangeSet, complete projection sides, endpoint binding and commit-time eligibility references. */
  async review(before: unknown, after: unknown) {
    return this.#reviewPrepared(validateGraph(before), validateGraph(after));
  }

  /** Capture privately owned, already validated normalized finite-JSON authorities with native structured cloning before any suspension. Application preview admits external commands through validateGraph before this entry. @param before Private validated current graph. @param after Private validated proposal. @returns Fully detached review with the same projection, native binding and delta checks as strict review. */
  async reviewCaptured(before: Graph, after: Graph) {
    const current = structuredClone(before), proposed = structuredClone(after);
    return this.#reviewPrepared(current, proposed);
  }

  /** Review exclusively owned normalized captures, yielding before native reference preparation. @param current Detached current authority. @param proposed Detached proposal. @returns Complete review, or the original validation/native/cancellation failure. */
  async #reviewPrepared(current: Graph, proposed: Graph) {
    this.cooperation.assertActive(); await this.cooperation.yieldToHost(); this.cooperation.assertActive();
    const observation = await this.observe([current, proposed]);
    check(current.library === proposed.library, 'Cannot review graphs from different libraries');
    const assertions = entityDelta(current.assertions, proposed.assertions, 'id'); validateWrites(current, proposed, assertions, observation.rows);
    const previous = await inspectObservedAsync(current, observation.rows, this.cooperation);
    const next = await inspectObservedAsync(proposed, observation.rows, this.cooperation); requireReady(next);
    const rules = entityDelta(current.rules, proposed.rules, 'id');
    const derived = previous.state === 'ready' ? await entityDeltaAsync(previous.relationships, next.relationships, 'key', this.cooperation) : null;
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
  async assertBinding(before: Graph, after: Graph, expected: string): Promise<void> {
    check((await this.observe([before, after])).endpointRevision === expected, 'Native endpoints changed; review again', 'conflict');
  }
}
