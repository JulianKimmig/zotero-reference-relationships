/** Item-pane rendering with revision-aware actions and per-selection asynchronous cancellation. */
import { element, button, metadataText } from './dom.mjs';
import { RelationshipEditor } from './editor.mjs';
import { CatalogEditor } from './catalog-editor.mjs';

/** Own one native section's DOM and selection generation. */
export class RelationshipView {
  /** Bind actual section and shared application resources. @param {object} options {body,window,Zotero,app,gateway,dialogs,refresh,report}. */
  constructor(options) {
    Object.assign(this, options); this.document = this.body.ownerDocument;
    this.generation = 0; this.disposed = false; this.editor = null; this.offset = 0;
    this.needsShell = true; this.rendering = null;
  }

  /** Record native render scheduling without metadata or titles. @param {string} event Lifecycle point. @param {number} generation Captured token. @returns {void} */
  trace(event, generation = this.generation) {
    this.Zotero.debug(`ReferenceRelationships view ${JSON.stringify({ event, generation, current: this.generation, key: this.item?.key })}`);
  }

  /** Invalidate outstanding work without rendering in the native item-change hook. @param {object|null} item Actual selected reference. @returns {void} */
  select(item) {
    const same = this.item?.libraryID === item?.libraryID && this.item?.key === item?.key;
    this.item = item;
    this.trace(same ? 'select-same' : 'select-new');
    if (same) return;
    this.generation++; this.needsShell = true; this.offset = 0;
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
  current(generation) { return !this.disposed && this.root?.isConnected && generation === this.generation; }

  /** Execute an actual UI action and surface errors without writing another item's view. @param {Function} action Async work. @returns {void} */
  run(action) {
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
  async renderSelection(generation, ref) {
    this.trace('read-start', generation);
    try {
      const context = await this.app.context(ref);
      let result = null;
      if (context.state === 'ready') result = await this.app.listRelationships(ref, 'both', null, { offset: this.offset, limit: 25 });
      const rows = result ? await Promise.all(result.relationships.map(async edge => {
        const outgoing = edge.source.key === ref.key;
        const other = await this.app.describe(outgoing ? edge.target : edge.source);
        return { edge, outgoing, other };
      })) : [];
      if (!this.current(generation)) { this.trace('discard', generation); return; }
      this.trace('publish', generation);
      this.context = context; this.root.dataset.rrState = context.state; this.root.setAttribute('aria-busy', 'false'); this.root.replaceChildren();
      const add = button(this.document, 'Add relationship…', 'add', () => this.run(() => this.openEditor('create', null)), this.abort.signal);
      add.disabled = !context.editable || !['ready', 'uninitialized'].includes(context.state) || context.types.every(type => type.retired);
      this.root.append(add);
      const manage = button(this.document, 'Manage types…', 'manage-types', () => this.run(() => this.openCatalog()), this.abort.signal);
      manage.disabled = !context.editable || !['ready', 'uninitialized'].includes(context.state);
      this.root.append(manage);
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
        if (result.nextOffset !== null) paging.append(button(this.document, 'Next', 'next', () => this.changePage(result.nextOffset), this.abort.signal));
        this.root.append(paging);
      }
    } catch (error) {
      this.report(error);
      if (this.current(generation)) {
        this.root.dataset.rrState = 'error';
        this.root.setAttribute('aria-busy', 'false');
        this.root.replaceChildren(element(this.document, 'p', { role: 'alert' }, error.message));
      }
    }
  }

  /** Render one literal manual relationship, direction and safe native navigation. @param {object} row {edge,outgoing,other}. @returns {void} */
  appendRow({ edge, outgoing, other }) {
    const type = this.context.types.find(type => type.id === edge.type);
    const row = element(this.document, 'section', { 'data-rr-relation': edge.key });
    row.style.cssText = 'padding-block:8px;border-block-end:1px solid color-mix(in srgb,currentColor 20%,transparent)';
    row.append(element(this.document, 'p', {}, `${outgoing ? 'Outgoing' : 'Incoming'} · ${type.label} · Manual`));
    const navigate = button(this.document, other.title, 'navigate', () => this.run(() => this.gateway.navigate(this.window, other.ref)), this.abort.signal);
    navigate.disabled = other.status !== 'active'; row.append(navigate);
    const text = metadataText(edge.metadata, type); if (text) row.append(element(this.document, 'p', {}, text));
    for (const [mode, label, action] of [['edit', 'Edit', 'edit'], ['remove', 'Remove', 'remove']]) {
      const control = button(this.document, label, action, () => this.run(() => this.openEditor(mode, edge)), this.abort.signal);
      control.disabled = !this.context.editable; row.append(control);
    }
    this.list.append(row);
  }

  /** Open an explicit draft without writing authority. @param {string} mode create/edit/remove. @param {object|null} edge Manual edge. @returns {void} */
  openEditor(mode, edge) {
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
  changePage(offset) { this.offset = offset; this.requestRefresh(); }

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
