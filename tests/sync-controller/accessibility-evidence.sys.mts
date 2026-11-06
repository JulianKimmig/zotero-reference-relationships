/** Pure acceptance of native accessibility snapshots; markup and text changes cannot substitute for missing native evidence. */
import { check } from './ui-helpers.sys.mts';

/** Detached native names and roles for one actual visible control. */
export interface AccessibleControlEvidence { key: string; name: string | null; role: string }
/** Detached native events preserve their real event kind and owning alert role/text. */
export interface AccessibleAlertEvidence { type: string; isNativeAlert: boolean; nativeRole: string | null; alertText: string | null }

/** Require named roles for all controls and exact expected labels on critical fields/actions. @param controls Actual native snapshots. @param expected Required semantic control names. @returns Throws for missing/duplicate/unnamed/mislabeled accessibility evidence. */
export function validateAccessiblePanel(controls: AccessibleControlEvidence[], expected: Record<string, string>): void {
  check(new Set(controls.map(control => control.key)).size === controls.length, 'Duplicate accessible control identity');
  for (const control of controls) check(typeof control.name === 'string' && control.name.trim().length > 0 && control.role.trim().length > 0, `Unnamed accessible control ${control.key}`);
  for (const [key, name] of Object.entries(expected)) {
    check(controls.some(control => control.key === key && control.name === name), `Missing or mislabeled accessible control ${key}`);
  }
}

/** Accept an actual native alert carrying this validation failure, rather than merely matching changed text. @param events Observed native accessible-event records. @param message Expected plain-language error. @returns Throws unless the actual accessibility alert pipeline emitted the expected error. */
export function validateAccessibleAlert(events: AccessibleAlertEvidence[], message: string): void {
  check(events.some(event => event.isNativeAlert && event.nativeRole === 'alert' && event.alertText?.includes(message)),
    `Missing native accessible alert for ${message}`);
}
