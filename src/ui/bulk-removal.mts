/** Explicit selected-original removal with complete preview, issued review ownership and one atomic publication. */
import { check } from '../domain/values.mts';
import { element } from './dom.mts';
import { ruleButton } from './rule-controls.mts';
import { rulePreview } from './rule-preview.mts';
import { originalValues } from './original-values.mts';
import type { LibraryScope } from '../domain/contracts.mts';
import type { Review } from '../application/contracts.mts';
import type { RelationshipView } from './view.mts';
import type { Disposable } from './contracts.mts';

/** Own one captured-library selected-original removal draft and every async review/listener. */
export class BulkRemovalEditor {
  view: RelationshipView; ids: string[]; library: LibraryScope; baseRevision: string | null;
  generation: number; disposed: boolean; review: Review | null; abort: AbortController;
  root: HTMLElement; details: HTMLDivElement; error: HTMLParagraphElement; save: HTMLButtonElement;
  reviewAbort?: AbortController; impact?: Disposable | null; pending?: object | null;
  /** Capture exact selected identities and displayed head before starting a no-write preview. @param {object} view Actual RelationshipView. @param {string[]} ids Explicit selected original IDs. */
  constructor(view: RelationshipView, ids: string[]) {
    this.view = view; this.ids = [...ids]; this.library = view.ref.library; this.baseRevision = view.context!.revision;
    this.generation = 0; this.disposed = false; this.review = null; this.abort = new view.window.AbortController();
    const { document, t } = view, owner = { document, t, signal: this.abort.signal };
    this.root = element(document, 'section', { 'data-rr-bulk-removal': '', 'aria-busy': 'false' });
    this.root.append(element(document, 'h4', {}, `${t('remove-selected')} (${ids.length})`));
    this.details = element(document, 'div', { 'aria-live': 'polite' }); this.error = element(document, 'p', { role: 'alert' });
    this.save = ruleButton(owner, 'confirm-removals', 'save-removals', () => this.run(() => this.apply())); this.save.disabled = true;
    this.root.append(ruleButton(owner, 'preview', 'preview-removals', () => this.run(() => this.preview())), this.details, this.error,
      this.save, ruleButton(owner, 'cancel', 'cancel-removals', () => view.finishEditor()));
    this.run(() => this.preview());
  }

  /** Execute real application actions and retain visible failures without dropping the selection. @param {Function} action Async command. @returns {void} */
  run(action: () => unknown): void {
    Promise.resolve().then(action).catch(error => {
      this.view.report(error); if (!this.disposed) { this.invalidate(); this.error.textContent = error.message; }
    });
  }

  /** Retire the current review and every removed preview's listeners on input/native changes. @returns {void} */
  invalidate() {
    this.generation++; this.review = null; this.save.disabled = true;
    if (this.reviewAbort) this.reviewAbort.abort(); if (this.impact) this.impact.dispose(); this.impact = null;
    this.details.replaceChildren();
  }

  /** Preview all selected removals against the captured head, including complete unavailable-before/ready-after effects. @returns {Promise<void>} */
  async preview() {
    this.invalidate(); this.error.textContent = ''; const generation = this.generation, pending = {}; this.pending = pending;
    this.root.setAttribute('aria-busy', 'true'); const { view } = this;
    try {
      const before = await view.app.read(this.library);
      check(before.state === 'ready' && before.head === this.baseRevision, 'Relationship data changed; cancel and reopen removal selection', 'conflict');
      const draft = await view.app.draftRemoveMany(this.ids, this.library);
      check(draft.expectedRevision === this.baseRevision, 'Relationship data changed; cancel and reopen removal selection', 'conflict');
      const review = await view.app.preview(draft.command, draft.expectedRevision);
      if (this.disposed || generation !== this.generation) return;
      this.reviewAbort = new view.window.AbortController(); const signal = this.reviewAbort.signal;
      const originals = element(view.document, 'section'); this.details.append(originals);
      originals.append(element(view.document, 'h4', {}, `${view.t('removed')}: ${review.changeSet.assertions.removed.length}`));
      originalValues({ view, parent: originals, originals: review.changeSet.assertions.removed, signal });
      const effects = element(view.document, 'section'); this.details.append(effects);
      const impact = await rulePreview({ view, parent: effects, before: before.snapshot, review, signal,
        onError: error => this.run(() => { throw error; }) });
      if (this.disposed || generation !== this.generation) { impact.dispose(); return; }
      this.impact = impact; this.review = review; this.save.disabled = false;
    } finally {
      if (!this.disposed && this.pending === pending) { this.pending = null; this.root.setAttribute('aria-busy', 'false'); }
    }
  }

  /** Publish only the displayed issued review through the actual event transaction guard. @returns {Promise<void>} */
  async apply() {
    check(!!this.review && !this.disposed, 'Preview the selected removals before saving'); const review = this.review;
    const controls = [...this.root.querySelectorAll('button')].map(control => [control, control.disabled] as const);
    for (const [control] of controls) control.disabled = true; this.root.setAttribute('aria-busy', 'true');
    try { await this.view.app.applyReviewed(review); if (!this.disposed) this.view.finishEditor(); }
    finally { if (!this.disposed) { for (const [control, disabled] of controls) control.disabled = disabled; this.root.setAttribute('aria-busy', 'false'); } }
  }

  /** Dispose every owned control/review and discard late native responses. @returns {void} */
  dispose() {
    if (this.disposed) return; this.disposed = true; this.generation++; this.abort.abort();
    if (this.reviewAbort) this.reviewAbort.abort(); if (this.impact) this.impact.dispose(); this.root.remove();
  }
}
