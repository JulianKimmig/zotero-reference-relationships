/** Explicit old/new metadata migration forms; existing authority is never modified here. */
import { element, metadataText } from './dom.mjs';
import { metadataFields } from './metadata-fields.mjs';

/**
 * Display original values beside typed replacement controls for every affected assertion.
 * Omitted old fields remain visible in the before text until explicit preview/save.
 * @param {object} options {document,window,parent,before,type,onChange}; before is a current graph.
 * @returns {object} {read,dispose}; replacements are detached complete metadata values.
 */
export function migrationForms({ document, window, parent, before, type, onChange }) {
  const abort = new window.AbortController(), readers = [];
  const root = element(document, 'section', { 'aria-label': 'Review metadata migration' }); parent.append(root);
  root.append(element(document, 'h5', {}, 'Review existing metadata before changing this schema'));
  const old = before.types.find(value => value.id === type.id);
  for (const assertion of before.assertions.filter(value => value.type === type.id)) {
    const row = element(document, 'fieldset', { 'data-rr-migration-id': assertion.id }); root.append(row);
    row.append(element(document, 'legend', {}, `${assertion.source.key} → ${assertion.target.key}`),
      element(document, 'p', {}, `Before: ${metadataText(assertion.metadata, old)}`));
    const read = metadataFields({ document, parent: row, type, metadata: assertion.metadata, signal: abort.signal, onChange });
    readers.push({ id: assertion.id, read });
  }
  if (readers.length === 0) root.append(element(document, 'p', {}, 'There are no existing values to migrate. Preview still reviews the schema change.'));
  return {
    /** Return complete typed replacement metadata for explicit review. @returns {object[]} {id,metadata} entries. */
    read() { return readers.map(({ id, read }) => ({ id, metadata: read() })); },
    /** Release every owned migration control/listener. @returns {void} */
    dispose() { abort.abort(); root.remove(); },
  };
}
