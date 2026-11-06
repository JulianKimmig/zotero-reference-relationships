/** Typed metadata entry with explicit absence, empty-string and false-value semantics. */
import { element, controlID } from './dom.mts';
import { metadataControl } from './metadata-control.mts';
import type { MetadataControl } from './metadata-control.mts';
import { readMetadataDraft } from './metadata-draft.mts';
import type { MetadataDraft, MetadataValueDraft } from './metadata-draft.mts';
import type { Metadata, RelationshipType } from '../domain/contracts.mts';

/**
 * Render actual schema-driven form controls while preserving optional missing values.
 * Typing text makes an optional field present, even for an intentional empty string;
 * Remove value explicitly unsets it. Other empty controls represent absence.
 * @param {object} options {document,parent,type,metadata,signal,onChange,draft}; optional draft is owned by the migration page model.
 * @returns {Function} Read only current present typed values, without persistence.
 */
export function metadataFields({ document, parent, type, metadata, signal, onChange, draft }: {
  document: Document; parent: HTMLElement; type: Pick<RelationshipType, 'fields'>; metadata: Metadata; signal: AbortSignal; onChange(): void; draft?: MetadataDraft;
}): () => Metadata {
  const values: MetadataDraft = draft ?? {}, controls: { control: MetadataControl; state: MetadataValueDraft }[] = [];
  for (const field of type.fields) {
    const id = controlID(), wrapper = element(document, 'div');
    wrapper.style.cssText = 'display:grid;gap:4px;margin-block:8px';
    wrapper.append(element(document, 'label', { for: id }, `${field.label}${field.required ? ' (required)' : ' (optional)'}`));
    const control = metadataControl(document, field, { id, 'data-rr-field': field.id });
    const state = draft ? draft[field.id] : { present: field.required || Object.hasOwn(metadata, field.id),
      value: Object.hasOwn(metadata, field.id) ? String(metadata[field.id]) : '' };
    control.value = state.value; state.value = control.value; values[field.id] = state;
    control.style.cssText = 'box-sizing:border-box;max-width:100%;font:inherit';
    const remove = element(document, 'button', { type: 'button', 'aria-label': `Remove ${field.label} value` }, 'Remove value');
    remove.hidden = field.required; remove.disabled = !state.present;
    /** Mark an actual user edit and invalidate its previous review. @returns {void} */
    function changed() { state.value = control.value; state.present = field.kind === 'string' || control.value !== ''; remove.disabled = !state.present; onChange(); }
    control.addEventListener('input', changed, { signal });
    control.addEventListener('change', changed, { signal });
    remove.addEventListener('click', () => { state.present = false; state.value = ''; control.value = ''; remove.disabled = true; onChange(); }, { signal });
    wrapper.append(control, remove); parent.append(wrapper);
    controls.push({ control, state });
  }
  /** Collect current typed primitives; domain validation owns all limits and requirements. @returns {object} Metadata. */
  return function readMetadata() {
    for (const { control, state } of controls) state.value = control.value;
    return readMetadataDraft(type, values);
  };
}
