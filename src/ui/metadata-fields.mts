/** Typed metadata entry with explicit absence, empty-string and false-value semantics. */
import { element, controlID } from './dom.mts';
import type { Metadata, MetadataField, RelationshipType } from '../domain/contracts.mts';

/**
 * Render actual schema-driven form controls while preserving optional missing values.
 * Typing text makes an optional field present, even for an intentional empty string;
 * Remove value explicitly unsets it. Other empty controls represent absence.
 * @param {object} options {document,parent,type,metadata,signal,onChange}.
 * @returns {Function} Read only current present typed values, without persistence.
 */
export function metadataFields({ document, parent, type, metadata, signal, onChange }: {
  document: Document; parent: HTMLElement; type: Pick<RelationshipType, 'fields'>; metadata: Metadata; signal: AbortSignal; onChange(): void;
}): () => Metadata {
  const controls: { field: MetadataField; control: HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement; isPresent(): boolean }[] = [];
  for (const field of type.fields) {
    const id = controlID(), wrapper = element(document, 'div');
    wrapper.style.cssText = 'display:grid;gap:4px;margin-block:8px';
    wrapper.append(element(document, 'label', { for: id }, `${field.label}${field.required ? ' (required)' : ' (optional)'}`));
    const select = ['boolean', 'enum'].includes(field.kind);
    const control = element(document, select ? 'select' : field.kind === 'string' ? 'textarea' : 'input',
      { id, 'data-rr-field': field.id });
    if (select) {
      control.append(element(document, 'option', { value: '' }, 'Not set'));
      for (const value of field.kind === 'boolean' ? ['true', 'false'] : field.options) {
        control.append(element(document, 'option', { value }, field.kind === 'boolean' ? value === 'true' ? 'Yes' : 'No' : value));
      }
    } else if (field.kind !== 'string') {
      const input = control as HTMLInputElement;
      input.type = field.kind === 'number' ? 'number' : 'date';
      if (field.kind === 'number') { input.step = 'any'; input.min = '-1000000000000'; input.max = '1000000000000'; }
    } else { const textarea = control as HTMLTextAreaElement; textarea.rows = 3; textarea.maxLength = 2048; }
    let present = field.required || Object.hasOwn(metadata, field.id);
    control.value = Object.hasOwn(metadata, field.id) ? String(metadata[field.id]) : '';
    control.style.cssText = 'box-sizing:border-box;max-width:100%;font:inherit';
    const remove = element(document, 'button', { type: 'button', 'aria-label': `Remove ${field.label} value` }, 'Remove value');
    remove.hidden = field.required; remove.disabled = !present;
    /** Mark an actual user edit and invalidate its previous review. @returns {void} */
    function changed() { present = field.kind === 'string' || control.value !== ''; remove.disabled = !present; onChange(); }
    control.addEventListener('input', changed, { signal });
    control.addEventListener('change', changed, { signal });
    remove.addEventListener('click', () => { present = false; control.value = ''; remove.disabled = true; onChange(); }, { signal });
    wrapper.append(control, remove); parent.append(wrapper);
    controls.push({ field, control, isPresent: () => present });
  }
  /** Collect current typed primitives; domain validation owns all limits and requirements. @returns {object} Metadata. */
  return function readMetadata() {
    const metadata: Metadata = {};
    for (const { field, control, isPresent } of controls) {
      if (!isPresent() || (field.kind !== 'string' && control.value === '')) continue;
      metadata[field.id] = field.kind === 'number' ? Number(control.value)
        : field.kind === 'boolean' ? control.value === 'true' : control.value;
    }
    return metadata;
  };
}
