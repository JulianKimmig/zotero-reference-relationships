/** Item-pane rendering with revision-aware actions and per-selection asynchronous cancellation. */
import { element, button, metadataText } from './dom.mts';
import { RelationshipEditor } from './editor.mts';
import { CatalogEditor } from './catalog-editor.mts';
import { check, ContractError } from '../domain/values.mts';
import { errorMessage } from '../domain/failures.mts';
import { ruleLabels } from './rule-controls.mts';
import { provenance, describeContributors } from './provenance.mts';
import { RepairPanel } from './repair-panel.mts';
import { BulkRemovalEditor } from './bulk-removal.mts';
import type { ItemRef } from '../domain/contracts.mts';
import type { Relationship } from '../domain/projection-contracts.mts';
import type { EndpointDescription, SelectionContext } from '../application/contracts.mts';
import type { NativeDocument, NativeItem } from '../adapters/native-contracts.mts';
import type { Localizer, ViewOptions } from './contracts.mts';

/** A repair action may identify a physical original before an effective edge key exists. */
export type EditableEdge = Omit<Relationship, 'key'> & { key?: string };

/** Own one native section's DOM and selection generation. */
export class RelationshipView {
  declare body: ViewOptions['body']; declare window: ViewOptions['window']; declare Zotero: ViewOptions['Zotero'];
  declare app: ViewOptions['app']; declare gateway: ViewOptions['gateway']; declare dialogs: ViewOptions['dialogs'];
  declare refresh: ViewOptions['refresh']; declare report: ViewOptions['report']; declare openRules: ViewOptions['openRules'];
  document: NativeDocument; generation: number; disposed: boolean; offset: number; needsShell: boolean;
  editor: RelationshipEditor | CatalogEditor | RepairPanel | BulkRemovalEditor | null;
  rendering: { generation: number; promise: Promise<void>; identity: string } | null;
  item?: NativeItem | null; context: SelectionContext | null = null;
  declare ref: ItemRef; declare t: Localizer; declare root: HTMLDivElement; declare list: HTMLDivElement; declare abort: AbortController;
  /** Bind actual section and shared application resources. @param {object} options {body,window,Zotero,app,gateway,dialogs,refresh,report,openRules}. */
  constructor(options: ViewOptions) {
    Object.assign(this, options); this.document = this.body.ownerDocument as NativeDocument;
    this.generation = 0; this.disposed = false; this.editor = null; this.offset = 0;
    this.needsShell = true; this.rendering = null;
  }

  /** Record native render scheduling without metadata or titles. @param {string} event Lifecycle point. @param {number} generation Captured token. @returns {void} */
  trace(event: string, generation: number = this.generation) {
    this.Zotero.debug(`ReferenceRelationships view ${JSON.stringify({ event, generation, current: this.generation, key: this.item?.key })}`);
  }

  /** Invalidate outstanding work without rendering in the native item-change hook. @param {object|null} item Actual selected reference. @returns {void} */
  select(item: NativeItem | null): void {
    const same = this.item?.libraryID === item?.libraryID && this.item?.key === item?.key;
    this.item = item;
    this.trace(same ? 'select-same' : 'select-new');
    if (same) return;
    this.generation++; this.needsShell = true; this.offset = 0; this.context = null;
    if (this.editor) { this.editor.dispose(); this.editor = null; }
  }

  /** Establish the synchronous shell before native asynchronous rendering. @returns {void} */
  skeleton() {
    if (!this.needsShell || !this.item || this.disposed) return;
    this.needsShell = false;
    this.trace('shell');
    if (this.abort) this.abort.abort();
    if (this.editor) { this.editor.dispose(); this.editor = null; }
    this.abort = new this.window.AbortController();
    if (!this.root) {
      this.root = element(this.document, 'div', { 'data-rr-pane': '' });
      this.root.style.cssText = 'display:grid;gap:8px;padding:8px;font:inherit'; this.body.append(this.root);
    }
    this.ref = this.gateway.ref(this.item);
    this.root.dataset.rrItemKey = this.ref.key; this.root.dataset.rrState = 'loading';
    this.root.setAttribute('aria-busy', 'true');
    this.root.replaceChildren(element(this.document, 'p', { role: 'status' }, 'Loading relationships…'));
    this.ensureAsyncRender();
  }

