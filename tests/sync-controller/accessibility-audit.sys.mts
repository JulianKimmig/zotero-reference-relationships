/** Observe the real Gecko accessibility tree and events during the OS keyboard workflow without changing product controls. */
import type { NativeAPI } from './native-api.mts';
import type { AccessibilityObserver, NativeAccessibleEvent, NativeAccessibilityService } from './accessibility-contracts.mts';
import type { AccessibleControlEvidence, AccessibleAlertEvidence } from './accessibility-evidence.sys.mts';
import { validateAccessiblePanel, validateAccessibleAlert } from './accessibility-evidence.sys.mts';
import { check, until } from './ui-helpers.sys.mts';

/** Own the exact observer lifetime and retain detached evidence only. */
export class NativeAccessibilityAudit implements AccessibilityObserver {
  readonly panels: { label: string; controls: AccessibleControlEvidence[] }[] = [];
  readonly events: (AccessibleAlertEvidence & { fromUserInput: boolean })[] = [];
  readonly focus: { label: string; name: string; nativeFocused: boolean }[] = [];
  readonly errors: string[] = [];
  readonly service: NativeAccessibilityService;
  #disposed = false;
  /** Start the actual accessibility service and register one exact native event observer. @param api Actual controller resources, never substitutes. */
  constructor(readonly api: NativeAPI) {
    const { Components, Services } = api;
    this.service = Components.classes['@mozilla.org/accessibilityService;1'].getService(Components.interfaces.nsIAccessibilityService);
    check(typeof this.service.getAccessibleFor === 'function' && typeof this.service.getStringEventType === 'function', 'Native accessibility APIs unavailable');
    check(typeof Components.interfaces.nsIAccessibleEvent.EVENT_ALERT === 'number'
      && typeof Components.interfaces.nsIAccessibleStates.STATE_FOCUSED === 'number', 'Native accessibility constants unavailable');
    this.service.getApplicationAccessible();
    Services.obs.addObserver(this, 'accessible-event');
  }

  /** Capture actual plugin-owned native event targets while reporting observer failures explicitly. @param subject Real accessible-event subject. @param topic Actual observer topic. @param data Native auxiliary string, unused by this event interface. @returns Detached event evidence only; no control actions or event synthesis. */
  observe(subject: Parameters<AccessibilityObserver['observe']>[0], topic: string, data: string | null): void {
    try {
      check(topic === 'accessible-event' && !this.#disposed, 'Unexpected accessibility observer lifetime/topic');
      const event: NativeAccessibleEvent = subject.QueryInterface(this.api.Components.interfaces.nsIAccessibleEvent), node = event.DOMNode;
      const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
      if (!element?.isConnected || !element.closest('[data-rr-pane],[data-rr-preferences]')) return;
      const alert = element.closest('[role="alert"]'), accessible = alert ? this.service.getAccessibleFor(alert) : null;
      const constants = this.api.Components.interfaces.nsIAccessibleEvent;
      this.events.push({ type: this.service.getStringEventType(event.eventType), fromUserInput: event.isFromUserInput,
        isNativeAlert: event.eventType === constants.EVENT_ALERT || event.eventType === constants.EVENT_ANNOUNCEMENT,
        alertText: alert?.textContent ?? null, nativeRole: accessible ? this.service.getStringRole(accessible.role) : null });
    } catch (error) { this.errors.push(error instanceof Error ? error.message : String(error)); }
  }

  /** Wait for actual document accessibility initialization without assigning DOM attributes or native state. @param document Current actual native document. @returns A live native document accessible is available. */
  async ready(document: Document): Promise<void> {
    await until(this.api.Zotero, () => this.service.getAccessibleFor(document), 'native document accessible');
    this.healthy();
  }

  /** Inspect every visible form control and require explicit critical names. @param label Workflow stage. @param root Actual product panel. @param required Semantic keys mapped to selector/expected name. @returns Named native role snapshots retained for review. */
  async capture(label: string, root: HTMLElement, required: Record<string, readonly [string, string]>): Promise<void> {
    const controls = [...root.querySelectorAll<HTMLElement>('button,input,select,textarea')]
      .filter(node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
    const expected = Object.fromEntries(Object.entries(required).map(([key, [, name]]) => [key, name]));
    const snapshots: AccessibleControlEvidence[] = [];
    for (let index = 0; index < controls.length; index++) {
      const node = controls[index], accessible = await until(this.api.Zotero, () => this.service.getAccessibleFor(node), `accessible control ${label}/${index}`);
      const key = Object.entries(required).find(([, [selector]]) => root.querySelector(selector) === node)?.[0] ?? `other:${index}`;
      snapshots.push({ key, name: accessible.name, role: this.service.getStringRole(accessible.role) });
    }
    this.panels.push({ label, controls: snapshots });
    this.healthy(); validateAccessiblePanel(snapshots, expected);
  }

  /** Require real native focused state for the expected control reached by the OS workflow. @param label Workflow transition. @param node Actual current focus target. @returns Native name and focused flag retained, with no focus assignment. */
  async focused(label: string, node: Element): Promise<void> {
    const accessible = await until(this.api.Zotero, () => this.service.getAccessibleFor(node), `${label} focused accessible`);
    const state = { value: 0 }, extra = { value: 0 }; accessible.getState(state, extra);
    const evidence = { label, name: accessible.name, nativeFocused: !!(state.value & this.api.Components.interfaces.nsIAccessibleStates.STATE_FOCUSED) };
    this.focus.push(evidence); this.healthy(); check(evidence.nativeFocused, `Native accessible focus missing for ${label}`);
  }

  /** Await an actual native alert carrying the displayed error; text-inserted events alone cannot pass. @param message Expected validation failure. @returns Native alert evidence accepted or bounded failure. */
  async alert(message: string): Promise<void> {
    await until(this.api.Zotero, () => { this.healthy(); return this.events.some(event => event.isNativeAlert && event.nativeRole === 'alert' && event.alertText?.includes(message)); }, `native accessible alert ${message}`);
    validateAccessibleAlert(this.events, message);
  }

  /** Fail explicitly on callback errors that native observer dispatch would otherwise report asynchronously. @returns Throws if any observer operation failed. */
  healthy(): void { check(this.errors.length === 0, `Accessibility observer failures: ${this.errors.join('; ')}`); }

  /** Remove the exact registered observer once; no window or control references are retained in evidence. @returns Native event delivery to this owner is stopped. */
  dispose(): void {
    if (this.#disposed) return;
    this.api.Services.obs.removeObserver(this, 'accessible-event'); this.#disposed = true;
  }
}
