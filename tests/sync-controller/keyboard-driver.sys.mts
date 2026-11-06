/** Request real OS keys from the external driver; DOM is inspected, never clicked or assigned during the journey. */
import type { NativeAPI } from './native-api.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { TestWindow } from './platform-contracts.mts';
import { present } from './evidence.sys.mts';
import { check } from './ui-helpers.sys.mts';
import type { JourneyStroke } from './keyboard-contracts.mts';

/** Detached non-secret event observations distinguish trusted input from programmatic state changes. */
interface KeyObservation { type: string; key: string | null; trusted: boolean; target: string; focused: string }

/** Follow the actual focused control into native custom-element shadow roots. @param document Live native document. @returns Current deepest focused element, or null. */
export function activeControl(document: Document): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** Identify fixture UI controls without retaining DOM nodes in event reports. @param node Current target. @returns Semantic selector or native tag/id. */
function identity(node: EventTarget | null): string {
  const element = node as Element | null;
  if (!element?.getAttribute) return 'none';
  for (const attr of ['data-rr-action', 'data-rr-rule-field', 'data-rr-map-mode', 'data-rr-map-root', 'data-rr-field', 'aria-label', 'id']) {
    const value = element.getAttribute(attr); if (value) return `${attr}=${value}`;
  }
  return element.localName;
}

/** Own one bounded request stream and observation lifetime for a fresh native job. */
export class NativeKeyboardDriver {
  readonly events: KeyObservation[] = [];
  readonly steps: { step: number; label: string; windowMarker: string; before: string; after: string }[] = [];
  readonly #windows = new Map<TestWindow, { marker: string; title: string; record(event: Event): void }>();
  #step = 0;
  /** Capture actual host and exact job identity. @param job Fresh unsigned-in action. @param api Real native resources. */
  constructor(readonly job: ControllerJob, readonly api: NativeAPI) {}

  /** Mark a real visible window and observe trusted events without moving its focus. @param window Native window opened by the workflow. @returns Its unique marker. */
  track(window: TestWindow): string {
    const existing = this.#windows.get(window); if (existing) return existing.marker;
    const marker = this.api.Services.uuid.generateUUID().toString().slice(1, -1), title = window.document.title;
    const events = this.events;
    /** Observe only actual event trust and semantic targets. @param event Native event. @returns Appends detached diagnostic data. */
    function record(event: Event): void {
      events.push({ type: event.type, key: 'key' in event ? String(event.key) : null, trusted: event.isTrusted,
        target: identity(event.composedPath()[0]), focused: identity(activeControl(window.document)) });
    }
    window.document.title = `RR keyboard probe ${marker}`;
    for (const type of ['keydown', 'keyup', 'input', 'click']) window.addEventListener(type, record, true);
    this.#windows.set(window, { marker, title, record });
    return marker;
  }

  /** Request exact OS transitions and await their create-only reply; only step zero assigns focus. @param window Current native window. @param strokes Bounded form keys. @param label Workflow intent. @returns Completes after actual sender delivery or throws original failure. */
  async keys(window: TestWindow, strokes: JourneyStroke[], label: string): Promise<void> {
    const io = present(this.api.IOUtils), step = this.#step++, marker = this.track(window);
    const exchange = `${this.job.data}/keyboard-journey`, before = identity(activeControl(window.document));
    await io.writeUTF8(`${exchange}/request-${step}.json`, JSON.stringify({ action: this.job.action, marker: this.job.marker,
      data: this.job.data, step, state: 'ready', display: this.api.Services.env.get('DISPLAY'), authority: this.api.Services.env.get('XAUTHORITY'),
      windowMarker: marker, focus: step === 0 ? 'assign' : 'require', strokes, label,
      windowFocused: window.document.hasFocus(), activeControl: before }), { mode: 'create', flush: true });
    const deadline = Date.now() + 20000;
    let reply: { marker: string; data: string; step: number; ok: boolean; error?: string } | undefined;
    while (!reply) {
      check(Date.now() < deadline, `OS keyboard delivery timed out at ${label}`);
      try { reply = JSON.parse(await io.readUTF8(`${exchange}/reply-${step}.json`)); }
      catch (error) { if (!(error instanceof Error) || error.name !== 'NotFoundError') throw error; }
      if (!reply) await this.api.Zotero.Promise.delay(25);
    }
    check(reply.marker === this.job.marker && reply.data === this.job.data && reply.step === step, 'OS keyboard reply isolation mismatch');
    check(reply.ok, `OS keyboard failed at ${label}: ${reply.error}`);
    await this.api.Zotero.Promise.delay(75);
    this.steps.push({ step, label, windowMarker: marker, before, after: window.closed ? 'closed' : identity(activeControl(window.document)) });
  }