  /** Repair native A→B→A async dependency reuse after an intermediate synchronous shell, using the registered refresh callback. @returns {void} */
  ensureAsyncRender() {
    const generation = this.generation, identity = JSON.stringify(this.ref);
    if (this.rendering?.identity !== identity || this.rendering.generation === generation) return;
    this.run(async () => {
      if (this.current(generation) && this.rendering?.generation !== generation) {
        this.trace('refresh-return-selection'); await this.refresh();
      }
    });
  }

  /** Test that an async result still belongs to the selected connected section. @param {number} generation Captured token. @returns {boolean} Whether it may render. */
  current(generation: number) { return !this.disposed && this.root?.isConnected && generation === this.generation; }

  /** Execute an actual UI action and surface errors without writing another item's view. @param {Function} action Async work. @returns {void} */
  run(action: () => unknown): void {
    const generation = this.generation;
    Promise.resolve().then(action).catch(error => {
      this.report(error);
      if (this.current(generation)) {
        this.root.dataset.rrState = 'error';
        this.root.append(element(this.document, 'p', { role: 'alert' }, error.message));
      }
    });
  }

  /** Render only the captured selection after actual application reads complete. @returns {Promise<void>} */
  render() {
    this.skeleton();
    this.trace('render');
    if (this.rendering?.generation === this.generation) return this.rendering.promise;
    const generation = this.generation;
    const promise = this.renderSelection(generation, this.ref);
    this.rendering = { generation, promise, identity: JSON.stringify(this.ref) };
    return promise;
  }

  /** Read and publish one semantic selection generation. @param {number} generation Token. @param {object} ref Captured native item reference. @returns {Promise<void>} Finished or discarded render. */
  async renderSelection(generation: number, ref: ItemRef): Promise<void> {
    this.trace('read-start', generation);
    try {
      const context = await this.app.context(ref);
      const t = await ruleLabels(this.document);
      if (!this.current(generation)) return;
      this.context = context; this.t = t;
      let result = null;
      if (context.state === 'ready') result = await this.app.listRelationships(ref, 'both', null, { offset: this.offset, limit: 25 });
      const rows = result ? await Promise.all(result.relationships.map(async edge => {
        const outgoing = edge.source.key === ref.key;
        const other = await this.app.describe(outgoing ? edge.target : edge.source);
        return { edge, outgoing, other };
      })) : [];
      if (!this.current(generation)) { this.trace('discard', generation); return; }
      this.trace('publish', generation);
      this.context = context; this.t = t; this.root.dataset.rrState = context.state; this.root.setAttribute('aria-busy', 'false'); this.root.replaceChildren();
      const add = button(this.document, 'Add relationship…', 'add', () => this.run(() => this.openEditor('create', null)), this.abort.signal);
      add.disabled = !context.editable || !['ready', 'uninitialized'].includes(context.state) || context.types.every(type => type.retired);
      this.root.append(add);
      const manage = button(this.document, 'Manage types…', 'manage-types', () => this.run(() => this.openCatalog()), this.abort.signal);
      manage.disabled = !context.editable || !['ready', 'uninitialized'].includes(context.state);
      this.root.append(manage);
      this.root.append(button(this.document, t('manage'), 'manage-rules', () => this.run(() => this.openRules(ref.library)), this.abort.signal));
      if (result?.diagnostics.length) this.appendRepairsAction();
      if (context.state === 'uninitialized') this.root.append(element(this.document, 'p', {}, 'No relationships yet. Saving your first relationship starts this library.'));
      else if (context.state !== 'ready') this.root.append(element(this.document, 'p', { role: 'alert' }, `Relationship data is ${context.state}. Resolve this before making changes.`));
      if (!context.editable) this.root.append(element(this.document, 'p', {}, 'This reference or library is read-only.'));
      if (context.state === 'ready' && rows.length === 0) this.root.append(element(this.document, 'p', {}, 'No relationships for this reference.'));
      this.list = element(this.document, 'div', { 'aria-label': 'Relationships' });
      for (const row of rows) this.appendRow(row);
      this.root.append(this.list);
      if (result && (this.offset > 0 || result.nextOffset !== null)) {
        const paging = element(this.document, 'div');
        if (this.offset > 0) paging.append(button(this.document, 'Previous', 'previous', () => this.changePage(Math.max(0, this.offset - 25)), this.abort.signal));
        if (result.nextOffset !== null) paging.append(button(this.document, 'Next', 'next', () => this.changePage(result.nextOffset!), this.abort.signal));
        this.root.append(paging);
      }
    } catch (error) {
      this.report(error);
      if (this.current(generation)) {
        this.root.dataset.rrState = error instanceof ContractError && error.code === 'conflict' && this.context?.state === 'ready' ? 'conflict' : 'error';
        this.root.setAttribute('aria-busy', 'false');
        this.root.replaceChildren(element(this.document, 'p', { role: 'alert' }, errorMessage(error)));
        if (this.context?.state === 'ready') this.appendRepairsAction();
      }
    }
  }

