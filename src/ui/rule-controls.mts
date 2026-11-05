/** Localized, associated controls shared by declarative rule forms. */
import { check } from '../domain/values.mts';
import { element, controlID, button } from './dom.mts';
import type { NativeDocument } from '../adapters/native-contracts.mts';
import type { ControlOwner, Localizer } from './contracts.mts';

/** Exact options for an associated text field or explicit choice selector. */
interface RuleControlOptions {
  document: Document; parent: HTMLElement; label: string; name: string; value?: string;
  choices?: readonly (readonly [string, string])[] | null; signal: AbortSignal; onChange: EventListener;
}

const keys = ['library', 'new', 'edit', 'delete', 'id', 'enabled', 'root-type', 'input-type', 'output-type',
  'transform', 'same', 'reverse', 'choose', 'conditions', 'add-condition', 'remove-condition', 'field', 'operator',
  'eq', 'ne', 'exists', 'no-fields', 'mappings', 'omit', 'root', 'constant', 'preview', 'save', 'cancel',
  'before', 'after', 'added', 'updated', 'removed', 'previous', 'next', 'no-changes', 'language', 'reset',
  'read-only', 'empty', 'support', 'manual', 'version', 'explain', 'manage', 'root-assertion', 'delete-help', 'retired',
  'repair', 'originals', 'conflicted-before', 'complete-after', 'contribution', 'edit-original', 'remove-original',
  'close-repairs', 'stale-repairs', 'no-originals', 'original-keys', 'choose-contribution', 'conflict-field', 'unresolved-before',
  'select-original', 'remove-selected', 'confirm-removals', 'unavailable', 'library-unavailable'];

/** Resolve required Fluent messages without substituting untranslated defaults. @param {Document} document Native localized document. @returns {Promise<Function>} Synchronous label lookup. */
export async function ruleLabels(document: NativeDocument): Promise<Localizer> {
  const messages = await document.l10n.formatMessages(keys.map(key => ({ id: `reference-relationships-rule-${key}` })));
  const labels = new Map<string, string>();
  messages.forEach((message, index) => {
    check(typeof message?.value === 'string' && message.value.length > 0, `Missing rule label ${keys[index]}`);
    labels.set(keys[index], message.value);
  });
  return key => { check(labels.has(key), `Unknown rule label ${key}`); return labels.get(key)!; };
}

/** Build a choice selector. @param options Explicit choice values. @returns Native HTML select. */
export function ruleControl(options: RuleControlOptions & { choices: readonly (readonly [string, string])[] }): HTMLSelectElement;
/** Build a text input. @param options Text field options. @returns Native HTML input. */
export function ruleControl(options: RuleControlOptions & { choices?: null }): HTMLInputElement;

/** Render a label-associated input/select with explicit choices and listener ownership. @param {object} options {document,parent,label,name,value,choices,signal,onChange}; choices null means text input. @returns {Element} Actual control. */
export function ruleControl({ document, parent, label, name, value = '', choices = null, signal, onChange }: RuleControlOptions): HTMLInputElement | HTMLSelectElement {
  const id = controlID(), wrapper = element(document, 'div');
  wrapper.style.cssText = 'display:grid;gap:4px;margin-block:6px';
  const control = element(document, choices ? 'select' : 'input', { id, 'data-rr-rule-field': name });
  if (choices) for (const [value, text] of choices) control.append(element(document, 'option', { value }, text));
  else (control as HTMLInputElement).type = 'text';
  control.value = value;
  control.addEventListener('input', onChange, { signal });
  control.addEventListener('change', onChange, { signal });
  wrapper.append(element(document, 'label', { for: id }, label), control); parent.append(wrapper);
  return control;
}

/** Create a localized owned action using resolved labels. @param {object} owner {document,t,signal}. @param {string} key Label key. @param {string} action Stable action. @param {Function} callback Handler. @returns {Element} Button. */
export function ruleButton({ document, t, signal }: ControlOwner, key: string, action: string, callback: EventListener): HTMLButtonElement {
  return button(document, t(key), action, callback, signal);
}
