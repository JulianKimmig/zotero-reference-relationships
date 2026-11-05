/** Original-contributor selection and retained inactive-endpoint reporting without automatic graph writes. */
import { check } from '../domain/values.mjs';
import { element } from './dom.mjs';
import { literalValues } from './contributor-values.mjs';
import { ruleButton } from './rule-controls.mjs';

/** Own a selected library's captured original-root inspection and bounded native title reads. */
export class RepairPanel {
  /** Mount an original assertion list or an explicit subset of coalesced contributors. @param {object} view RelationshipView. @param {string[]|null} ids Requested original identities or all library roots. */
  constructor(view, ids) {
    this.view = view; this.ids = ids; this.offset = 0; this.disposed = false; this.generation = 0;
    this.abort = new view.window.AbortController(); const { document, t } = view;
    this.root = element(document, 'section', { 'data-rr-repairs': '', 'aria-busy': 'true' });
    this.root.style.cssText = 'display:grid;gap:8px;padding-block:12px';
    this.root.append(element(document, 'h4', {}, t('originals')));
    this.message = element(document, 'p', { role: 'status' }); this.error = element(document, 'p', { role: 'alert' });
    this.body = element(document, 'div'); this.controls = element(document, 'div');
    const owner = { document, t, signal: this.abort.signal };
    this.previous = ruleButton(owner, 'previous', 'roots-previous', () => { this.offset -= 25; this.run(() => this.page()); });
    this.next = ruleButton(owner, 'next', 'roots-next', () => { this.offset += 25; this.run(() => this.page()); });
    this.controls.append(this.previous, this.next);
    this.root.append(this.message, this.body, this.controls, this.error,
      ruleButton(owner, 'close-repairs', 'close-repairs', () => view.finishEditor()));
  }

  /** Run actual reads and retain visible failures without changing authority. @param {Function} action Async work. @returns {void} */
  run(action) { Promise.resolve().then(action).catch(error => { this.view.report(error); if (!this.disposed) { this.error.textContent = error.message; this.root.setAttribute('aria-busy', 'false'); } }); }

  /** Read original keys/metadata at the displayed head before exposing any edit/remove action. @returns {Promise<void>} */
  async load() {
    if (this.disposed) return;
    const { app, ref, context, t } = this.view, generation = this.generation;
    const state = await app.read(ref.library);
    if (this.disposed || generation !== this.generation) return;
    check(state.state === 'ready' && state.head === context.revision, 'Relationship data changed; close and reopen original relationships', 'conflict');
    const report = await app.reconcile(ref.library, { offset: 0, limit: 1 });
    if (this.disposed || generation !== this.generation) return;
    check(report.revision === state.head, 'Relationship data changed; reopen original relationships', 'conflict');
    if (this.disposed || generation !== this.generation) return;
    this.message.textContent = report.state === 'conflict' ? t('conflicted-before') : t('original-keys');
    this.roots = state.snapshot.assertions.filter(root => this.ids === null || this.ids.includes(root.id)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (this.ids !== null) check(this.roots.length === this.ids.length, 'Original contribution is no longer present', 'conflict');
    this.diagnostics = report.diagnostics; await this.page();
  }

  /** Resolve only the current page and discard late results after native changes or selection. @returns {Promise<void>} */
  async page() {
    const generation = ++this.generation, { app, document, window, t, context } = this.view;
    if (this.pageAbort) this.pageAbort.abort(); this.pageAbort = new window.AbortController();
    this.body.replaceChildren(); this.root.setAttribute('aria-busy', 'true');
    this.previous.disabled = this.offset === 0; this.next.disabled = this.offset + 25 >= this.roots.length;
    this.controls.hidden = this.roots.length <= 25;
    const rows = await Promise.all(this.roots.slice(this.offset, this.offset + 25).map(async root => ({ root,
      source: await app.describe(root.source), target: await app.describe(root.target) })));
    if (this.disposed || generation !== this.generation) return;
    for (const { root, source, target } of rows) {
      const card = element(document, 'section', { 'data-rr-repair-root': root.id });
      const status = [source, target].find(value => value.status !== 'active')?.status
        ?? (this.diagnostics.some(value => value.code === 'self-edge' && value.details.id === root.id) ? 'self-edge' : 'active');
      card.dataset.rrEndpointStatus = status;
      card.append(element(document, 'p', {}, `${source.title} [${root.source.key}] → ${root.type} → ${target.title} [${root.target.key}]`),
        element(document, 'p', {}, literalValues(root.metadata)), element(document, 'p', {}, `${t('contribution')}: ${root.id} · ${status}`));
      for (const [key, mode] of [['edit-original', 'edit'], ['remove-original', 'remove']]) {
        const control = ruleButton({ document, t, signal: this.pageAbort.signal }, key, key,
          () => this.view.run(() => this.view.openEditor(mode, { ...root, assertions: [root.id], supports: [] }, root.id)));
        control.disabled = !context.editable; card.append(control);
      }
      this.body.append(card);
    }
    if (!rows.length) this.body.append(element(document, 'p', {}, t('no-originals')));
    this.root.setAttribute('aria-busy', 'false');
  }

  /** Keep the captured originals visible but disable actions after native data changes. @returns {void} */
  invalidate() {
    this.generation++; if (this.pageAbort) this.pageAbort.abort();
    this.error.textContent = this.view.t('stale-repairs');
    for (const control of this.root.querySelectorAll('button')) if (control.dataset.rrAction !== 'close-repairs') control.disabled = true;
    this.root.setAttribute('aria-busy', 'false');
  }

  /** Abort all owned listeners and prevent detached late pages from publishing. @returns {void} */
  dispose() { if (this.disposed) return; this.disposed = true; this.generation++; this.abort.abort(); if (this.pageAbort) this.pageAbort.abort(); this.root.remove(); }
}