  /** Render literal effective metadata, contributor origin and safe native actions. @param {object} row {edge,outgoing,other}. @returns {void} */
  appendRow({ edge, outgoing, other }: { edge: Relationship; outgoing: boolean; other: EndpointDescription }): void {
    const type = this.context!.types.find(type => type.id === edge.type)!;
    const row = element(this.document, 'section', { 'data-rr-relation': edge.key });
    const manual = edge.assertions.length > 0, generated = edge.supports.length > 0;
    row.dataset.rrOrigin = manual ? generated ? 'both' : 'manual' : 'generated';
    row.style.cssText = 'padding-block:8px;border-block-end:1px solid color-mix(in srgb,currentColor 20%,transparent)';
    row.append(element(this.document, 'p', {}, `${outgoing ? 'Outgoing' : 'Incoming'} · ${type.label} · ${manual ? generated ? 'Manual + generated' : 'Manual' : 'Generated'}`));
    const navigate = button(this.document, other.title, 'navigate', () => this.run(() => this.gateway.navigate(this.window, other.ref)), this.abort.signal);
    navigate.disabled = other.status !== 'active'; row.append(navigate);
    const text = metadataText(edge.metadata, type); if (text) row.append(element(this.document, 'p', {}, text));
    if (generated) row.append(element(this.document, 'p', {}, `${edge.supports.length} rule support${edge.supports.length === 1 ? '' : 's'}. Generated values follow their explicit roots and rules.`));
    if (generated) row.append(button(this.document, this.t('explain'), 'explain', () => this.run(() => this.explain(row, edge)), this.abort.signal));
    if (edge.assertions.length > 1) row.append(button(this.document, this.t('choose-contribution'), 'choose-contribution',
      () => this.openRepairs(edge.assertions), this.abort.signal));
    for (const [mode, label, action] of edge.assertions.length === 1 ? [['edit', 'Edit', 'edit'], ['remove', 'Remove', 'remove']] as const : []) {
      const control = button(this.document, label, action, () => this.run(() => this.openEditor(mode, edge)), this.abort.signal);
      control.disabled = !this.context!.editable; row.append(control);
    }
    this.list.append(row);
  }

  /** Expose original retained roots when native projection has issues or conflicts. @returns {void} */
  appendRepairsAction() {
    this.root.append(button(this.document, this.t('repair'), 'manage-repairs', () => this.openRepairs(null), this.abort.signal));
  }

  /** Open an explicit original-root subset or library-wide repair inspection without writes. @param {string[]|null} ids Original IDs or all. @returns {void} */
  openRepairs(ids: string[]|null) {
    if (this.editor) this.editor.dispose();
    const editor = new RepairPanel(this, ids); this.editor = editor; this.root.append(editor.root); editor.run(() => editor.load());
  }

