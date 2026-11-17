/** Explicit complete replacement of all observed conflict heads, without an invented baseline or implicit graph merge. */
import { check, jsonCopy } from '../domain/values.mts';
import { validateGraph } from '../domain/graph-contract.mts';
import { canonicalJSON } from '../storage/canonical.mts';
import { IssuedResolutionReviews } from './resolution-receipts.mts';
import type { Graph, ItemRef } from '../domain/contracts.mts';
import type { ApplicationGateway, RepositoryFactory, RepositoryPort, ResolutionApplied, ResolutionReview } from './contracts.mts';
import type { LifecycleProjection } from './lifecycle.mts';

/** Recovery shares its parent's lifetime, native projection and declared strict/event transaction factories. */
interface ResolutionOptions {
  gateway: ApplicationGateway; lifecycle: LifecycleProjection; repositoryFor: RepositoryFactory; repositoryForEvent: RepositoryFactory;
  assertActive(): void; invalidate(scope: string): void;
}

/** Validate and synchronously detach an unordered complete conflict-head set. @param input Caller-owned keys. @returns Sorted unique native keys. */
function captureHeads(input: string[]): string[] {
  const heads = jsonCopy(input);
  check(Array.isArray(heads) && heads.length >= 2 && heads.every(key => typeof key === 'string' && /^[A-Z0-9]{8}$/.test(key))
    && new Set(heads).size === heads.length, 'Explicit unique conflict heads required');
  return heads.sort();
}

/** Reobserve authority instead of relying on cached conflict state or incomplete historical branches. @param repository Actual repository. @param heads Complete reviewed head set. @returns Completion or conflict; schema/storage errors propagate. */
async function assertHeads(repository: RepositoryPort, heads: string[]): Promise<void> {
  const state = await repository.read();
  check(state.state === 'conflict' && canonicalJSON(state.heads) === canonicalJSON(heads), 'Conflict heads changed; review again', 'conflict');
}

/** Application recovery operations and receipt ownership, isolated from ordinary single-head command semantics. */
export class ResolutionCommands {
  #options: ResolutionOptions | null; #reviews = new IssuedResolutionReviews();

  /** Bind actual application resources and lifetime callbacks. @param options Parent-owned dependencies. */
  constructor(options: ResolutionOptions) { this.#options = options; }

  /** Capture live dependencies before suspension; later checks use the same parent lifetime. @returns Active resource bundle. */
  #active(): ResolutionOptions {
    check(this.#options !== null, 'Relationship application is stopped', 'conflict');
    this.#options.assertActive(); return this.#options;
  }

  /** Recognize actual recovery receipts without trusting public shape or display data. @param review Candidate issued review. @returns Whether this recovery generation owns it. */
  owns(review: object): review is ResolutionReview { return this.#reviews.owns(review); }

  /** Review each complete branch against an explicit validated replacement. Versions are authored replacement data: validateGraph applies, ordinary single-baseline +1 transitions do not. @param input Complete proposed graph. @param expectedHeads All observed conflict heads. @returns Issued detached per-head review and one union native binding, without writes. */
  async preview(input: Graph, expectedHeads: string[]): Promise<ResolutionReview> {
    const options = this.#active(), snapshot = validateGraph(input), heads = captureHeads(expectedHeads);
    const repository = options.repositoryFor(snapshot.library, null);
    await assertHeads(repository, heads); options.assertActive();
    const before: Graph[] = [];
    for (const head of heads) {
      const branch = await repository.readHead(head); options.assertActive();
      check(branch.head === head, 'Repository returned a different conflict head', 'conflict');
      const graph = validateGraph(branch.snapshot);
      check(graph.library === snapshot.library, 'Conflict branch belongs to another library'); before.push(graph);
    }
    await options.lifecycle.cooperation.yieldToHost(); options.assertActive();
    const observation = await options.lifecycle.observe([...before, snapshot]); options.assertActive();
    const branches: ResolutionReview['branches'] = [], refs = new Map<string, ItemRef>();
    for (const [index, graph] of before.entries()) {
      const review = await options.lifecycle.reviewObservedCaptured(graph, snapshot, observation); options.assertActive();
      for (const assertion of [...review.changeSet.assertions.added, ...review.changeSet.assertions.updated.map(pair => pair.after)]) {
        check(snapshot.types.some(type => type.id === assertion.type && !type.retired), 'An active existing relationship type is required');
      }
      branches.push({ head: heads[index], changeSet: review.changeSet, projection: review.projection });
      for (const ref of review.refs) refs.set(canonicalJSON(ref), ref);
    }
    const eligibility = [...refs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, ref]) => ref);
    await options.gateway.assertWritable(snapshot.library, eligibility); options.assertActive();
    await assertHeads(repository, heads); options.assertActive();
    const receipt = { expectedHeads: heads, snapshot, branches, endpointRevision: observation.endpointRevision };
    this.#reviews.issue(receipt, before, eligibility); return receipt;
  }

  /** Fresh direct-command recovery retains strict external-transaction rejection. @param snapshot Explicit replacement graph. @param heads All observed conflict heads. @returns Committed all-head generation and per-branch effects. */
  async apply(snapshot: Graph, heads: string[]): Promise<ResolutionApplied> {
    return this.#apply(snapshot, heads, this.#active().repositoryFor, null);
  }

  /** Publish only an actual unchanged issued review through the independent event boundary. @param receipt Current generation's issued review. @returns Committed revision and independently reviewed effects. */
  async applyReviewed(receipt: ResolutionReview): Promise<ResolutionApplied> {
    const options = this.#active(), binding = this.#reviews.get(receipt);
    return this.#apply(binding.snapshot, binding.expectedHeads, options.repositoryForEvent, binding.endpointRevision);
  }

  /** Repeat fresh preflight, native union eligibility/binding under the lock and actual repository all-head CAS. @param snapshot Captured replacement. @param heads Captured conflict heads. @param factory Declared strict/event boundary. @param endpointRevision Prior user review binding, or null for direct fresh-command mode. @returns Atomic committed result, even if teardown follows commit. */
  async #apply(snapshot: Graph, heads: string[], factory: RepositoryFactory, endpointRevision: string | null): Promise<ResolutionApplied> {
    const options = this.#active(), review = await this.preview(snapshot, heads); options.assertActive();
    check(endpointRevision === null || endpointRevision === review.endpointRevision, 'Native endpoints changed; review again', 'conflict');
    const binding = this.#reviews.get(review), scope = binding.snapshot.library;
    const repository = factory(scope, async () => {
      options.assertActive(); await options.gateway.assertWritable(scope, binding.refs); options.assertActive();
      const observed = await options.lifecycle.observe([...binding.before, binding.snapshot]); options.assertActive();
      check(observed.endpointRevision === binding.endpointRevision, 'Native endpoints changed; review again', 'conflict');
    });
    let revision: string;
    try { revision = await repository.resolve(binding.snapshot, binding.expectedHeads); }
    catch (error) { options.invalidate(scope); throw error; }
    options.invalidate(scope);
    return { revision, branches: review.branches.map(({ head, changeSet }) => ({ head, changeSet })) };
  }

  /** Release dependencies and expire every issued recovery receipt at parent teardown. @returns Completion. */
  stop(): void { this.#reviews.clear(); this.#options = null; }
}
