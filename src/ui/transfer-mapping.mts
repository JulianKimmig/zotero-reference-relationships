/** Complete endpoint decisions preserve original identities and drafts across bounded native mapping pages. */
import { check } from '../domain/values.mts';
import { canonicalJSON } from '../storage/canonical.mts';
import { element, controlID } from './dom.mts';
import { transferButton, transferSelect } from './transfer-controls.mts';
import { transferError } from './transfer-controls.mts';
import { chooseMappedReference } from '../adapters/picker.mts';
import type { ItemGateway, NativeWindow, ZoteroPlatform } from '../adapters/native-contracts.mts';
import type { ItemRef, LibraryScope } from '../domain/contracts.mts';
import type { ExportEnvelope, SourceOwner, TransferMapping } from '../transfer/contracts.mts';

/** Draft mode remains empty until each cross-owner endpoint receives an explicit decision. */
interface MappingDraft { source: ItemRef; key: string; mode: '' | 'reference' | 'retain' }
/** One document/target-bound editor owns original endpoint identities without title/DOI guessing. */
export class TransferMappingEditor {
  readonly root: HTMLElement; readonly #document: Document; readonly #window: NativeWindow;
  readonly #abort: AbortController; readonly #documentSource: SourceOwner; readonly #target: SourceOwner; readonly #library: LibraryScope;
  readonly #rows: MappingDraft[]; readonly #change: () => void; readonly #body: HTMLElement; readonly #status: HTMLElement;
  readonly #previous: HTMLButtonElement; readonly #next: HTMLButtonElement;
  readonly #Zotero: ZoteroPlatform; readonly #gateway: ItemGateway; readonly #report: (error: unknown) => void;
  readonly #dialogs = new Set<NativeWindow>(); readonly #error: HTMLElement;
  #pageAbort: AbortController | null = null; #offset = 0; #writable = true; #disposed = false; #picking = false; #generation = 0;

