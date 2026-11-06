/** Reviewed portable transfer binds original authority, owner, native facts and a verified backup before publication. */
import { check } from '../domain/values.mts';
import { validateItemRef } from '../domain/graph-contract.mts';
import { canonicalJSON } from '../storage/canonical.mts';
import { LifecycleProjection } from '../application/lifecycle.mts';
import { createExport, verifyExport } from './format.mts';
import { mapSnapshot } from './mapping.mts';
import { mergeSnapshots } from './proposal.mts';
import { reviewTransfer } from './review.mts';
import { ImportTokens } from './tokens.mts';
import type { Graph } from '../domain/contracts.mts';
import type { RepositoryState } from '../storage/contracts.mts';
import type { ImportBinding, TransferOptions } from './service-contracts.mts';

/** Reject incomplete/conflicting authority rather than invent an empty current graph. @param {object} state Actual repository state. @param {string|null} expected Captured manifest key or explicit initialization. @returns {Graph|null} Current validated graph or genuinely uninitialized null. */
function currentGraph(state: RepositoryState, expected: string | null): Graph | null {
  check((state.state === 'ready' && state.head === expected) || (state.state === 'uninitialized' && expected === null),
    'Import authority revision changed or is incomplete; review again', 'conflict');
  return state.state === 'ready' ? state.snapshot : null;
}

/** One generation of transfer operations with private review identity and no implicit endpoint mapping. */
export class TransferService {
  readonly #options: TransferOptions;
  readonly #lifecycle: LifecycleProjection;
  readonly #tokens = new ImportTokens<ImportBinding>();
  #stopped = false;

  /** Bind actual native ownership, notes and filesystem ports. @param {object} options Native transfer dependencies and application invalidation. */
  constructor(options: TransferOptions) {
    this.#options = options; this.#lifecycle = new LifecycleProjection(options.gateway, options.digest);
  }

  /** Refuse operations after teardown. @returns {void} */
  #active(): void { check(!this.#stopped, 'Transfer service is stopped', 'conflict'); }

