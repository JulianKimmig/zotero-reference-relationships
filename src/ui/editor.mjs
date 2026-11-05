/** Preview-first explicit relationship editor; cancellation never invokes a write command. */
import { element, button, metadataText } from './dom.mjs';
import { metadataFields } from './metadata-fields.mjs';
import { chooseReference } from '../adapters/picker.mjs';
import { check } from '../domain/values.mjs';
import { projectionReview } from './projection-review.mjs';

/** Own one actual editor and all its listeners beneath an item-pane view. */
export class RelationshipEditor {
  /** Bind actual view/context and render this owned editor. @param {object} options {view,mode,edge|null}. */
  constructor({ view, mode, edge }) {
    this.view = view; this.mode = mode; this.edge = edge;
    this.source = edge ? edge.source : view.ref; this.target = edge ? edge.target : null;
    this.baseRevision = view.context.revision;
    this.review = null; this.disposed = false; this.reviewGeneration = 0; this.activePreview = null;
    this.abort = new view.window.AbortController();
    this.root = element(view.document, 'section', { 'data-rr-editor': mode, 'aria-label': 'Relationship editor' });
    this.error = element(view.document, 'p', { role: 'alert' });
    this.details = element(view.document, 'div', { 'aria-live': 'polite' });
    this.render();
  }

  /** Run an explicit action while keeping its errors visible and reporting unexpected stale failures. @param {Function} action Async action. @returns {void} */
  run(action) {
    Promise.resolve().then(action).catch(error => {
      this.view.report(error);
      if (!this.disposed) { this.error.textContent = error.message; this.invalidate(); }
    });
  }

  /** Remove stale review when values or native state change. @returns {void} */
  invalidate() {
    this.reviewGeneration++; this.review = null;
    if (this.conflictImpact) this.conflictImpact.dispose(); this.conflictImpact = null;
    if (this.save) this.save.disabled = true;
    if (this.details) this.details.replaceChildren();
  }

  /** Build controls using only owned nodes and schema metadata. @returns {void} */
  render() {
    const { document, context } = this.view, signal = this.abort.signal;
    this.root.append(element(document, 'h4', {}, this.mode === 'remove' ? 'Remove relationship' : this.mode === 'edit' ? 'Edit relationship' : 'Add relationship'));
    this.sourceLabel = element(document, 'span', { 'data-rr-source-key': this.source.key }, this.source.key);
    this.root.append(this.sourceLabel);
    this.run(async () => {
      const value = await this.view.app.describe(this.source);
      if (!this.disposed) this.sourceLabel.textContent = `${value.title} [${value.ref.key}]`;
    });
    if (this.mode === 'edit') this.root.append(button(document, 'Choose source…', 'choose-source', () => this.run(() => this.pick('source')), signal));
    const targetLabel = element(document, 'span', { 'data-rr-target-key': this.target ? this.target.key : '' }, 'Choose a target reference');
    this.targetLabel = targetLabel;
    if (this.target) this.run(async () => { const value = await this.view.app.describe(this.target); if (!this.disposed) targetLabel.textContent = value.title; });
    this.root.append(targetLabel);
    if (this.mode !== 'remove') {
      this.root.append(button(document, 'Choose target…', 'choose-target', () => this.run(() => this.pick('target')), signal));
      this.type = element(document, 'select', { 'aria-label': 'Relationship type', 'data-rr-type': '' });
      for (const type of context.types.filter(type => !type.retired || type.id === this.edge?.type)) {
        this.type.append(element(document, 'option', { value: type.id }, type.label));
      }
      if (this.edge) this.type.value = this.edge.type;
      this.root.append(element(document, 'label', {}, 'Relationship type'), this.type);
      this.fields = element(document, 'div'); this.root.append(this.fields);
      this.renderFields();
      this.type.addEventListener('change', () => { this.invalidate(); this.renderFields(); }, { signal });
      this.root.append(button(document, 'Preview', 'preview', () => this.run(() => this.preview()), signal));
    }
    this.save = button(document, this.mode === 'remove' ? 'Confirm removal' : 'Save relationship', 'save', () => this.run(() => this.apply()), signal);
    this.save.disabled = true;
    this.root.append(this.details, this.error, this.save,
      button(document, 'Cancel', 'cancel', () => this.view.finishEditor(), signal));
    if (this.mode === 'remove') this.run(() => this.preview());
  }

