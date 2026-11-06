/** Explicit old/new metadata migration forms; existing authority is never modified here. */
import { element, button, metadataText } from './dom.mts';
import { metadataFields } from './metadata-fields.mts';
import { metadataDrafts, readMetadataDraft } from './metadata-draft.mts';
import type { Graph, RelationshipType } from '../domain/contracts.mts';
import type { NativeWindow } from '../adapters/native-contracts.mts';

/**
 * Display original values beside25 typed replacement controls at a time while retaining every logical row as data.
 * Omitted old fields remain visible in the before text until explicit preview/save.
 * @param {object} options {document,window,parent,before,type,onChange}; before is a current graph.
 * @returns {object} {read,dispose}; replacements are detached complete metadata values.
 */
export function migrationForms({ document, window, parent, before, type, onChange }: {
  document: Document; window: NativeWindow; parent: HTMLElement; before: Graph; type: RelationshipType; onChange(): void;
}) {
  const abort = new window.AbortController();
  const assertions = before.assertions.filter(value => value.type === type.id);
  const drafts = metadataDrafts(document, type, assertions.map(value => value.metadata));
  let offset = 0, pageAbort: AbortController | undefined, readers: (() => object)[] = [];
  const root = element(document, 'section', { 'aria-label': 'Review metadata migration' }); parent.append(root);
  root.append(element(document, 'h5', {}, 'Review existing metadata before changing this schema'));
  const old = before.types.find(value => value.id === type.id);
  const body = element(document, 'div'), controls = element(document, 'nav', { 'aria-label': 'Metadata migration pages' });
  const previous = button(document, 'Previous', 'migration-previous', () => { offset -= 25; render(); }, abort.signal);
  const next = button(document, 'Next', 'migration-next', () => { offset += 25; render(); }, abort.signal);
  const status = element(document, 'span', { role: 'status', 'aria-live': 'polite' });
  controls.append(previous, status, next); controls.hidden = assertions.length <= 25; root.append(body, controls);
  /** Retain native programmatic changes as well as input events without marking navigation as an edit. @returns Completion. */
  function capture(): void { for (const read of readers) read(); }
  /** Replace one bounded page after capturing live inputs and retiring its native listeners. @returns Completion. */
  function render(): void {
    capture(); if (pageAbort) pageAbort.abort(); pageAbort = new window.AbortController(); readers = []; body.replaceChildren();
    previous.disabled = offset === 0; next.disabled = offset + 25 >= assertions.length;
    status.textContent = assertions.length ? `${offset + 1}–${Math.min(offset + 25, assertions.length)} of ${assertions.length}` : '0 of 0';
    for (let index = offset; index < Math.min(offset + 25, assertions.length); index++) {
      const assertion = assertions[index], row = element(document, 'fieldset', { 'data-rr-migration-id': assertion.id }); body.append(row);
      row.append(element(document, 'legend', {}, `${assertion.source.key} → ${assertion.target.key}`),
        element(document, 'p', {}, `Before: ${metadataText(assertion.metadata, old!)}`));
      readers.push(metadataFields({ document, parent: row, type, metadata: assertion.metadata, draft: drafts[index], signal: pageAbort.signal, onChange }));
    }
  }
  render();
  if (assertions.length === 0) root.append(element(document, 'p', {}, 'There are no existing values to migrate. Preview still reviews the schema change.'));
  return {
    /** Return complete typed replacement metadata for explicit review. @returns {object[]} {id,metadata} entries. */
    read() { capture(); return assertions.map(({ id }, index) => ({ id, metadata: readMetadataDraft(type, drafts[index]) })); },
    /** Release every owned migration control/listener. @returns {void} */
    dispose() { abort.abort(); if (pageAbort) pageAbort.abort(); root.remove(); },
  };
}
