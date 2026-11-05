/** Namespaced, inert HTML controls for native Zotero pane documents. */
import type { Metadata, RelationshipType } from '../domain/contracts.mts';

let sequence = 0;

/** Create owned HTML without parsing user markup. @param {Document} document Owner. @param {string} tag HTML tag. @param {object} attributes Exact attributes. @param {string|undefined} text Optional literal text. @returns {Element} New node. */
export function element<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K, attributes: Record<string, string | number | boolean> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/1999/xhtml', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node as HTMLElementTagNameMap[K];
}

/** Allocate a unique namespaced control ID. @returns {string} ID unique within this runtime. */
export function controlID() { sequence++; return `reference-relationships-control-${sequence}`; }

/** Create a real action button with abortable ownership. @param {Document} document Owner. @param {string} text Label. @param {string} action Semantic action. @param {Function} callback Native event handler. @param {AbortSignal} signal Listener lifetime. @returns {HTMLButtonElement} Button. */
export function button(document: Document, text: string, action: string, callback: EventListener, signal: AbortSignal): HTMLButtonElement {
  const node = element(document, 'button', { type: 'button', 'data-rr-action': action }, text);
  node.addEventListener('click', callback, { signal });
  return node;
}

/** Format validated primitive metadata as literal human-readable text. @param {object} metadata Typed values. @param {object} type Type field catalog. @returns {string} Display text. */
export function metadataText(metadata: Metadata, type: RelationshipType): string {
  return type.fields.filter(field => Object.hasOwn(metadata, field.id))
    .map(field => `${field.label}: ${String(metadata[field.id])}`).join(' · ');
}
