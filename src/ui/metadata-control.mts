/** Shared native typed controls keep visible and offscreen migration sanitization identical. */
import { element } from './dom.mts';
import type { MetadataField } from '../domain/contracts.mts';

/** Editable native metadata widget, independent of its label, draft or listener owner. */
export type MetadataControl = HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement;

/** Construct an actual native widget with the existing field-kind constraints and choices. @param document Owner. @param field Declared metadata kind. @param attributes Widget attributes. @returns Detached control whose value setter applies the native kind's sanitization. */
export function metadataControl(document: Document, field: MetadataField, attributes: Record<string, string> = {}): MetadataControl {
  const select = field.kind === 'boolean' || field.kind === 'enum';
  const control = element(document, select ? 'select' : field.kind === 'string' ? 'textarea' : 'input', attributes);
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
  return control;
}
