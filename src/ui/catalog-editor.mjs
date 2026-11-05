/** Preview-first custom relationship type editor with explicit metadata migrations. */
import { check } from '../domain/values.mjs';
import { validateType } from '../domain/metadata.mjs';
import { initialGraph } from '../application/seed.mjs';
import { element, button, metadataText } from './dom.mjs';
import { catalogForm } from './catalog-form.mjs';
import { migrationForms } from './catalog-migration.mjs';
import { projectionReview } from './projection-review.mjs';

/** Own one selected-library catalog draft and its native DOM listeners. */
export class CatalogEditor {
  /** Bind the actual section and its captured library/revision. @param {object} view RelationshipView. */
  constructor(view) {
    this.view = view; this.library = view.ref.library; this.baseRevision = view.context.revision;
    this.generation = 0; this.disposed = false; this.review = null;
    this.abort = new view.window.AbortController();
    this.root = element(view.document, 'section', { 'data-rr-catalog': '', 'aria-label': 'Manage relationship types' });
    this.root.style.cssText = 'display:grid;gap:8px';
    this.root.append(element(view.document, 'h4', {}, 'Manage relationship types'));
    this.menu = element(view.document, 'div'); this.root.append(this.menu);
    for (const type of view.context.types) {
      const edit = button(view.document, `${type.label} (${type.id})${type.retired ? ' · Retired' : ''}`, 'edit-type', () => this.edit(type), this.abort.signal);
      edit.dataset.rrTypeId = type.id; this.menu.append(edit);
    }
    this.menu.append(button(view.document, 'New relationship type', 'new-type', () => this.edit(null), this.abort.signal));
    this.formBody = element(view.document, 'div'); this.migrationBody = element(view.document, 'div');
    this.error = element(view.document, 'p', { role: 'alert' });
    this.details = element(view.document, 'div', { 'data-rr-type-review': '', 'aria-live': 'polite' });
    this.previewButton = button(view.document, 'Preview type change', 'preview-type', () => this.run(() => this.preview()), this.abort.signal);
    this.migrateButton = button(view.document, 'Review metadata migration…', 'review-migration', () => this.run(() => this.migrate()), this.abort.signal);
    this.save = button(view.document, 'Save type change', 'save-type', () => this.run(() => this.apply()), this.abort.signal);
    this.save.disabled = true; this.previewButton.disabled = true; this.migrateButton.disabled = true;
    this.root.append(this.formBody, this.migrateButton, this.migrationBody, this.previewButton, this.details, this.error, this.save,
      button(view.document, 'Cancel', 'cancel-catalog', () => view.finishEditor(), this.abort.signal));
  }

  /** Run an actual action while showing its failure without discarding draft values. @param {Function} action Async operation. @returns {void} */
  run(action) {
    Promise.resolve().then(action).catch(error => {
      this.view.report(error);
      if (!this.disposed) { this.invalidate(); this.error.textContent = error.message; }
    });
  }

  /** Invalidate a review on edits or native notifications while retaining current inputs. @returns {void} */
  invalidate() {
    this.generation++; this.review = null; this.save.disabled = true;
    if (this.conflictImpact) this.conflictImpact.dispose(); this.conflictImpact = null; this.details.replaceChildren();
  }

  /** Discard migration controls when their defining schema changes. @returns {void} */
  changed() {
    this.invalidate();
    if (this.migration) this.migration.dispose(); this.migration = null;
  }

  /** Select a current existing definition or a new stable identity. @param {object|null} type Current definition or new. @returns {void} */
  edit(type) {
    this.changed(); this.originalType = type; this.error.textContent = '';
    if (this.form) this.form.dispose();
    this.form = catalogForm({ document: this.view.document, window: this.view.window,
      parent: this.formBody, type, onChange: () => this.changed() });
    this.previewButton.disabled = false; this.migrateButton.disabled = !type;
  }

