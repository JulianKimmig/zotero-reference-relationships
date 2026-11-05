/** Selected-library rule catalog in Zotero's official preferences document. */
import { check } from '../domain/values.mjs';
import { initialGraph } from '../application/seed.mjs';
import { element } from './dom.mjs';
import { ruleControl, ruleButton } from './rule-controls.mjs';
import { ruleDefinition } from './provenance.mjs';
import { RuleEditor } from './rule-editor.mjs';

/** Own library selection, authority and editor lifetimes in one native preferences pane. */
export class RulePreferences {
  /** Mount actual personal/group library choices; no drafts are stored merely by opening preferences. @param {object} options {window,root,Zotero,app,gateway,t,report}. */
  constructor(options) {
    Object.assign(this, options); this.document = this.root.ownerDocument;
    this.abort = new this.window.AbortController(); this.generation = 0; this.disposed = false; this.editor = null;
    this.root.style.cssText = 'display:grid;gap:10px;max-width:100%;font:inherit';
    this.root.replaceChildren(element(this.document, 'p', {}, this.t('language')));
    const choices = this.Zotero.Libraries.getAll().filter(library => ['user', 'group'].includes(library.libraryType))
      .map(library => [this.gateway.scope(library.libraryID), library.name]);
    this.librarySelect = ruleControl({ document: this.document, parent: this.root, label: this.t('library'), name: 'library',
      value: 'self', choices, signal: this.abort.signal,
      onChange: event => { if (event.type === 'change') this.run(() => this.load(this.librarySelect.value)); } });
    this.librarySelect.setAttribute('data-rr-library', '');
    this.message = element(this.document, 'p', { role: 'status' }); this.error = element(this.document, 'p', { role: 'alert' });
    this.list = element(this.document, 'div'); this.formBody = element(this.document, 'div');
    this.newButton = ruleButton({ document: this.document, t: this.t, signal: this.abort.signal }, 'new', 'new-rule', () => this.edit(null));
    this.root.append(this.message, this.newButton, this.list, this.formBody, this.error);
  }

  /** Run native work while exposing failures in the current connected preferences pane. @param {Function} action Async action. @returns {void} */
  run(action) {
    Promise.resolve().then(action).catch(error => {
      this.report(error);
      if (!this.disposed) { this.root.dataset.rrState = 'error'; this.root.setAttribute('aria-busy', 'false'); this.error.textContent = error.message; }
    });
  }

  /** Load an explicit library and discard its previous unsaved editor; unavailable authority never becomes an empty graph. @param {string} library Portable scope. @returns {Promise<void>} */
  async load(library) {
    if (this.editor) this.editor.dispose(); this.editor = null;
    this.gateway.library(library);
    check([...this.librarySelect.options].some(option => option.value === library), 'Library is absent from rule preferences', 'endpoint');
    const generation = ++this.generation;
    if (this.listAbort) this.listAbort.abort(); this.listAbort = new this.window.AbortController();
    this.library = library; this.librarySelect.value = library; this.newButton.disabled = true;
    this.root.dataset.rrState = 'loading'; this.root.setAttribute('aria-busy', 'true'); this.error.textContent = ''; this.list.replaceChildren();
    const state = await this.app.read(library);
    if (this.disposed || generation !== this.generation || !this.root.isConnected) return;
    check(['ready', 'uninitialized'].includes(state.state), `Relationship authority is ${state.state}; rule editing is unavailable`, 'conflict');
    this.snapshot = state.state === 'ready' ? state.snapshot : initialGraph(library);
    this.revision = state.state === 'ready' ? state.head : null;
    const owner = this.gateway.library(library); this.editable = owner.editable && !owner.archived;
    this.message.textContent = !this.editable ? this.t('read-only') : !this.snapshot.rules.length ? this.t('empty') : '';
    this.newButton.disabled = !this.editable;
    for (const rule of this.snapshot.rules) {
      const row = element(this.document, 'section', { 'data-rr-rule-id': rule.id });
      ruleDefinition({ document: this.document, parent: row, rule, snapshot: this.snapshot, t: this.t });
      for (const [key, deleting] of [['edit', false], ['delete', true]]) {
        const control = ruleButton({ document: this.document, t: this.t, signal: this.listAbort.signal }, key, `${key}-rule`, () => this.edit(rule, deleting));
        control.disabled = !this.editable; row.append(control);
      }
      this.list.append(row);
    }
    this.root.dataset.rrLibrary = library; this.root.dataset.rrState = 'ready'; this.root.setAttribute('aria-busy', 'false');
  }

  /** Open one captured-revision editor after actual library permission checks. @param {object|null} rule Existing declaration or new. @param {boolean} deleting Delete review instead of editing. @returns {void} */
  edit(rule, deleting = false) {
    check(this.editable && this.root.dataset.rrState === 'ready', 'This library is read-only', 'permission');
    if (this.editor) this.editor.dispose();
    this.editor = new RuleEditor(this, rule, deleting); this.formBody.append(this.editor.root);
    this.editor.root.querySelector('input,button')?.focus();
  }

  /** Finish an explicit save/cancel and reobserve current authority. @returns {Promise<void>} */
  async finishEditor() { if (this.editor) this.editor.dispose(); this.editor = null; await this.load(this.library); }

  /** Invalidate reviews on actual item/group notifications; idle panes reload their library. @returns {void} */
  nativeChange() { if (this.disposed) return; if (this.editor) this.editor.invalidate(); else this.run(() => this.load(this.library)); }

  /** Abort all listeners, remove only owned DOM and discard late authority responses. @returns {void} */
  dispose() {
    if (this.disposed) return; this.disposed = true; this.generation++; this.abort.abort();
    if (this.listAbort) this.listAbort.abort();
    if (this.editor) this.editor.dispose(); this.editor = null;
    this.root.dataset.rrState = 'disposed'; this.root.setAttribute('aria-busy', 'false'); this.root.replaceChildren();
  }
}
