/** Native backup/import panel owns explicit library selection, exact draft inputs and generation-local reviewed tokens. */
import { check } from '../domain/values.mts';
import { validateItemRef } from '../domain/graph-contract.mts';
import { element } from './dom.mts';
import { libraryChoices } from './library-choices.mts';
import { TransferMappingEditor } from './transfer-mapping.mts';
import { transferReview } from './transfer-review.mts';
import { transferButton, transferSelect, transferError } from './transfer-controls.mts';
import { openTransfer, exportTransfer, previewTransfer, backupTransfer, commitTransfer } from './transfer-actions.mts';
import type { TransferPanelOptions, ImportInspection } from './transfer-controls.mts';
import type { ExportEnvelope, SourceOwner } from '../transfer/contracts.mts';
import type { LibraryScope } from '../domain/contracts.mts';
export type { TransferPanelOptions, TransferPicker } from './transfer-controls.mts';

/** Own native listeners and pending views without changing application or filesystem authority on cancellation. */
export class TransferPanel {
  readonly options: TransferPanelOptions; readonly document: Document; readonly abort: AbortController;
  readonly librarySelect: HTMLSelectElement; readonly operation: HTMLSelectElement;
  readonly message: HTMLElement; readonly error: HTMLElement; readonly targetLabel: HTMLElement; readonly sourceLabel: HTMLElement;
  readonly draftBody: HTMLElement; readonly reviewBody: HTMLElement; readonly buttons: Record<string, HTMLButtonElement>;
  readonly retired = new Set<object>();
  library: LibraryScope = 'self'; revision: string | null = null; owner: SourceOwner | null = null;
  editable = false; authority = 'loading'; disposed = false; busy = false; committing = false; generation = 0;
  input: ExportEnvelope | null = null; inputPath: string | null = null; mapping: TransferMappingEditor | null = null;
  token: object | null = null; inspection: ImportInspection | null = null;
  #review: ReturnType<typeof transferReview> | null = null; #reviewAbort: AbortController | null = null;
  #operationValue = 'merge';

