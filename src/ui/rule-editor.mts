/** Captured-revision rule creation, editing and deletion with explicit full-closure impact review. */
import { check } from '../domain/values.mts';
import { element } from './dom.mts';
import { ruleButton } from './rule-controls.mts';
import { ruleForm } from './rule-form.mts';
import { ruleDefinition } from './provenance.mts';
import { rulePreview } from './rule-preview.mts';
import type { Graph, LibraryScope, Rule } from '../domain/contracts.mts';
import type { Review, RuleCommand } from '../application/contracts.mts';
import type { RulePreferences } from './rule-preferences.mts';
import type { Disposable, FormControl } from './contracts.mts';
import { formErrorOrigin, clearFormError, presentFormError } from './form-error.mts';
import { errorMessage } from '../domain/failures.mts';

/** Own one preference form's captured authority, review and listener lifetime. */
export class RuleEditor {
  view: RulePreferences; rule: Rule | null; deleting: boolean; library: LibraryScope; baseRevision: string | null; before: Graph;
  generation: number; disposed: boolean; review: Review | null; abort: AbortController; previewAbort: AbortController | null;
  writable: boolean; lockedControls: Map<FormControl, boolean>; applyingControls: Map<FormControl, boolean> | null;
  root: HTMLElement; error: HTMLParagraphElement; details: HTMLDivElement; save: HTMLButtonElement;
  form?: ReturnType<typeof ruleForm>; impact?: Disposable | null; pending?: object | null;
  /** Capture selected-library authority; later native changes invalidate without silently rebasing. @param {object} view Actual RulePreferences view. @param {object|null} rule Existing rule or new. @param {boolean} deleting Whether to propose deletion. */
  constructor(view: RulePreferences, rule: Rule | null, deleting: boolean = false) {
    this.view = view; this.rule = rule; this.deleting = deleting;
    this.library = view.library; this.baseRevision = view.revision; this.before = view.snapshot;
    this.generation = 0; this.disposed = false; this.review = null;
    this.abort = new view.window.AbortController(); this.previewAbort = null;
    this.writable = true; this.lockedControls = new Map(); this.applyingControls = null;
    const { document, t } = view, owner = { document, t, signal: this.abort.signal };
    this.root = element(document, 'section', { 'data-rr-rule-editor': '', 'aria-busy': 'false',
      'aria-label': t(deleting ? 'delete' : rule ? 'edit' : 'new') });
    this.root.style.cssText = 'display:grid;gap:8px;border-block-start:1px solid currentColor;padding-block:12px';
    if (deleting) {
      this.root.append(element(document, 'p', {}, t('delete-help')));
      ruleDefinition({ document, parent: this.root, rule: rule!, snapshot: this.before, t });
    } else this.form = ruleForm({ document, window: view.window, parent: this.root, types: view.snapshot.types,
      rule, t, onChange: () => this.invalidate() });
    this.error = element(document, 'p', { role: 'alert' });
    this.details = element(document, 'div', { 'data-rr-rule-review': '', 'aria-live': 'polite' });
    this.save = ruleButton(owner, 'save', 'save-rule', () => this.run(() => this.apply(), true)); this.save.disabled = true;
    this.root.append(ruleButton(owner, 'preview', 'preview-rule', () => this.run(() => this.preview(), true)), this.details,
      this.error, this.save, ruleButton(owner, 'cancel', 'cancel-rule', () => view.finishEditor()));
  }

  /** Surface actual failures with optional explicit-action focus ownership and discard invalid reviews. @param action Async work. @param focusError Only explicit Preview/Save actions opt in; background impact failures preserve focus. @returns Failures remain reported and visible. */
  run(action: () => unknown, focusError: boolean = false): void {
    const origin = focusError ? formErrorOrigin(this.root) : null;
    Promise.resolve().then(action).catch((error: unknown) => {
      this.view.report(error);
      if (!this.disposed) { this.invalidate(); presentFormError(this.root, this.error, errorMessage(error), origin); }
    });
  }

  /** Invalidate all late review work on edits/native events without replacing draft inputs. @returns {void} */
  invalidate() {
    this.generation++; this.review = null; this.save.disabled = true;
    if (this.previewAbort) this.previewAbort.abort(); this.previewAbort = null;
    if (this.impact) this.impact.dispose(); this.impact = null; this.details.replaceChildren();
  }

  /** Preserve draft values while revoking mutation access, restoring semantic control states only after permission returns. @param {boolean} writable Current native owner permission. @returns {void} */
  setWritable(writable: boolean) {
    this.writable = writable;
    if (!writable) {
      this.invalidate();
      for (const control of this.root.querySelectorAll<FormControl>('input,button,textarea,select')) {
        if (control.dataset.rrAction === 'cancel-rule') continue;
        if (!this.lockedControls.has(control)) this.lockedControls.set(control,
          this.applyingControls?.has(control) ? this.applyingControls.get(control)! : control.disabled);
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
    this.invalidate(); clearFormError(this.error);
    const generation = this.generation, pending = {}; this.pending = pending;
    this.previewAbort = new this.view.window.AbortController(); const signal = this.previewAbort.signal;
    this.root.setAttribute('aria-busy', 'true');
    try {
      const input: RuleCommand = this.deleting ? { library: this.library, kind: 'delete', id: this.rule!.id }
        : { library: this.library, kind: this.rule ? 'update' : 'create', rule: this.form!.read() };
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
    const controls = new Map([...this.root.querySelectorAll<FormControl>('input,button,textarea,select'), this.view.librarySelect].map(control => [control, control.disabled] as const));
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
