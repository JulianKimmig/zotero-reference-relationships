/** Narrow native accessibility interfaces verified against Gecko IDLs and checked at runtime before the audit. */
/** Accessible objects expose native names, roles and state flags without invoking actions. */
export interface NativeAccessible {
  name: string | null; role: number;
  getState(state: { value: number }, extra: { value: number }): void;
}
/** The real in-process accessibility service owns the accessible tree and native event names. */
export interface NativeAccessibilityService {
  getApplicationAccessible(): NativeAccessible;
  getAccessibleFor(node: Node): NativeAccessible | null;
  getStringRole(role: number): string;
  getStringEventType(type: number): string;
  getConsumers(): string;
}
/** Actual Gecko accessible-event subjects are queried through their native interface. */
export interface NativeAccessibleEvent {
  eventType: number; DOMNode: Node | null; isFromUserInput: boolean;
}
/** Only the accessibility service class and interfaces are added to existing controller capabilities. */
export interface NativeTestComponents {
  classes: { '@mozilla.org/accessibilityService;1': { getService(iid: object): NativeAccessibilityService } };
  interfaces: { nsIResProtocolHandler: object; nsIAccessibilityService: object;
    nsIAccessibleEvent: { EVENT_ALERT: number; EVENT_FOCUS: number; EVENT_ANNOUNCEMENT: number };
    nsIAccessibleStates: { STATE_FOCUSED: number } };
}
/** Actual observer registration owns exactly one accessible-event subscription. */
export interface AccessibilityObserver {
  observe(subject: { QueryInterface(iid: object): NativeAccessibleEvent }, topic: string, data: string | null): void;
}
