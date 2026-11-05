/** Platform-independent explicit relationship commands over injected native gateway and repository boundaries. */
import { check, exact, identifier, jsonCopy } from '../domain/values.mjs';
import { validateGraph, validateItemRef } from '../domain/graph-contract.mjs';
import { initialGraph } from './seed.mjs';
import { changesBetween, explicitEdges } from './changes.mjs';

/** Copy a backend state without imposing the graph byte limit on its enclosing state. @param {object} state Authoritative read state. @returns {object} Detached ordinary JSON. */
function copyState(state) {
  return state.state === 'ready'
    ? { state: 'ready', head: jsonCopy(state.head), snapshot: validateGraph(state.snapshot) } : jsonCopy(state);
}

/** Select unique changed endpoints in deterministic library/key order. @param {object} changeSet Valid review. @returns {object[]} Detached refs requiring current native eligibility. */
function changedRefs(changeSet) {
  const refs = new Map();
  for (const assertion of [...changeSet.assertions.added, ...changeSet.assertions.updated.map(value => value.after)]) {
    for (const ref of [assertion.source, assertion.target]) refs.set(JSON.stringify(ref), ref);
  }
  return [...refs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, ref]) => jsonCopy(ref));
}

/** Explicit-only application; repository factory must enforce the supplied guard inside its native transaction. */
export class RelationshipApplication {
  #gateway; #repositoryFor; #now; #newID;
  #repositories = new Map(); #states = new Map(); #stopped = false;

  /**
   * Bind required production dependencies without accessing native globals.
   * @param {object} options {gateway,repositoryFor,now,newID}; factory accepts (scope,guard|null).
   * @returns {RelationshipApplication} Application sharing repository identity and writer/cache ownership.
   */
  constructor({ gateway, repositoryFor, now, newID }) {
    check(!!gateway && ['describe', 'assertWritable', 'ref'].every(name => typeof gateway[name] === 'function'),
      'Explicit item gateway required');
    check([repositoryFor, now, newID].every(value => typeof value === 'function'), 'Explicit repository, clock and ID functions required');
    this.#gateway = gateway; this.#repositoryFor = repositoryFor; this.#now = now; this.#newID = newID;
  }

  /** Reject operations after teardown. @returns {void} Throws a visible failure. */
  #active() { check(!this.#stopped, 'Relationship application is stopped', 'conflict'); }

  /** Retrieve the production read repository once per scope. @param {string} scope Library. @returns {object} GraphRepository. */
  #repository(scope) {
    this.#active();
    validateItemRef({ library: scope, key: 'AAAAAAAA' });
    if (!this.#repositories.has(scope)) this.#repositories.set(scope, this.#repositoryFor(scope, null));
    return this.#repositories.get(scope);
  }