  /** Rebuild typed fields for the selected type, preserving compatible visible values for review. @returns {void} */
  renderFields() {
    if (this.fieldAbort) this.fieldAbort.abort();
    this.fieldAbort = new this.view.window.AbortController();
    const metadata = this.readMetadata ? this.readMetadata() : this.edge ? this.edge.metadata : {};
    this.fields.replaceChildren();
    const type = this.view.context.types.find(type => type.id === this.type.value);
    this.readMetadata = metadataFields({ document: this.view.document, parent: this.fields, type, metadata,
      signal: this.fieldAbort.signal, onChange: () => this.invalidate() });
  }

  /** Explicitly replace one endpoint through the actual native single-reference picker. @param {string} endpoint Source or target. @returns {Promise<void>} */
  async pick(endpoint) {
    check(['source', 'target'].includes(endpoint), 'Unknown endpoint picker');
    const { Zotero, gateway, window, dialogs } = this.view;
    const anchor = endpoint === 'source' ? this.target ?? this.source : this.source;
    const selected = await chooseReference({ Zotero, gateway, window, source: anchor, dialogs });
    if (!selected || this.disposed) return;
    this[endpoint] = selected; this.invalidate();
    const value = await this.view.app.describe(selected);
    if (!this.disposed) {
      const label = endpoint === 'source' ? this.sourceLabel : this.targetLabel;
      label.setAttribute(`data-rr-${endpoint}-key`, selected.key); label.textContent = `${value.title} [${selected.key}]`;
    }
  }

  /** Recompute a detached command and a no-write review from current values. @returns {Promise<void>} */
  async preview() {
    this.invalidate(); this.error.textContent = '';
    const generation = this.reviewGeneration, pending = {};
    this.activePreview = pending; this.root.setAttribute('aria-busy', 'true');
    try {
    const { app } = this.view;
    let draft;
    if (this.mode === 'remove') draft = await app.draftRemove(this.edge.assertions[0], this.source.library);
    else {
      if (!this.target) throw new Error('Choose a target reference');
      const input = { source: this.source, target: this.target, type: this.type.value, metadata: this.readMetadata() };
      draft = this.mode === 'edit' ? await app.draftUpdate(this.edge.assertions[0], input, this.source.library) : await app.draftCreate(input);
    }
    check(draft.expectedRevision === this.baseRevision, 'Relationship data changed; cancel and reopen this editor', 'conflict');
    const review = await app.preview(draft.command, draft.expectedRevision);
    if (this.disposed || generation !== this.reviewGeneration) return;
    this.review = { ...draft, review };
    this.details.replaceChildren(element(this.view.document, 'p', {},
      `${review.changeSet.assertions.added.length} added · ${review.changeSet.assertions.updated.length} updated · ${review.changeSet.assertions.removed.length} removed`));
    for (const assertion of [...review.changeSet.assertions.added, ...review.changeSet.assertions.removed,
      ...review.changeSet.assertions.updated.flatMap(value => [value.before, value.after])]) {
      const type = this.view.context.types.find(type => type.id === assertion.type);
      this.details.append(element(this.view.document, 'p', {}, `${type.label} · ${metadataText(assertion.metadata, type)}`));
    }
    if (review.changeSet.derived === null) this.conflictImpact = projectionReview({ view: this.view, parent: this.details, review, signal: this.abort.signal });
    this.save.disabled = false;
    } finally {
      if (!this.disposed && this.activePreview === pending) {
        this.activePreview = null; this.root.setAttribute('aria-busy', 'false');
      }
    }
  }

  /** Apply only the reviewed command; the application repeats validation and commit-time eligibility. @returns {Promise<void>} */
  async apply() {
    if (!this.review || this.disposed) throw new Error('Preview this relationship before saving');
    const { review } = this.review;
    const controls = [...this.root.querySelectorAll('button,input,select,textarea')].map(control => [control, control.disabled]);
    for (const [control] of controls) control.disabled = true;
    this.root.setAttribute('aria-busy', 'true');
    try {
      await this.view.app.applyReviewed(review);
      if (!this.disposed) this.view.finishEditor();
    } finally {
      if (!this.disposed) {
        for (const [control, disabled] of controls) control.disabled = disabled;
        this.root.setAttribute('aria-busy', 'false');
      }
    }
  }

  /** Release every listener and owned DOM node; idempotent. @returns {void} */
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.abort.abort(); if (this.fieldAbort) this.fieldAbort.abort(); this.root.remove();
    if (this.conflictImpact) this.conflictImpact.dispose();
  }
}