  /** Retrieve an actual issued review whose input references remain unchanged. @param {object} token Opaque generation-local identity. @returns {object} Private binding. */
  #binding(token: object): ImportBinding {
    this.#active(); const binding = this.#tokens.get(token);
    check(!binding.busy, 'Import review already has an operation in progress', 'conflict'); return binding;
  }

  /** Export one complete ready snapshot with actual containing ownership and fresh revision checks. @param {string} scope Explicit library. @returns {Promise<object>} Valid owner-bound portable envelope. */
  async exportGraph(scope: string) {
    this.#active(); validateItemRef({ library: scope, key: 'AAAAAAAA' });
    const owner = this.#options.identity.capture(scope), repository = this.#options.repositoryFor(scope, null), state = await repository.read();
    this.#active(); check(state.state === 'ready', 'Export requires complete ready authority', 'conflict');
    const document = await createExport({ source: owner.owner, snapshot: state.snapshot, exportedAt: this.#options.now() }, this.#options.digest);
    this.#active(); owner.assertCurrent(); currentGraph(await repository.read(), state.head); this.#active(); return document;
  }

  /** Validate and review a complete mapped import without filesystem or graph writes. @param {unknown} document Exact untrusted export document. @param {unknown} inputMapping Explicit complete endpoint decisions. @param {string} operation merge or replace. @param {string|null} expectedRevision Current ready manifest or explicit initialization. @returns {Promise<object>} Exact {previewToken,changeSet}; full evidence is available through inspectImport. */
  async previewImport(document: unknown, inputMapping: unknown, operation: string, expectedRevision: string | null) {
    this.#active();
    check(operation === 'merge' || operation === 'replace', 'Choose merge or replace explicitly');
    check(expectedRevision === null || (typeof expectedRevision === 'string' && /^[A-Z0-9]{8}$/.test(expectedRevision)), 'Invalid expected import revision');
    // Capture signatures before awaits: changes during hashing or native observation cannot be silently reviewed.
    const signature = canonicalJSON(document, { maxBytes: 2_097_152 }), mappingSignature = canonicalJSON(inputMapping);
    const verified = await verifyExport(document, this.#options.digest), mapped = mapSnapshot(verified.snapshot, verified.source, inputMapping);
    this.#active(); const scope = mapped.snapshot.library, owner = this.#options.identity.capture(scope);
    check(canonicalJSON(owner.owner) === canonicalJSON(mapped.mapping.target), 'Explicit mapping does not select the actual native owner', 'conflict');
    const before = currentGraph(await this.#options.repositoryFor(scope, null).read(), expectedRevision);
    const proposed = mergeSnapshots(before, mapped.snapshot, operation), observation = await this.#lifecycle.observe(before ? [before, proposed] : [proposed]);
    const review = reviewTransfer(before, proposed, mapped.mapping, observation.rows);
    await this.#options.gateway.assertWritable(scope, review.refs); this.#active(); owner.assertCurrent();
    currentGraph(await this.#options.repositoryFor(scope, null).read(), expectedRevision); this.#active();
    check(canonicalJSON(document, { maxBytes: 2_097_152 }) === signature && canonicalJSON(inputMapping) === mappingSignature,
      'Import inputs changed while preparing review', 'conflict');
    const binding: ImportBinding = { scope, owner, expectedRevision, operation, document: verified, mapping: mapped.mapping,
      review, endpointRevision: observation.endpointRevision, noop: operation === 'merge' && before !== null
        && canonicalJSON(before) === canonicalJSON(proposed), backup: null, busy: false };
    const previewToken = this.#tokens.issue(document, inputMapping, binding);
    return { previewToken, changeSet: structuredClone(review.changeSet) };
  }

  /** Recheck owner, permissions and exact native facts; head is checked outside and by the repository under lock. @param {object} token Actual identity used to detect input changes across awaits. @param {object} binding Private reviewed state. @returns {Promise<void>} */
  async #native(token: object, binding: ImportBinding): Promise<void> {
    this.#active(); this.#tokens.get(token); binding.owner.assertCurrent();
    await this.#options.gateway.assertWritable(binding.scope, binding.review.refs); this.#active();
    const observation = await this.#lifecycle.observe(binding.review.before ? [binding.review.before, binding.review.after] : [binding.review.after]);
    this.#active(); check(observation.endpointRevision === binding.endpointRevision, 'Native import endpoints changed; review again', 'conflict');
    binding.owner.assertCurrent(); this.#tokens.get(token);
  }

  /** Require the exact current head and native review before an externally visible action. @param {object} token Issued identity. @param {object} binding Private review. @returns {Promise<void>} */
  async #verify(token: object, binding: ImportBinding): Promise<void> {
    try {
      currentGraph(await this.#options.repositoryFor(binding.scope, null).read(), binding.expectedRevision);
      await this.#native(token, binding);
    } catch (error) { this.#tokens.retire(token); throw error; }
  }

  /** Inspect complete detached before/after graphs and projections, retained originals and backup status. @param {object} token Issued identity. @returns {Promise<object>} Captured evidence without writes or private owner closures. */
  async inspectImport(token: object) {
    const binding = this.#binding(token); await this.#verify(token, binding);
    return structuredClone({ ...binding.review, mapping: binding.mapping, operation: binding.operation,
      expectedRevision: binding.expectedRevision, noop: binding.noop,
      backup: binding.backup ? { path: binding.backup.path, hash: binding.backup.document.hash } : null });
  }

  /** Save and verify the complete old graph before privately acknowledging a backup for this review. @param {object} token Issued identity. @param {string} path Explicit new output file. @returns {Promise<void>} Resolves only after actual validated file readback and unchanged review. */
  async backupImport(token: object, path: string): Promise<void> {
    const binding = this.#binding(token); binding.busy = true;
    try {
      await this.#verify(token, binding); check(binding.review.before !== null, 'An uninitialized store has no previous graph to back up');
      const document = await createExport({ source: binding.owner.owner, snapshot: binding.review.before,
        exportedAt: this.#options.now() }, this.#options.digest);
      this.#active(); await this.#options.files.writeNew(path, document);
      await this.#verify(token, binding); binding.backup = { path, document };
    } finally { binding.busy = false; }
  }

  /** Require the actual backup file to remain exactly the acknowledged old graph. @param {object} binding Captured old authority/backup. @returns {Promise<void>} */
  async #backup(binding: ImportBinding): Promise<void> {
    if (binding.operation !== 'replace' || binding.review.before === null) return;
    check(binding.backup !== null, 'Replacement requires a complete verified backup first', 'conflict');
    const actual = await this.#options.files.read(binding.backup.path); this.#active();
    check(canonicalJSON(actual, { maxBytes: 2_097_152 }) === canonicalJSON(binding.backup.document, { maxBytes: 2_097_152 }),
      'Backup file changed or no longer contains the complete old graph', 'conflict');
  }

  /** Publish one guarded immutable generation, or accept a ready unchanged merge under the same native transaction checks. @param {object} token Actual issued identity. @returns {Promise<object>} Exact {revision,changeSet} after owned transaction success. */
  async commitImport(token: object) {
    const binding = this.#binding(token);
    check(binding.operation !== 'replace' || binding.review.before === null || binding.backup !== null,
      'Replacement requires a complete verified backup first', 'conflict');
    binding.busy = true;
    try {
      await this.#verify(token, binding); await this.#backup(binding);
      const repository = this.#options.repositoryForEvent(binding.scope, async () => {
        await this.#native(token, binding); await this.#backup(binding); this.#active(); this.#tokens.get(token);
      });
      const revision = binding.noop ? await repository.compareAndCheck(binding.expectedRevision!)
        : await repository.compareAndCommit(binding.review.after, binding.expectedRevision);
      this.#tokens.retire(token); this.#options.invalidate(binding.scope);
      return { revision, changeSet: structuredClone(binding.review.changeSet) };
    } catch (error) { this.#tokens.retire(token); this.#options.invalidate(binding.scope); throw error; }
    finally { binding.busy = false; }
  }

  /** Cancel exactly one issued review without graph or file writes. @param {object} token Issued identity. @returns {void} */
  cancelImport(token: object): void { this.#active(); this.#tokens.get(token); this.#tokens.retire(token); }

  /** Retire all previews when the plugin generation stops. @returns {void} */
  stop(): void { this.#stopped = true; this.#tokens.clear(); }
}
