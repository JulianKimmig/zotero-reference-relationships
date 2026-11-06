/** Typed native transfer controls and owned accessible labels shared by the panel and its bounded editors. */
import { button, controlID, element } from './dom.mts';
import type { ItemGateway, NativeWindow, ZoteroPlatform } from '../adapters/native-contracts.mts';
import type { RelationshipApplication } from '../application/service.mts';
import type { TransferService } from '../transfer/service.mts';
import type { TransferIdentity } from '../transfer/service-contracts.mts';
import type { TransferFiles } from '../transfer/file-contracts.mts';

/** External dialog port owns only path selection; validation, file I/O and graph mutation remain in their real services. */
export interface TransferPicker {
  /** Choose an input or exclusive new output path. @param {Window} window Actual owner. @param {string} operation Explicit dialog purpose. @returns {Promise<string|null>} Selected path, or cancellation without I/O. */
  choose(window: NativeWindow, operation: 'import' | 'export' | 'backup'): Promise<string | null>;
}
/** Explicit composition keeps native services and preferences lifecycle ownership visible. */
export interface TransferPanelOptions {
  window: NativeWindow; root: HTMLElement; Zotero: ZoteroPlatform; app: RelationshipApplication;
  gateway: ItemGateway; transfer: TransferService; identity: TransferIdentity; files: TransferFiles;
  picker: TransferPicker; report(error: unknown): void;
}
/** Detached complete service evidence; no private token binding is rendered or reconstructed. */
export type ImportInspection = Awaited<ReturnType<TransferService['inspectImport']>>;

/** Create a literal accessible select, using the owner's signal for both input and change events. @param {object} options Native document, parent, label, data attribute, choices and lifetime. @returns {HTMLSelectElement} Owned actual control. */
export function transferSelect({ document, parent, label, attribute, choices, signal, change }: {
  document: Document; parent: HTMLElement; label: string; attribute: string; choices: readonly (readonly [string, string])[];
  signal: AbortSignal; change(): void;
}): HTMLSelectElement {
  const id = controlID(), select = element(document, 'select', { id, [attribute]: '' });
  select.append(...choices.map(([value, title]) => element(document, 'option', { value }, title)));
  parent.append(element(document, 'label', { for: id }, label), select);
  select.addEventListener('input', change, { signal }); select.addEventListener('change', change, { signal }); return select;
}

/** Create an owned literal action with a consistent transfer namespace. @param {Document} document Native owner. @param {string} label Visible accessible name. @param {string} action Semantic suffix. @param {Function} run Action. @param {AbortSignal} signal Owned lifetime. @returns {HTMLButtonElement} Native button. */
export function transferButton(document: Document, label: string, action: string, run: () => void, signal: AbortSignal) {
  return button(document, label, `transfer-${action}`, run, signal);
}

/** Preserve native and domain error messages without assuming cross-compartment prototypes. @param {unknown} error Original rejection. @returns {string} Visible failure details. */
export function transferError(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error);
}