  /** Capture exact source originals and explicit native owner; only same-owner keys may start selected. @param {object} options Native owner, parent, verified document, explicit target, library and edit callback. */
  constructor({ window, parent, document, target, library, change, Zotero, gateway, report }: {
    window: NativeWindow; parent: HTMLElement; document: ExportEnvelope; target: SourceOwner; library: LibraryScope; change(): void;
    Zotero: ZoteroPlatform; gateway: ItemGateway; report(error: unknown): void;
  }) {
    this.#window = window; this.#document = parent.ownerDocument; this.#abort = new window.AbortController();
    this.#Zotero = Zotero; this.#gateway = gateway; this.#report = report;
    this.#documentSource = document.source; this.#target = target; this.#library = library; this.#change = change;
    const same = canonicalJSON(document.source) === canonicalJSON(target), refs = new Map<string, ItemRef>();
    for (const assertion of document.snapshot.assertions) for (const ref of [assertion.source, assertion.target]) refs.set(canonicalJSON(ref), ref);
    this.#rows = [...refs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([, source]) => ({ source: { ...source }, key: same ? source.key : '', mode: same ? 'reference' : '' }));
    this.root = element(this.#document, 'section', { 'data-rr-transfer-mapping': '' }); parent.append(this.root);
    this.root.append(element(this.#document, 'h4', {}, 'Map every original endpoint'), element(this.#document, 'p', {},
      same ? 'Same owner: original keys are preselected. Review availability; retain only inactive originals.'
        : 'Different owner: choose a reference or explicitly retain an inactive original for every row, including identical keys.'));
    this.#body = element(this.#document, 'div'); this.#status = element(this.#document, 'p', { role: 'status' });
    this.#error = element(this.#document, 'p', { role: 'alert' });
    this.#previous = transferButton(this.#document, 'Previous endpoints', 'mapping-previous', () => this.#page(-25), this.#abort.signal);
    this.#next = transferButton(this.#document, 'Next endpoints', 'mapping-next', () => this.#page(25), this.#abort.signal);
    this.root.append(this.#body, this.#status, this.#previous, this.#next, this.#error); this.#paint();
  }

  /** Every imported endpoint must have an explicit nonempty key and decision; semantic validation belongs to the service. @returns {boolean} Structural completeness across all pages. */
  get complete(): boolean { return this.#rows.every(row => row.mode !== '' && row.key !== ''); }

  /** Return one exact complete mapping reference for this preview; do not mutate it while a token is active. @returns {object} Explicit source/target/endpoint choices. */
  value(): TransferMapping {
    check(this.complete, 'Choose a target key and reference or retain for every original endpoint');
    return { source: { ...this.#documentSource }, target: { ...this.#target }, library: this.#library,
      endpoints: this.#rows.map(row => ({ source: { ...row.source }, target: { library: this.#library, key: row.key }, mode: row.mode as 'reference' | 'retain' })) };
  }

  /** Navigate without invalidating a decision or losing unmounted row values. @param {number} delta Page step. @returns {void} */
  #page(delta: number): void { this.#generation++; this.#closeDialogs(); this.#offset += delta; this.#paint(); }

  /** Render at most 25 endpoint decisions and abort all obsolete page listeners. @returns {void} */
  #paint(): void {
    this.#pageAbort?.abort(); this.#pageAbort = new this.#window.AbortController(); const signal = this.#pageAbort.signal;
    this.#body.replaceChildren();
    for (const row of this.#rows.slice(this.#offset, this.#offset + 25)) {
      const parent = element(this.#document, 'fieldset', { 'data-rr-transfer-source-key': row.source.key, 'aria-busy': 'false' });
      parent.append(element(this.#document, 'legend', {}, `Original ${row.source.library} / ${row.source.key}`));
      const chosen = element(this.#document, 'p', { 'data-rr-transfer-chosen-key': '' });
      chosen.textContent = row.key ? `Selected target: ${this.#library} / ${row.key}` : 'No target reference chosen.';
      const id = controlID(), input = element(this.#document, 'input', { id, type: 'text', 'data-rr-transfer-target-key': '', autocomplete: 'off', spellcheck: 'false' });
      input.value = row.key; input.readOnly = row.mode === 'retain'; input.disabled = !this.#writable;
      const advanced = element(this.#document, 'details');
      advanced.append(element(this.#document, 'summary', {}, 'Advanced: enter a target item key'),
        element(this.#document, 'label', { for: id }, `Target key for ${row.source.key}`), input);
      const choose = transferButton(this.#document, 'Choose reference…', 'choose-reference',
        () => { this.#choose(row, parent, input, mode, chosen, signal); }, signal);
      choose.setAttribute('aria-label', `Choose reference for original ${row.source.key} in ${this.#library}`);
      choose.disabled = !this.#writable || this.#picking;
      parent.append(chosen, choose);
      const mode = transferSelect({ document: this.#document, parent, label: `Decision for ${row.source.key}`, attribute: 'data-rr-transfer-mode',
        choices: [['', 'Choose explicitly'], ['reference', 'Reference an active target'], ['retain', 'Retain original inactive key']], signal,
        change: () => {
          if (mode.value === row.mode) return;
          check(['', 'reference', 'retain'].includes(mode.value), 'Unknown endpoint decision');
          row.mode = mode.value as MappingDraft['mode'];
          if (row.mode === 'retain') { row.key = row.source.key; input.value = row.key; }
          chosen.textContent = `Selected target: ${this.#library} / ${row.key}`;
          input.readOnly = row.mode === 'retain'; this.#changed();
        } });
      mode.value = row.mode; mode.disabled = !this.#writable;
      parent.append(advanced);
      /** Preserve literal advanced key edits across unmounted pages and pending native choices. @returns {void} */
      const editKey = () => {
        if (input.value === row.key) return;
        row.key = input.value; chosen.textContent = `Selected target: ${this.#library} / ${row.key}`; this.#changed();
      };
      input.addEventListener('input', editKey, { signal }); input.addEventListener('change', editKey, { signal });
      this.#body.append(parent);
    }
    this.#previous.disabled = this.#offset === 0; this.#next.disabled = this.#offset + 25 >= this.#rows.length; this.#summary();
  }

  /** Expose progress for all pages after a real draft edit. @returns {void} */
  #changed(): void { this.#generation++; this.#summary(); this.#change(); }

  /** Close only dialogs opened by this mapping on page/library changes or teardown. @returns {void} */
  #closeDialogs(): void { for (const dialog of this.#dialogs) if (!dialog.closed) dialog.close(); }

  /** Apply only a fresh native choice to this still-connected row; native eligibility errors preserve the draft. @param {object} row Original endpoint draft. @param {Element} parent Owned fieldset. @param {Element} input Exact key control. @param {Element} mode Explicit decision. @param {Element} chosen Literal selected identity. @param {AbortSignal} signal Owning page lifetime. @returns {Promise<void>} Choice handled or canceled without late mutations. */
  async #choose(row: MappingDraft, parent: HTMLElement, input: HTMLInputElement, mode: HTMLSelectElement, chosen: HTMLElement, signal: AbortSignal): Promise<void> {
    if (this.#disposed || this.#picking || !this.#writable || !this.root.isConnected || signal.aborted) return;
    this.#picking = true; const generation = ++this.#generation; parent.setAttribute('aria-busy', 'true'); this.#error.textContent = '';
    this.setWritable(this.#writable); this.#change();
    /** Require exact row/view ownership after the actual native dialog and item checks. @returns {boolean} Whether the pending response is current. */
    const current = () => !this.#disposed && this.root.isConnected && !signal.aborted && generation === this.#generation;
    try {
      const target = await chooseMappedReference({ Zotero: this.#Zotero, gateway: this.#gateway, window: this.#window,
        library: this.#library, dialogs: this.#dialogs });
      if (!current() || target === null) return;
      row.key = target.key; row.mode = 'reference'; input.value = row.key; input.readOnly = false; mode.value = 'reference';
      chosen.textContent = `Selected target: ${target.library} / ${target.key}`; this.#changed();
    } catch (error) { this.#report(error); if (current()) this.#error.textContent = transferError(error); }
    finally {
      this.#picking = false;
      if (!this.#disposed && !signal.aborted) { parent.setAttribute('aria-busy', 'false'); this.setWritable(this.#writable); }
    }
  }

  /** Present exact completed and total decisions without implying native validation. @returns {void} */
  #summary(): void {
    this.#status.textContent = `${this.#rows.filter(row => row.key && row.mode).length} / ${this.#rows.length} endpoint decisions; ${this.#offset + (this.#rows.length ? 1 : 0)}–${Math.min(this.#offset + 25, this.#rows.length)} shown. Target keys are validated during preview.`;
  }

  /** Refresh native write permission without changing any visible or paged draft. @param {boolean} writable Current target eligibility. @returns {void} */
  setWritable(writable: boolean): void {
    if (this.#writable && !writable) { this.#generation++; this.#closeDialogs(); }
    this.#writable = writable;
    for (const control of this.#body.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')) control.disabled = !writable;
    for (const control of this.#body.querySelectorAll<HTMLButtonElement>('button')) control.disabled = !writable || this.#picking;
  }

  /** Release owned page/listener lifetimes and only this editor's DOM. @returns {void} */
  dispose(): void {
    if (this.#disposed) return; this.#disposed = true; this.#generation++; this.#closeDialogs();
    this.#pageAbort?.abort(); this.#abort.abort(); this.root.remove();
  }
}