  /** Mount accessible literal transfer controls beside existing preferences. @param {object} options Actual native window, services, owner identity, files and external picker. */
  constructor(options: TransferPanelOptions) {
    this.options = options; this.document = options.root.ownerDocument; this.abort = new options.window.AbortController();
    const root = options.root, signal = this.abort.signal;
    root.style.cssText = 'display:grid;gap:10px;max-width:100%;font:inherit'; root.setAttribute('data-rr-transfer-panel', '');
    root.replaceChildren(element(this.document, 'h3', {}, 'Backup and restore'), element(this.document, 'p', {},
      'This backup and restore interface currently uses English labels. Export includes relationship metadata, types and rules.'));
    this.librarySelect = transferSelect({ document: this.document, parent: root, label: 'Target / export library', attribute: 'data-rr-transfer-library',
      choices: [], signal, change: () => { if (this.librarySelect.value !== this.library) this.load(this.librarySelect.value).catch(error => this.fail(error)); } });
    this.targetLabel = element(this.document, 'p'); this.sourceLabel = element(this.document, 'p');
    this.message = element(this.document, 'p', { role: 'status' }); this.error = element(this.document, 'p', { role: 'alert' });
    root.append(this.targetLabel, this.sourceLabel, this.message);
    this.operation = transferSelect({ document: this.document, parent: root, label: 'Import operation', attribute: 'data-rr-transfer-operation',
      choices: [['merge', 'Merge explicit authority'], ['replace', 'Replace with reviewed authority']], signal,
      change: () => { if (this.operation.value !== this.#operationValue) { this.#operationValue = this.operation.value; this.invalidate('Operation changed. Preview again.'); } } });
    this.buttons = {};
    for (const [name, label, run] of [
      ['export', 'Export to new file', () => this.run(current => exportTransfer(this, current))],
      ['import', 'Choose import file', () => this.run(current => openTransfer(this, current))],
      ['preview', 'Preview import', () => this.run(current => previewTransfer(this, current))],
      ['backup', 'Backup current graph to new file', () => this.run(current => backupTransfer(this, current))],
      ['commit', 'Commit reviewed import', () => this.run(current => commitTransfer(this, current), true)],
      ['cancel', 'Cancel import / pending view', () => this.cancel()],
    ] as const) {
      const control = transferButton(this.document, label, name, run, signal); this.buttons[name] = control; root.append(control);
    }
    this.draftBody = element(this.document, 'div'); this.reviewBody = element(this.document, 'div');
    root.append(this.draftBody, this.reviewBody, this.error); this.refresh();
  }

  /** Check generation and native connectivity after every awaited external or service operation. @param {number} generation Captured view generation. @returns {boolean} Whether this response still belongs to the mounted view. */
  current(generation: number): boolean { return !this.disposed && this.generation === generation && this.options.root.isConnected; }

  /** Refresh actual available library names, selected owner and current permissions without guessing a replacement selection. @returns {boolean} Whether the selected native library exists. */
  availability(): boolean {
    const owner = libraryChoices({ Zotero: this.options.Zotero, gateway: this.options.gateway, document: this.document,
      select: this.librarySelect, selected: this.library, t: key => key === 'unavailable' ? 'Unavailable' : key });
    this.editable = !!owner && owner.editable && !owner.archived;
    this.owner = owner ? this.options.identity.read(this.library) : null;
    this.targetLabel.textContent = this.owner ? `Explicit target: ${owner!.name} · ${this.library} · ${this.owner.kind}:${this.owner.id}${this.editable ? '' : ' · read-only'}`
      : `Explicit target: ${this.library} · unavailable`;
    this.mapping?.setWritable(this.editable); return !!owner;
  }

  /** Derive all action gates from actual authority, permission, busy state and exact inspected token. @returns {void} */
  refresh(): void {
    if (this.disposed) return;
    const usable = !this.busy && this.owner !== null, writable = usable && this.editable && ['ready', 'uninitialized'].includes(this.authority);
    this.buttons.export.disabled = !usable || this.authority !== 'ready'; this.buttons.import.disabled = !writable;
    this.buttons.preview.disabled = !writable || !this.input || !this.mapping?.complete;
    this.buttons.backup.disabled = !writable || !this.token || !this.inspection?.before;
    this.buttons.commit.disabled = !writable || !this.token || !this.inspection
      || (this.inspection.operation === 'replace' && this.inspection.before !== null && this.inspection.backup === null);
    this.buttons.cancel.disabled = this.committing || (!this.busy && !this.input && !this.token);
    this.librarySelect.disabled = this.committing;
    this.operation.disabled = this.committing || !this.input || !this.editable;
    this.mapping?.setWritable(this.editable && !this.committing);
    this.options.root.setAttribute('aria-busy', String(this.busy || this.authority === 'loading'));
    this.options.root.dataset.rrTransferState = this.authority;
  }

  /** Report an original error in the active native view while retaining import files and draft values. @param {unknown} error Original rejection. @returns {void} */
  fail(error: unknown): void {
    this.options.report(error);
    if (this.disposed || !this.options.root.isConnected) return;
    this.error.textContent = transferError(error); this.refresh();
  }

  /** Retire canceled reviews immediately, including while a native picker or backup operation is pending. @returns {void} */
  flushRetired(): void {
    for (const token of this.retired) {
      this.retired.delete(token);
      try { this.options.transfer.cancelImport(token); } catch (error) { this.options.report(error); }
    }
  }

  /** Invalidate a captured token and its review while preserving exact input/mapping drafts. @param {string} reason Visible review invalidation. @returns {void} */
  invalidate(reason: string): void {
    this.generation++; this.clearReview(); this.message.textContent = reason; this.flushRetired(); this.refresh();
  }

  /** Retire an old review before a new preview without replacing its captured action generation. @returns {void} */
  clearReview(): void {
    if (this.token) this.retired.add(this.token); this.token = null; this.inspection = null;
    this.#reviewAbort?.abort(); this.#review?.dispose(); this.#review = null; this.reviewBody.replaceChildren();
  }

  /** Discard only an explicitly canceled or changed-library draft; preserve the actual input file. @returns {void} */
  clearDraft(): void {
    this.mapping?.dispose(); this.mapping = null; this.input = null; this.inputPath = null; this.sourceLabel.textContent = '';
    this.draftBody.replaceChildren(); this.refresh();
  }

  /** Cancel pending preparation and its exact service review before confirmed publication; never claim to undo a running commit. @returns {void} */
  cancel(): void { if (this.disposed || this.committing) return; this.invalidate('Import canceled.'); this.clearDraft(); }

  /** Run one click synchronously guarded against repetition; ignore stale async responses and report active failures. @param {Function} action Actual awaited work with a connected-generation predicate. @param {boolean} invalidateOnError Commit failure requires fresh preview. @returns {void} */
  run(action: (current: () => boolean) => Promise<void>, invalidateOnError = false): void {
    if (this.busy || this.disposed || !this.options.root.isConnected) return;
    this.busy = true; this.committing = invalidateOnError; this.error.textContent = ''; const generation = this.generation;
    if (this.committing) this.message.textContent = 'Committing the reviewed import. Please wait for the result.';
    this.refresh();
    action(() => this.current(generation)).catch(error => {
      if (this.current(generation)) { if (invalidateOnError) this.invalidate('Import failed. Review again; the input and mapping are retained.'); this.fail(error); }
      else this.options.report(error);
    }).finally(() => { this.busy = false; this.committing = false; this.flushRetired(); this.refresh(); });
  }

  /** Load exact selected native authority; uninitialized remains null and no catalog is seeded. @param {string} library Explicit personal or group scope. @returns {Promise<void>} Native read and permission refresh complete. */
  async load(library: string): Promise<void> {
    if (this.disposed) return;
    const scope = validateItemRef({ library, key: 'AAAAAAAA' }).library;
    this.invalidate(''); this.clearDraft(); this.library = scope; this.authority = 'loading'; this.error.textContent = '';
    const generation = this.generation; this.revision = null;
    try {
      if (!this.availability()) { this.authority = 'unavailable'; this.message.textContent = 'Selected library is unavailable.'; this.refresh(); return; }
      this.refresh();
      const state = await this.options.app.read(scope);
      if (!this.current(generation)) return;
      if (!this.availability()) { this.authority = 'unavailable'; this.refresh(); return; }
      this.authority = state.state; this.revision = state.state === 'ready' ? state.head : null;
      this.message.textContent = state.state === 'uninitialized' ? 'Uninitialized authority. Import will create its first graph.'
        : state.state === 'ready' ? (this.editable ? 'Ready for export or explicit import.' : 'Read-only library: export is available.')
          : `Authority is ${state.state}. Import and export require complete authority.`;
    } catch (error) { if (this.current(generation)) { this.authority = 'error'; this.fail(error); } else this.options.report(error); }
    this.refresh();
  }

  /** Install one verified source document and an explicit complete endpoint editor, never mutating either after preview. @param {object} input Validated envelope. @param {string} path Actual native input path. @returns {void} */
  draft(input: ExportEnvelope, path: string): void {
    check(this.owner !== null && this.editable, 'Selected target is unavailable or read-only', 'permission');
    this.mapping?.dispose(); this.input = input; this.inputPath = path;
    this.sourceLabel.textContent = `Source file: ${path} · ${input.source.kind}:${input.source.id} · ${input.snapshot.library} · ${input.exportedAt} · SHA-256 ${input.hash}`;
    this.operation.value = 'merge'; this.#operationValue = 'merge';
    this.mapping = new TransferMappingEditor({ window: this.options.window, parent: this.draftBody, document: input,
      target: this.owner, library: this.library, change: () => this.invalidate('Endpoint mapping changed. Preview again.'),
      Zotero: this.options.Zotero, gateway: this.options.gateway, report: this.options.report });
    this.message.textContent = 'Choose merge or replace, then review every endpoint decision.'; this.refresh();
  }

  /** Render only detached full captured service evidence, using a fresh owned review lifetime. @param {object} inspection Exact inspectImport DTO. @returns {void} */
  showReview(inspection: ImportInspection): void {
    this.#reviewAbort?.abort(); this.#review?.dispose(); this.#reviewAbort = new this.options.window.AbortController();
    this.inspection = inspection; this.#review = transferReview({ window: this.options.window, parent: this.reviewBody,
      inspection, signal: this.#reviewAbort.signal });
    this.message.textContent = inspection.noop ? 'No changes: the reviewed merge will preserve the current generation.'
      : inspection.operation === 'replace' && inspection.before !== null && inspection.backup === null
        ? 'Replacement requires a verified backup of this captured before graph before commit.' : 'Review prepared. Commit only this exact reviewed import.';
    this.refresh();
  }

  /** Invalidate native-sensitive review while retaining draft source/mapping; observe fresh authority and actual permissions. @returns {void} */
  nativeChange(): void {
    if (this.disposed) return;
    if (!this.input && !this.busy) { this.load(this.library).catch(error => this.fail(error)); return; }
    this.invalidate('Native library or endpoints changed. Draft retained; preview again.'); const generation = this.generation;
    this.authority = 'loading';
    try {
      if (!this.availability()) { this.authority = 'unavailable'; this.refresh(); return; }
    } catch (error) { this.authority = 'error'; this.fail(error); return; }
    this.refresh(); this.options.app.invalidate(this.library);
    this.options.app.read(this.library).then(state => {
      if (!this.current(generation)) return;
      this.authority = state.state; this.revision = state.state === 'ready' ? state.head : null; this.availability(); this.refresh();
    }).catch(error => { if (this.current(generation)) { this.authority = 'error'; this.fail(error); } else this.options.report(error); });
  }

  /** Cancel pending views, retire owned reviews and abort every page/listener without deleting input/output files. @returns {void} */
  dispose(): void {
    if (this.disposed) return;
    this.invalidate(''); this.clearDraft(); this.disposed = true; this.generation++; this.abort.abort();
    this.options.root.dataset.rrTransferState = 'disposed'; this.options.root.setAttribute('aria-busy', 'false'); this.options.root.replaceChildren();
  }
}
