/** Own editor entry and return focus across native asynchronous pane redraws without retaining retired editor DOM. */
import { check } from '../domain/values.mts';

/** Semantic return location belongs to one selected pane, including the original manual relationship when present. */
interface ReturnLocation { root: HTMLElement; action: 'add' | 'edit' | 'remove'; relationship: string | null }

/** Coordinate only explicitly managed relationship editors; unrelated active controls retain their focus. */
export class EditorFocus {
  readonly document: Document;
  #opened: { editor: HTMLElement; location: ReturnLocation } | null = null;
  #pending: ReturnLocation | null = null;

  /** Bind the actual pane document; no listeners, timers or platform focus replacements are installed. @param document Native owner document. */
  constructor(document: Document) { this.document = document; }

  /** Release all selection-specific DOM references. @returns Nothing; repeated cleanup is harmless. */
  clear(): void { this.#opened = null; this.#pending = null; }

  /** Recognize no focused control after native removal or disabling. @param active Actual active element. @returns Whether focus is on the document shell rather than another control. */
  neutral(active: Element | null): boolean {
    return active === null || active === this.document.body || active === this.document.documentElement;
  }

  /** Focus the newly mounted editor's first enabled control and remember a semantic return location. @param root Selected item pane. @param editor Newly connected relationship editor. @param location Original action/relationship; missing original rows return to Add. @returns Nothing; malformed editor controls fail visibly. */
  open(root: HTMLElement, editor: HTMLElement, location: Omit<ReturnLocation, 'root'>): void {
    this.clear();
    check(root.isConnected && editor.isConnected, 'Editor focus requires a mounted pane and editor');
    const first = editor.querySelector<HTMLElement>('button:enabled,input:enabled,select:enabled,textarea:enabled');
    check(first, 'Relationship editor has no enabled focus destination');
    this.#opened = { editor, location: { ...location, root } }; first.focus();
  }

  /** Capture return intent before removing the editor; independently focused controls are preserved. @param editor Actual finishing editor, including unmanaged catalog/repair forms. @returns Nothing; only this managed owner can request restoration. */
  finish(editor: HTMLElement): void {
    const opened = this.#opened; this.clear();
    if (!opened || opened.editor !== editor) return;
    const active = this.document.activeElement;
    if (opened.editor.contains(active) || this.neutral(active)) this.#pending = opened.location;
  }

  /** Restore after a complete current render, respecting focus moved elsewhere during the asynchronous read. @param root Fully rendered selected pane. @returns Nothing; inactive/disconnected panes and unavailable actions do not steal focus. */
  restore(root: HTMLElement): void {
    const location = this.#pending; this.#pending = null;
    if (!location || location.root !== root || !root.isConnected || !this.document.hasFocus()
      || !this.neutral(this.document.activeElement)) return;
    const row = location.relationship === null ? null : [...root.querySelectorAll<HTMLElement>('[data-rr-relation]')]
      .find(value => value.getAttribute('data-rr-relation') === location.relationship);
    const original = row?.querySelector<HTMLButtonElement>(`[data-rr-action="${location.action}"]`);
    const target = original ?? root.querySelector<HTMLButtonElement>('[data-rr-action="add"]');
    if (target && !target.disabled) target.focus();
  }
}
