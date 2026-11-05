/** Captured-revision rule creation, editing and deletion with explicit full-closure impact review. */
import { check } from '../domain/values.mjs';
import { element } from './dom.mjs';
import { ruleButton } from './rule-controls.mjs';
import { ruleForm } from './rule-form.mjs';
import { ruleDefinition } from './provenance.mjs';
import { rulePreview } from './rule-preview.mjs';

/** Own one preference form's captured authority, review and listener lifetime. */
export class RuleEditor {
  /** Capture selected-library authority; later native changes invalidate without silently rebasing. @param {object} view Actual RulePreferences view. @param {object|null} rule Existing rule or new. @param {boolean} deleting Whether to propose deletion. */
  constructor(view, rule, deleting = false) {
    this.view = view; this.rule = rule; this.deleting = deleting;
    this.library = view.library; this.baseRevision = view.revision; this.before = view.snapshot;
    this.generation = 0; this.disposed = false; this.review = null;
    this.abort = new view.window.AbortController(); this.previewAbort = null;
    this.writable = true; this.lockedControls = new Map(); this.applyingControls = null;
    const { document, t } = view, owner = { document, t, signal: this.abort.signal };
    this.root = element(document, 'section', { 'data-rr-rule-editor': '', 'aria-busy': 'false' });
    this.root.style.cssText = 'display:grid;gap:8px;border-block-start:1px solid currentColor;padding-block:12px';
    if (deleting) {
      this.root.append(element(document, 'p', {}, t('delete-help')));
      ruleDefinition({ document, parent: this.root, rule, snapshot: this.before, t });
    } else this.form = ruleForm({ document, window: view.window, parent: this.root, types: view.snapshot.types,
      rule, t, onChange: () => this.invalidate() });
    this.error = element(document, 'p', { role: 'alert' });
    this.details = element(document, 'div', { 'data-rr-rule-review': '', 'aria-live': 'polite' });
    this.save = ruleButton(owner, 'save', 'save-rule', () => this.run(() => this.apply())); this.save.disabled = true;
    this.root.append(ruleButton(owner, 'preview', 'preview-rule', () => this.run(() => this.preview())), this.details,
      this.error, this.save, ruleButton(owner, 'cancel', 'cancel-rule', () => view.finishEditor()));
  }

  /** Surface an actual action failure and discard any invalid review. @param {Function} action Async work. @returns {void} */
  run(action) {
    Promise.resolve().then(action).catch(error => {
      this.view.report(error);
      if (!this.disposed) { this.invalidate(); this.error.textContent = error.message; }
    });
  }

  /** Invalidate all late review work on edits/native events without replacing draft inputs. @returns {void} */
  invalidate() {
    this.generation++; this.review = null; this.save.disabled = true;
    if (this.previewAbort) this.previewAbort.abort(); this.previewAbort = null;
    if (this.impact) this.impact.dispose(); this.impact = null; this.details.replaceChildren();
  }

  /** Preserve draft values while revoking mutation access, restoring semantic control states only after permission returns. @param {boolean} writable Current native owner permission. @returns {void} */
  setWritable(writable) {
    this.writable = writable;
    if (!writable) {
      this.invalidate();
      for (const control of this.root.querySelectorAll('input,button,textarea,select')) {
        if (control.dataset.rrAction === 'cancel-rule') continue;
        if (!this.lockedControls.has(control)) this.lockedControls.set(control,
          this.applyingControls?.has(control) ? this.applyingControls.get(control) : control.disabled);
        control.disabled = true;
      }
    } else if (this.applyingControls === null) {
      for (const [control, disabled] of this.lockedControls) if (control.isConnected) control.disabled = disabled;
      this.lockedControls.clear(); this.save.disabled = !this.review;
    }
  }

  /** Build and review the exact captured command; no writes occur during configuration. @returns {Promise<void>} */
  async preview() {
    check(this.writable, 'This library is not currently writable', 'permission');
    this.invalidate(); this.error.textContent = '';
    const generation = this.generation, pending = {}; this.pending = pending;
    this.previewAbort = new this.view.window.AbortController(); const signal = this.previewAbort.signal;
    this.root.setAttribute('aria-busy', 'true');
    try {
      const input = this.deleting ? { library: this.library, kind: 'delete', id: this.rule.id }
        : { library: this.library, kind: this.rule ? 'update' : 'create', rule: this.form.read() };
      const draft = await this.view.app.manageRules(input);
      check(draft.expectedRevision === this.baseRevision, 'Relationship data changed; cancel and reopen this rule', 'conflict');
      const review = await this.view.app.preview(draft.command, draft.expectedRevision);
      if (this.disposed || generation !== this.generation) return;
      const impact = await rulePreview({ view: this.view, parent: this.details, before: this.before, review, signal,
        onError: error => this.run(() => { throw error; }) });
      if (this.disposed || generation !== this.generation) { impact.dispose(); return; }
      this.impact = impact; this.review = review; this.save.disabled = false;
    } finally {
      if (!this.disposed && this.pending === pending) { this.pending = null; this.root.setAttribute('aria-busy', 'false'); }
    }
  }

  /** Publish only the reviewed command while locking the form and library selector. @returns {Promise<void>} */
  async apply() {
    check(!!this.review && !this.disposed && this.writable, 'Preview this rule change before saving');
    const controls = new Map([...this.root.querySelectorAll('input,button,textarea,select'), this.view.librarySelect].map(control => [control, control.disabled]));
    this.applyingControls = controls;
    for (const [control] of controls) control.disabled = true;
    try { await this.view.app.applyReviewed(this.review); if (!this.disposed) await this.view.finishEditor(); }
    finally {
      for (const [control, disabled] of controls) if (control.isConnected) control.disabled = disabled;
      this.applyingControls = null; if (!this.disposed) this.setWritable(this.view.editable);
    }
  }

  /** Abort owned form/review listeners and make all late results inert. @returns {void} */
  dispose() {
    if (this.disposed) return; this.disposed = true; this.invalidate(); this.abort.abort();
    if (this.form) this.form.dispose(); this.lockedControls.clear(); this.root.remove();
  }
}