  /**
   * Coalesce reads by scope and discard responses from invalidated epochs.
   * @param {string} scope Library.
   * @param {boolean} fresh Whether to reobserve authority for a command preview.
   * @returns {Promise<object>} Private detached authoritative state; failures are never seeded.
   */
  async #current(scope, fresh = false) {
    const repository = this.#repository(scope);
    if (fresh || !this.#states.has(scope)) {
      const entry = { promise: Promise.resolve().then(() => repository.read()).then(copyState) };
      this.#states.set(scope, entry);
    }
    const entry = this.#states.get(scope);
    let state;
    try { state = await entry.promise; }
    catch (error) { if (this.#states.get(scope) === entry) this.#states.delete(scope); throw error; }
    this.#active();
    if (this.#states.get(scope) !== entry) return this.#current(scope);
    return state;
  }

  /** Return cached authoritative backend state detached for its caller. @param {string} scope Library. @returns {Promise<object>} Exact repository read state. */
  async read(scope) { return copyState(await this.#current(scope)); }

  /** Resolve a title/status through the actual gateway. @param {object} input ItemRef. @returns {Promise<object>} Detached native description. */
  async describe(input) {
    this.#active();
    const result = await this.#gateway.describe(validateItemRef(input));
    this.#active();
    return jsonCopy(result);
  }

  /**
   * Return small selection context; uninitialized catalog is proposed only, never persisted.
   * @param {object} input ItemRef.
   * @returns {Promise<object>} {state,revision,types,editable,diagnostics} without a snapshot.
   */
  async context(input) {
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
   * Read a bounded explicit page using the actual shared adjacency index after the first observation.
   * @param {object} input ItemRef. @param {string} direction outgoing/incoming/both.
   * @param {string|null} typeFilter Type ID or null. @param {object} page Exact {offset,limit}.
   * @returns {Promise<object>} Frozen-contract {revision,relationships,total,nextOffset,diagnostics}.
   */
  async listRelationships(input, direction, typeFilter, page) {
    const ref = validateItemRef(input), detachedPage = jsonCopy(page);
    const state = await this.#current(ref.library);
    check(state.state === 'ready', `Relationship authority is ${state.state}; a ready generation is required`, 'conflict');
    const result = this.#repository(ref.library).adjacent(ref, state.head, direction, typeFilter, detachedPage);
    const relationships = explicitEdges({ ...state.snapshot, assertions: result.assertions });
    const endpoints = new Map();
    for (const edge of relationships) for (const endpoint of [edge.source, edge.target]) endpoints.set(JSON.stringify(endpoint), endpoint);
    const descriptions = await Promise.all([...endpoints.values()].map(endpoint => this.describe(endpoint)));
    const diagnostics = descriptions.filter(value => value.status !== 'active').map(value => ({
      code: 'endpoint', message: `Relationship endpoint is ${value.status}`, details: { ref: value.ref, status: value.status },
    }));
    return { revision: result.revision, relationships, total: result.total, nextOffset: result.nextOffset, diagnostics };
  }

  /** Select a draft graph only from ready authority or explicit uninitialized action. @param {object} state Backend state. @param {string} scope Library. @returns {object} Independent draft graph. */
  #base(state, scope) {
    if (state.state === 'ready') return validateGraph(state.snapshot);
    check(state.state === 'uninitialized', `Relationship authority is ${state.state}; draft unavailable`, 'conflict');
    return initialGraph(scope);
  }

  /** Require active type selection for a new or edited assertion. @param {object} graph Draft. @param {string} id Type ID. @returns {void} */
  #activeType(graph, id) {
    const type = graph.types.find(value => value.id === id);
    check(!!type && !type.retired, 'An active existing relationship type is required');
  }

  /**
   * Draft an explicit creation; IDs and timestamps come only from injected functions.
   * @param {object} input Exact {source,target,type,metadata}.
   * @returns {Promise<object>} Detached {command:{kind:'replace',snapshot},expectedRevision}.
   */
  async draftCreate(input) {
    this.#active();
    const value = jsonCopy(input); exact(value, ['source', 'target', 'type', 'metadata']);
    const scope = validateItemRef(value.source).library, state = await this.#current(scope), graph = this.#base(state, scope);
    this.#activeType(graph, value.type);
    const timestamp = this.#now();
    graph.assertions.push({ ...value, id: this.#newID(), createdAt: timestamp, updatedAt: timestamp });
    return { command: { kind: 'replace', snapshot: validateGraph(graph) }, expectedRevision: state.state === 'ready' ? state.head : null };
  }

  /**
   * Draft a full assertion edit preserving identity and original creation time.
   * @param {string} id Assertion ID. @param {object} input Exact {source,target,type,metadata}.
   * @param {string} scope Containing library.
   * @returns {Promise<object>} Detached command and expected revision.
   */
  async draftUpdate(id, input, scope) {
    this.#active(); identifier(id);
    const value = jsonCopy(input); exact(value, ['source', 'target', 'type', 'metadata']);
    const state = await this.#current(scope), graph = this.#base(state, scope);
    const index = graph.assertions.findIndex(assertion => assertion.id === id);
    check(index >= 0, 'Unknown explicit assertion'); this.#activeType(graph, value.type);
    graph.assertions[index] = { ...value, id, createdAt: graph.assertions[index].createdAt, updatedAt: this.#now() };
    return { command: { kind: 'replace', snapshot: validateGraph(graph) }, expectedRevision: state.state === 'ready' ? state.head : null };
  }

  /** Draft retraction of exactly one explicit assertion. @param {string} id Assertion ID. @param {string} scope Library. @returns {Promise<object>} Detached command and revision. */
  async draftRemove(id, scope) {
    this.#active(); identifier(id);
    const state = await this.#current(scope), graph = this.#base(state, scope);
    const index = graph.assertions.findIndex(assertion => assertion.id === id);
    check(index >= 0, 'Unknown explicit assertion'); graph.assertions.splice(index, 1);
    return { command: { kind: 'replace', snapshot: graph }, expectedRevision: state.state === 'ready' ? state.head : null };
  }

  /**
   * Validate and review detached authority against a fresh ready head or explicit initialization.
   * @param {object} command Exact {kind:'replace',snapshot}.
   * @param {string|null} expectedRevision Reviewed native manifest key or null for initialization.
   * @returns {Promise<object>} Exact {expectedRevision,snapshot,changeSet}; never performs writes.
   */
  async preview(command, expectedRevision) {
    this.#active(); exact(command, ['kind', 'snapshot']);
    check(command.kind === 'replace', 'Unsupported relationship command');
    const snapshot = validateGraph(command.snapshot);
    check(expectedRevision === null || (typeof expectedRevision === 'string' && /^[A-Z0-9]{8}$/.test(expectedRevision)), 'Invalid expected revision');
    const state = await this.#current(snapshot.library, true);
    check((state.state === 'ready' && state.head === expectedRevision)
      || (state.state === 'uninitialized' && expectedRevision === null), 'Authority revision changed; review again', 'conflict');
    const current = this.#base(state, snapshot.library);
    check(!current.rules.some(rule => rule.enabled) && !snapshot.rules.some(rule => rule.enabled),
      'This build supports explicit relationships; rule evaluation is not available yet');
    const changeSet = changesBetween(current, snapshot);
    for (const assertion of [...changeSet.assertions.added, ...changeSet.assertions.updated.map(value => value.after)]) {
      this.#activeType(snapshot, assertion.type);
    }
    await this.#gateway.assertWritable(snapshot.library, changedRefs(changeSet));
    this.#active();
    return { expectedRevision, snapshot, changeSet };
  }

  /**
   * Recompute review and commit through the parent's real transaction guard decorator.
   * @param {object} command Full replacement command. @param {string|null} expectedRevision Reviewed head.
   * @returns {Promise<object>} {revision,changeSet} after atomic publication and a fresh read.
   */
  async apply(command, expectedRevision) {
    const preview = await this.preview(command, expectedRevision), scope = preview.snapshot.library;
    const refs = changedRefs(preview.changeSet);
    const repository = this.#repositoryFor(scope, async () => {
      this.#active(); await this.#gateway.assertWritable(scope, jsonCopy(refs)); this.#active();
    });
    let revision;
    try { revision = await repository.compareAndCommit(preview.snapshot, expectedRevision); }
    catch (error) { this.invalidate(scope); throw error; }
    this.invalidate(scope); await this.read(scope);
    return { revision, changeSet: preview.changeSet };
  }

  /** Invalidate one epoch and its process-shared native adjacency cache. @param {string} scope Library. @returns {void} */
  invalidate(scope) { this.#states.delete(scope); this.#repositories.get(scope)?.invalidate(); }

  /** Clear every cached epoch and shared index. @returns {void} */
  invalidateAll() {
    this.#states.clear();
    for (const repository of this.#repositories.values()) repository.invalidate();
    this.#repositories.clear();
  }

  /** Stop commands and release cached native references; idempotent. @returns {void} */
  stop() {
    this.#stopped = true; this.invalidateAll();
    this.#gateway = null; this.#repositoryFor = null; this.#now = null; this.#newID = null;
  }
}