  /** Load the actual expected graph and render explicit before/after metadata forms without writes. @returns {Promise<void>} */
  async migrate() {
    this.changed(); this.error.textContent = '';
    const generation = this.generation;
    const type = validateType({ ...this.form.read(), version: 1 });
    const state = await this.view.app.read(this.library);
    check((state.state === 'ready' ? state.head : null) === this.baseRevision, 'Relationship data changed; close and reopen the catalog', 'conflict');
    check(['ready', 'uninitialized'].includes(state.state), 'Relationship authority is unavailable', 'conflict');
    if (this.disposed || generation !== this.generation) return;
    const before = state.state === 'ready' ? state.snapshot : initialGraph(this.library);
    this.migration = migrationForms({ document: this.view.document, window: this.view.window,
      parent: this.migrationBody, before, type, onChange: () => this.invalidate() });
  }

  /** Validate the detached schema and explicit replacements, and review the exact current-head delta. @returns {Promise<void>} */
  async preview() {
    this.invalidate(); this.error.textContent = '';
    const generation = this.generation, pending = {}; this.pending = pending;
    this.root.setAttribute('aria-busy', 'true');
    try {
      const input = { library: this.library, kind: this.originalType ? 'update' : 'create',
        type: this.form.read(), migration: this.migration ? this.migration.read() : null };
      const draft = await this.view.app.manageTypes(input);
      check(draft.expectedRevision === this.baseRevision, 'Relationship data changed; close and reopen the catalog', 'conflict');
      const review = await this.view.app.preview(draft.command, draft.expectedRevision);
      if (this.disposed || generation !== this.generation) return;
      this.review = { ...draft, review }; this.renderReview(review);
      this.save.disabled = false;
    } finally {
      if (!this.disposed && this.pending === pending) { this.pending = null; this.root.setAttribute('aria-busy', 'false'); }
    }
  }

  /** Display full old/new schema definitions and every changed assertion value as literal user text. @param {object} review Exact application review. @returns {void} */
  renderReview(review) {
    const { document } = this.view;
    for (const type of review.changeSet.types.added) this.definitionReview('Add', type);
    for (const pair of review.changeSet.types.updated) {
      this.definitionReview('Before', pair.before); this.definitionReview('After', pair.after);
    }
    for (const { before, after } of review.changeSet.assertions.updated) {
      const old = this.view.context.types.find(type => type.id === before.type);
      const next = review.snapshot.types.find(type => type.id === after.type);
      this.details.append(element(document, 'p', {}, `${before.source.key} → ${before.target.key}: Before: ${metadataText(before.metadata, old)}; After: ${metadataText(after.metadata, next)}`));
    }
    if (!this.details.childElementCount) this.details.append(element(document, 'p', {}, 'No catalog or metadata changes.'));
    if (review.changeSet.derived === null) this.conflictImpact = projectionReview({ view: this.view, parent: this.details, review, signal: this.abort.signal });
  }

  /** Render one complete human-readable schema side. @param {string} label Review side. @param {object} type Valid type. @returns {void} */
  definitionReview(label, type) {
    const { document } = this.view;
    this.details.append(element(document, 'p', {}, `${label}: ${type.label} (${type.id}), version ${type.version}${type.retired ? ', retired' : ''}. ${type.description}`));
    for (const field of type.fields) this.details.append(element(document, 'p', {},
      `${field.label} (${field.id}): ${field.kind}, ${field.required ? 'required' : 'optional'}${field.kind === 'enum' ? `; options: ${field.options.join(' · ')}` : ''}`));
  }

  /** Save only the reviewed command while locking inputs until the real transaction finishes. @returns {Promise<void>} */
  async apply() {
    check(!!this.review && !this.disposed, 'Preview this type change before saving');
    const { review } = this.review;
    const controls = [...this.root.querySelectorAll('input,button,textarea,select')].map(control => [control, control.disabled]);
    for (const [control] of controls) control.disabled = true;
    try { await this.view.app.applyReviewed(review); if (!this.disposed) this.view.finishEditor(); }
    finally { if (!this.disposed) for (const [control, disabled] of controls) control.disabled = disabled; }
  }

  /** Abort all owned listeners and release schema/migration controls. @returns {void} */
  dispose() {
    if (this.disposed) return; this.disposed = true; this.generation++; this.abort.abort();
    if (this.form) this.form.dispose(); if (this.migration) this.migration.dispose(); this.root.remove();
    if (this.conflictImpact) this.conflictImpact.dispose();
  }
}
