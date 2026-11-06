/** Platform-independent rooted relationship commands over native gateway and repository boundaries. */
import { check, exact, identifier, jsonCopy } from '../domain/values.mts';
import { validateGraph, validateItemRef } from '../domain/graph-contract.mts';
import { initialGraph } from './seed.mts';
import { proposeTypeChange, validateTypeTransition } from './catalog.mts';
import { validateRuleTransition } from './rule-transition.mts';
import { proposeRuleChange } from './rule-commands.mts';
import { LifecycleProjection } from './lifecycle.mts';
import { indexProjection, projectedPage, inspectionPage } from './projection-views.mts';
import { IssuedReviews } from './receipts.mts';
import { proposeRemoval } from './assertion-commands.mts';
import type { Graph } from '../domain/contracts.mts';
import type { Page } from '../domain/pagination.mts';
import type { RepositoryState } from '../storage/contracts.mts';
import type { Applied, ApplicationGateway, ApplicationOptions, AssertionInput, Draft, RepositoryFactory, RepositoryPort, Review, RuleCommand, SelectionContext, TypeCommand } from './contracts.mts';

/** Copy a backend state without imposing the graph byte limit on its enclosing state. @param {object} state Authoritative read state. @returns {object} Detached ordinary JSON. */
function copyState(state: RepositoryState): RepositoryState {
  return state.state === 'ready'
    ? { state: 'ready', head: jsonCopy(state.head), snapshot: validateGraph(state.snapshot) } : jsonCopy(state);
}

/** Rooted application; repository factory enforces the supplied guard inside its native transaction. */
export class RelationshipApplication {
  #gateway: ApplicationGateway | null; #repositoryFor: RepositoryFactory | null; #repositoryForEvent: RepositoryFactory | null;
  #now: (() => string) | null; #newID: (() => string) | null;
  #repositories = new Map<string, RepositoryPort>(); #states = new Map<string, { promise: Promise<RepositoryState> }>(); #stopped = false;
  #views = new WeakMap<object, Promise<ReturnType<typeof indexProjection>>>();
  #lifecycle: LifecycleProjection | null; #reviews = new IssuedReviews();

  /**
   * Bind required production dependencies without accessing native globals.
   * @param {object} options {gateway,repositoryFor,repositoryForEvent,digest,now,newID}; factories bind strict/event native transaction boundaries.
   * @returns {RelationshipApplication} Application sharing repository identity and writer/cache ownership.
   */
  constructor({ gateway, repositoryFor, repositoryForEvent, digest, now, newID }: ApplicationOptions) {
    check(!!gateway && (['describe', 'assertWritable', 'ref'] as const).every(name => typeof gateway[name] === 'function'),
      'Explicit item gateway required');
    check([repositoryFor, repositoryForEvent, now, newID].every(value => typeof value === 'function'), 'Explicit repository boundaries, clock and ID functions required');
    this.#gateway = gateway; this.#repositoryFor = repositoryFor; this.#repositoryForEvent = repositoryForEvent; this.#now = now; this.#newID = newID;
    this.#lifecycle = new LifecycleProjection(gateway, digest);
  }

  /** Reject operations after teardown. @returns {void} Throws a visible failure. */
  #active() { check(!this.#stopped, 'Relationship application is stopped', 'conflict'); }

  /** Retrieve the production read repository once per scope. @param {string} scope Library. @returns {object} GraphRepository. */
  #repository(scope: string): RepositoryPort {
    this.#active();
    validateItemRef({ library: scope, key: 'AAAAAAAA' });
    if (!this.#repositories.has(scope)) this.#repositories.set(scope, this.#repositoryFor!(scope, null));
    return this.#repositories.get(scope)!;
  }