  /** Open one atomic preview for explicitly selected original removals. @param {string[]} ids Selected original assertion IDs. @returns {void} */
  openRemoval(ids: string[]) {
    check(this.context?.editable && ids.length > 0, 'Choose editable original relationships', 'permission');
    if (this.editor) this.editor.dispose();
    this.editor = new BulkRemovalEditor(this, ids); this.root.append(this.editor.root);
  }

  /** Explain actual current roots and rule versions, discarding responses after native selection/revision changes. @param {Element} row Owned relationship row. @param {object} edge Effective relationship. @returns {Promise<void>} */
  async explain(row: HTMLElement, edge: Relationship): Promise<void> {
    const existing = row.querySelector('[data-rr-provenance]'); if (existing) { existing.remove(); return; }
    const generation = this.generation, state = await this.app.read(this.ref.library);
    check(state.state === 'ready' && state.head === this.context?.revision, 'Relationship data changed; refresh before explaining', 'conflict');
    const descriptions = await describeContributors(this.app, [edge], [state.snapshot]);
    if (!this.current(generation) || !row.isConnected) return;
    const details = element(this.document, 'section', { 'data-rr-provenance': '' });
    provenance({ document: this.document, parent: details, edge, snapshot: state.snapshot, descriptions, t: this.t, signal: this.abort.signal });
    row.append(details);
  }

  /** Resolve one explicitly selected original contribution before opening a draft. @param {string} mode create/edit/remove. @param {object|null} edge Effective/inspection edge or creation. @param {string|null} originalID Explicit contributor ID when multiple roots share a triple. @returns {Promise<void>} Editor opened or stale result ignored. */
  async openEditor(mode: 'create' | 'edit' | 'remove', edge: EditableEdge | null, originalID: string|null = null): Promise<void> {
    const generation = this.generation;
    if (edge) {
      const state = await this.app.read(this.ref.library);
      if (!this.current(generation)) return;
      check(state.state === 'ready', 'Refresh relationship authority before editing', 'conflict');
      check(state.head === this.context?.revision, 'Relationship data changed; refresh before editing', 'conflict');
      check(originalID !== null || edge.assertions.length === 1, 'Choose one original relationship contribution');
      const id = originalID === null ? edge.assertions[0] : originalID;
      check(edge.assertions.includes(id), 'Original contribution is not part of this relationship');
      const assertion = state.snapshot.assertions.find(value => value.id === id);
      check(!!assertion, 'This manual relationship is no longer available', 'conflict');
      edge = { ...edge, source: assertion.source, target: assertion.target, type: assertion.type,
        metadata: assertion.metadata, assertions: [assertion.id] };
      if (!this.current(generation)) return;
    }
    if (this.editor) this.editor.dispose();
    this.editor = new RelationshipEditor({ view: this, mode, edge }); this.root.append(this.editor.root);
  }

  /** Open a selected-library catalog draft without persisting proposed seed data. @returns {void} */
  openCatalog() {
    if (this.editor) this.editor.dispose();
    this.editor = new CatalogEditor(this); this.root.append(this.editor.root);
  }

  /** Cancel or complete editing, then refresh via the supported section callback. @returns {void} */
  finishEditor() {
    if (this.editor) this.editor.dispose(); this.editor = null;
    this.requestRefresh();
  }

  /** Invalidate semantic view data before asking native hooks to redraw. @returns {void} */
  requestRefresh() {
    this.generation++; this.needsShell = true;
    if (this.root) { this.root.dataset.rrState = 'loading'; this.root.setAttribute('aria-busy', 'true'); }
    this.run(() => this.refresh());
  }

  /** Request a stable page without a direct storage scan. @param {number} offset Valid next offset. @returns {void} */
  changePage(offset: number) { this.offset = offset; this.requestRefresh(); }

  /** Preserve an active draft but invalidate its review on native changes. @returns {void} */
  nativeChange() { if (this.editor) this.editor.invalidate(); else this.requestRefresh(); }

  /** Release the owned DOM and listeners; late results are ignored by generation. @returns {void} */
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.generation++;
    if (this.abort) this.abort.abort(); if (this.editor) this.editor.dispose();
    if (this.root) this.root.remove();
    this.item = null;
  }
}