  /** Deliver one unmodified key. @param window Current native window. @param key Native keysym. @param label Workflow intent. @returns Actual OS delivery completion. */
  async key(window: TestWindow, key: string, label: string): Promise<void> { await this.keys(window, [{ key, modifiers: [] }], label); }

  /** Reach an observed enabled control by native Tab traversal, without calling focus. @param window Current window. @param find Live semantic control lookup. @param label Expected destination. @returns The actually focused target; fails on unreachable controls. */
  async tabTo(window: TestWindow, find: () => Element | null, label: string): Promise<Element> {
    for (let tabs = 0; tabs <= 80; tabs++) {
      const target = find(); if (target && (activeControl(window.document) === target || window.document.activeElement === target)) return target;
      if (tabs === 80) break;
      const active = activeControl(window.document), position = active && target ? active.compareDocumentPosition(target) : 0;
      const reverse = !(position & 1) && !!(position & 2);
      await this.keys(window, [{ key: 'Tab', modifiers: reverse ? ['Shift_L'] : [] }], `${reverse ? 'shift tab' : 'tab'} to ${label}`);
    }
    throw new Error(`Keyboard cannot reach ${label}; focused=${identity(activeControl(window.document))}; targetConnected=${find()?.isConnected}`);
  }

  /** Activate an actual control only after keyboard traversal reaches it. @param window Native owner. @param root Live scope. @param action Semantic button action. @returns Trusted Space activation completed. */
  async action(window: TestWindow, root: HTMLElement, action: string): Promise<void> {
    await this.tabTo(window, () => root.querySelector(`[data-rr-action="${action}"]:not(:disabled)`), action);
    await this.key(window, 'space', action);
  }

  /** Replace fixture text using Ctrl+A and actual lowercase native typing. @param window Native owner. @param find Live text control. @param text Lowercase fixture text. @returns Trusted input completion. */
  async text(window: TestWindow, find: () => Element | null, text: string): Promise<void> {
    await this.tabTo(window, find, `text ${text}`);
    await this.keys(window, [{ key: 'a', modifiers: ['Control_L'] }, ...[...text].map(char => ({
      key: char === ' ' ? 'space' : char === '-' ? 'minus' : char, modifiers: [] as const }))], `type ${text}`);
    check((find() as HTMLInputElement).value === text, `Keyboard text mismatch for ${text}`);
  }

  /** Select an actual option by native Home/Down keys and blur to commit its change event. @param window Native owner. @param find Live select control. @param value Exact option value. @returns Actual option is selected and focus advanced. */
  async select(window: TestWindow, find: () => HTMLSelectElement | null, value: string): Promise<void> {
    const control = await this.tabTo(window, find, `select ${value}`) as HTMLSelectElement;
    const index = [...control.options].findIndex(option => option.value === value);
    check(index >= 0 && index < 40, `Missing keyboard option ${value}`);
    await this.keys(window, [{ key: 'Home', modifiers: [] }, ...Array.from({ length: index }, () => ({ key: 'Down', modifiers: [] as const })),
      { key: 'Tab', modifiers: [] }], `select ${value}`);
    check(control.value === value, `Keyboard selection mismatch for ${value}`);
  }

  /** Remove event observers and restore titles; retain only detached diagnostic arrays. @returns No owned native window references remain. */
  dispose(): void {
    for (const [window, state] of this.#windows) {
      for (const type of ['keydown', 'keyup', 'input', 'click']) window.removeEventListener(type, state.record, true);
      if (!window.closed) window.document.title = state.title;
    }
    this.#windows.clear();
  }
}