  /**
   * Coalesce reads by scope and discard responses from invalidated epochs.
   * @param {string} scope Library.
   * @param {boolean} fresh Whether to reobserve authority for a command preview.
   * @returns {Promise<object>} Private detached authoritative state; failures are never seeded.
   */
  async #current(scope: string, fresh: boolean = false): Promise<RepositoryState> {
    const repository = this.#repository(scope);
    if (fresh || !this.#states.has(scope)) {
      const entry = { promise: Promise.resolve().then(() => repository.read()).then(copyState) };
      this.#states.set(scope, entry);
    }
    const entry = this.#states.get(scope)!;
    let state;
    try { state = await entry.promise; }
    catch (error) { if (this.#states.get(scope) === entry) this.#states.delete(scope); throw error; }
    this.#active();
    if (this.#states.get(scope) !== entry) return this.#current(scope);
    return state;
  }

  /** Return cached authoritative backend state detached for its caller. @param {string} scope Library. @returns {Promise<object>} Exact repository read state. */
  async read(scope: string) { return copyState(await this.#current(scope)); }

  /** Resolve a title/status through the actual gateway. @param {object} input ItemRef. @returns {Promise<object>} Detached native description. */
  async describe(input: unknown) {
    this.#active();
    const result = await this.#gateway!.describe(validateItemRef(input));
    this.#active();
    return jsonCopy(result);
  }

  /** Coalesce complete native projection inspection/indexing per authority/native invalidation epoch. @param {object} state Private ready state. @returns {Promise<object>} Private complete observation/index. */
  async #projection(state: Extract<RepositoryState, { state: 'ready' }>): Promise<ReturnType<typeof indexProjection>> {
    if (!this.#views.has(state)) this.#views.set(state, this.#lifecycle!.current(state.snapshot).then(value => indexProjection(state.snapshot, value)));
    const projection = await this.#views.get(state)!; this.#active(); return projection;
  }

  /** Inspect original contributors and unresolved/self-edge diagnostics without writing repair data. @param {string} scope Library. @param {object} page Exact {offset,limit}. @returns {Promise<object>} Detached bounded inspection page. */
  async reconcile(scope: string, page: Page): Promise<ReturnType<typeof inspectionPage>> {
    const state = await this.#current(scope); check(state.state === 'ready', 'Ready authority is required for reconciliation', 'conflict');
    const projection = await this.#projection(state);
    if (await this.#current(scope) !== state) return this.reconcile(scope, page);
    return inspectionPage(projection, page, state.head);
  }

  /**
   * Return small selection context; uninitialized catalog is proposed only, never persisted.
   * @param {object} input ItemRef.
   * @returns {Promise<object>} {state,revision,types,editable,diagnostics} without a snapshot.
   */
  async context(input: unknown): Promise<SelectionContext> {
    const ref = validateItemRef(input), state = await this.#current(ref.library);
    const description = await this.describe(ref);
    const types = state.state === 'ready' ? state.snapshot.types
      : state.state === 'uninitialized' ? initialGraph(ref.library).types : [];
    const diagnostics = ['ready', 'uninitialized'].includes(state.state) ? []
      : [{ code: 'conflict', message: `Relationship authority is ${state.state}`, details: jsonCopy(state) }];
    return jsonCopy({ state: state.state, revision: state.state === 'ready' ? state.head : null,
      types, editable: description.editable && description.status === 'active', diagnostics });
  }

  /**
   * Read a bounded materialized page from a per-authority evaluation/endpoint index.
   * @param {object} input ItemRef. @param {string} direction outgoing/incoming/both.
   * @param {string|null} typeFilter Type ID or null. @param {object} page Exact {offset,limit}.
   * @returns {Promise<object>} Frozen-contract {revision,relationships,total,nextOffset,diagnostics}.
   */
  async listRelationships(input: unknown, direction: string, typeFilter: string|null, page: Page): Promise<ReturnType<typeof projectedPage>> {
    const ref = validateItemRef(input), detachedPage = jsonCopy(page);
    const state = await this.#current(ref.library);
    check(state.state === 'ready', `Relationship authority is ${state.state}; a ready generation is required`, 'conflict');
    const projection = await this.#projection(state), endpoint = await this.#gateway!.resolve(ref); this.#active();
    if (await this.#current(ref.library) !== state) return this.listRelationships(input, direction, typeFilter, page);
    check(endpoint.status === 'active', 'Selected reference is unavailable', 'endpoint');
    return projectedPage(projection, endpoint.resolved, direction, typeFilter, detachedPage, state.head);
  }

  /** Select a draft graph only from ready authority or explicit uninitialized action. @param {object} state Backend state. @param {string} scope Library. @returns {object} Independent draft graph. */
  #base(state: RepositoryState, scope: string): Graph {
    if (state.state === 'ready') return validateGraph(state.snapshot);
    check(state.state === 'uninitialized', `Relationship authority is ${state.state}; draft unavailable`, 'conflict');
    return initialGraph(scope);
  }

  /** Require active type selection for a new or edited assertion. @param {object} graph Draft. @param {string} id Type ID. @returns {void} */
  #activeType(graph: Graph, id: string): void {
    const type = graph.types.find(value => value.id === id);
    check(!!type && !type.retired, 'An active existing relationship type is required');
  }

  /**
   * Draft an explicit creation; IDs and timestamps come only from injected functions.
   * @param {object} input Exact {source,target,type,metadata}.
   * @returns {Promise<object>} Detached {command:{kind:'replace',snapshot},expectedRevision}.
   */
  async draftCreate(input: AssertionInput): Promise<Draft> {
    this.#active();
    const value = jsonCopy(input); exact(value, ['source', 'target', 'type', 'metadata']);
    const scope = validateItemRef(value.source).library, state = await this.#current(scope), graph = this.#base(state, scope);
    this.#activeType(graph, value.type);
    const timestamp = this.#now!();
    graph.assertions.push({ ...value, id: this.#newID!(), createdAt: timestamp, updatedAt: timestamp });
    return { command: { kind: 'replace', snapshot: validateGraph(graph) }, expectedRevision: state.state === 'ready' ? state.head : null };
  }

  /**
   * Draft a full assertion edit preserving identity and original creation time.
   * @param {string} id Assertion ID. @param {object} input Exact {source,target,type,metadata}.
   * @param {string} scope Containing library.
   * @returns {Promise<object>} Detached command and expected revision.
   */
  async draftUpdate(id: string, input: AssertionInput, scope: string): Promise<Draft> {
    this.#active(); identifier(id);
    const value = jsonCopy(input); exact(value, ['source', 'target', 'type', 'metadata']);
    const state = await this.#current(scope), graph = this.#base(state, scope);
    const index = graph.assertions.findIndex(assertion => assertion.id === id);
    check(index >= 0, 'Unknown explicit assertion'); this.#activeType(graph, value.type);
    graph.assertions[index] = { ...value, id, createdAt: graph.assertions[index].createdAt, updatedAt: this.#now!() };
    return { command: { kind: 'replace', snapshot: validateGraph(graph) }, expectedRevision: state.state === 'ready' ? state.head : null };
  }

  /** Draft retraction of exactly one explicit assertion. @param {string} id Assertion ID. @param {string} scope Library. @returns {Promise<object>} Detached command and revision. */
  async draftRemove(id: string, scope: string) {
    return this.draftRemoveMany([id], scope);
  }

  /** Draft atomic retraction of exactly the selected existing original assertions. @param {string[]} ids Nonempty unique original IDs. @param {string} scope Containing library. @returns {Promise<object>} Detached replacement command and captured revision. */
  async draftRemoveMany(ids: string[], scope: string): Promise<Draft> {
    this.#active();
    const state = await this.#current(scope), graph = this.#base(state, scope);
    return { command: { kind: 'replace', snapshot: proposeRemoval(graph, ids) }, expectedRevision: state.state === 'ready' ? state.head : null };
  }

  /** Propose a versioned catalog edit and explicit metadata migration without writes. @param {object} input Exact {library,kind,type,migration}. @returns {Promise<object>} Detached replacement command and expected revision. */
  async manageTypes(input: TypeCommand): Promise<Draft> {
    this.#active();
    const change = jsonCopy(input); exact(change, ['library', 'kind', 'type', 'migration']);
    const { library, ...definition } = change, state = await this.#current(library);
    const snapshot = proposeTypeChange(this.#base(state, library), definition, this.#now!());
    return { command: { kind: 'replace', snapshot }, expectedRevision: state.state === 'ready' ? state.head : null };
  }

  /** Propose a versioned rule create/update/delete without writes or generated authority. @param {object} input Exact {library,kind,rule} for create/update or {library,kind:'delete',id}. @returns {Promise<object>} Detached replacement command and expected native revision. */
  async manageRules(input: RuleCommand): Promise<Draft> {
    this.#active();
    const change = jsonCopy(input);
    check(change !== null && typeof change === 'object' && !Array.isArray(change), 'Expected a rule command');
    exact(change, change.kind === 'delete' ? ['library', 'kind', 'id'] : ['library', 'kind', 'rule']);
    const { library, ...definition } = change, state = await this.#current(library);
    const snapshot = proposeRuleChange(this.#base(state, library), definition);
    return { command: { kind: 'replace', snapshot }, expectedRevision: state.state === 'ready' ? state.head : null };
  }

  /**
   * Validate and review detached authority against a fresh ready head or explicit initialization.
   * @param {object} command Exact {kind:'replace',snapshot}.
   * @param {string|null} expectedRevision Reviewed native manifest key or null for initialization.
   * @returns {Promise<object>} Issued {expectedRevision,snapshot,changeSet,projection,endpointRevision}; never writes.
   */
  async preview(command: Draft['command'], expectedRevision: string|null): Promise<Review> {
    this.#active(); exact(command, ['kind', 'snapshot']);
    check(command.kind === 'replace', 'Unsupported relationship command');
    const snapshot = validateGraph(command.snapshot);
    check(expectedRevision === null || (typeof expectedRevision === 'string' && /^[A-Z0-9]{8}$/.test(expectedRevision)), 'Invalid expected revision');
    const state = await this.#current(snapshot.library, true);
    check((state.state === 'ready' && state.head === expectedRevision)
      || (state.state === 'uninitialized' && expectedRevision === null), 'Authority revision changed; review again', 'conflict');
    const current = this.#base(state, snapshot.library);
    validateTypeTransition(current, snapshot);
    validateRuleTransition(current, snapshot);
    const review = await this.#lifecycle!.review(current, snapshot), { changeSet } = review;
    this.#active();
    for (const assertion of [...changeSet.assertions.added, ...changeSet.assertions.updated.map(value => value.after)]) {
      this.#activeType(snapshot, assertion.type);
    }
    await this.#gateway!.assertWritable(snapshot.library, review.refs);
    this.#active();
    if (await this.#current(snapshot.library) !== state) return this.preview(command, expectedRevision);
    const receipt = { expectedRevision, snapshot, changeSet, projection: review.projection, endpointRevision: review.endpointRevision };
    this.#reviews.issue(receipt, review.before, review.refs); return receipt;
  }

  /**
   * Recompute review and commit through the parent's real transaction guard decorator.
   * @param {object} command Full replacement command. @param {string|null} expectedRevision Reviewed head.
   * @returns {Promise<object>} {revision,changeSet} after atomic publication; subsequent teardown cannot turn that committed write into rejection.
   */
  async apply(command: Draft['command'], expectedRevision: string|null) { this.#active(); return this.#apply(command, expectedRevision, this.#repositoryFor!, null); }

  /** Apply at an independent native event boundary, queuing behind unrelated host transactions. Never call from a native transaction callback. @param {object} command Reviewed snapshot command. @param {string|null} expectedRevision Head. @returns {Promise<object>} Committed revision and complete ChangeSet. */
  async applyFromEvent(command: Draft['command'], expectedRevision: string|null) { this.#active(); return this.#apply(command, expectedRevision, this.#repositoryForEvent!, null); }

  /** Publish exactly an actual current-generation user review, rejecting native changes even when the manifest is unchanged. @param {object} receipt Issued complete preview result. @returns {Promise<object>} Committed revision and reviewed ChangeSet. */
  async applyReviewed(receipt: Review) {
    this.#active(); const binding = this.#reviews.get(receipt);
    return this.#apply({ kind: 'replace', snapshot: binding.snapshot }, binding.expectedRevision, this.#repositoryForEvent!, binding.endpointRevision);
  }

  /** Revalidate and publish with manifest/native checks inside the selected owned transaction. @param {object} command Snapshot command. @param {string|null} expectedRevision Head. @param {Function} repositoryFor Strict/event factory. @param {string|null} expectedEndpointRevision User review binding or explicit direct-command mode. @returns {Promise<object>} Committed revision and ChangeSet. */
  async #apply(command: Draft['command'], expectedRevision: string|null, repositoryFor: RepositoryFactory, expectedEndpointRevision: string|null): Promise<Applied> {
    const preview = await this.preview(command, expectedRevision), scope = preview.snapshot.library;
    check(expectedEndpointRevision === null || preview.endpointRevision === expectedEndpointRevision, 'Native endpoints changed; review again', 'conflict');
    const binding = this.#reviews.get(preview);
    const repository = repositoryFor(scope, async () => {
      this.#active(); await this.#gateway!.assertWritable(scope, binding.refs);
      this.#active();
      await this.#lifecycle!.assertBinding(binding.before, binding.snapshot, binding.endpointRevision); this.#active();
    });
    let revision;
    try { revision = await repository.compareAndCommit(preview.snapshot, expectedRevision); }
    catch (error) { this.invalidate(scope); throw error; }
    this.invalidate(scope);
    return { revision, changeSet: preview.changeSet };
  }

  /** Invalidate one epoch and its process-shared native adjacency cache. @param {string} scope Library. @returns {void} */
  invalidate(scope: string) { this.#states.delete(scope); this.#repositories.get(scope)?.invalidate(); }

  /** Clear every cached epoch and shared index. @returns {void} */
  invalidateAll() {
    this.#states.clear(); this.#views = new WeakMap();
    for (const repository of this.#repositories.values()) repository.invalidate();
    this.#repositories.clear();
  }

  /** Stop commands and release cached native references; idempotent. @returns {void} */
  stop() {
    this.#stopped = true; this.invalidateAll();
    this.#reviews.clear(); this.#lifecycle = null;
    this.#gateway = null; this.#repositoryFor = null; this.#repositoryForEvent = null; this.#now = null; this.#newID = null;
  }
}
