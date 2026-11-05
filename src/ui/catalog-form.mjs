/** Owned stable-ID catalog definition controls, separated from review and persistence. */
import { element, button, controlID } from './dom.mjs';

/** Render one labeled text/select/checkbox control. @param {object} options {document,parent,name,label,value,kind,signal,onChange,attribute}. @returns {Element} Owned control. */
function control({ document, parent, name, label, value, kind = 'input', signal, onChange, attribute }) {
  const id = controlID(), node = element(document, kind, { id, [attribute]: name });
  if (kind === 'input' && typeof value === 'boolean') { node.type = 'checkbox'; node.checked = value; }
  else node.value = value;
  parent.append(element(document, 'label', { for: id }, label), node);
  node.addEventListener('input', onChange, { signal }); node.addEventListener('change', onChange, { signal });
  return node;
}

/**
 * Build editable type fields with immutable existing type/field identities.
 * @param {object} options {document,window,parent,type|null,onChange}.
 * @returns {object} {read,dispose}; read returns the exact version-free command type.
 */
export function catalogForm({ document, window, parent, type, onChange }) {
  const abort = new window.AbortController(), rows = [];
  const root = element(document, 'div'); root.style.cssText = 'display:grid;gap:6px'; parent.append(root);
  /** Render an owned top-level definition value. @param {string} name Field name. @param {string} label User label. @param {*} value Initial primitive. @param {string} kind Tag. @returns {Element} Control. */
  function top(name, label, value, kind = 'input') {
    return control({ document, parent: root, name, label, value, kind, signal: abort.signal, onChange, attribute: 'data-rr-catalog-field' });
  }
  const id = top('id', 'Stable type ID', type ? type.id : ''); id.readOnly = !!type;
  const label = top('label', 'Type label', type ? type.label : '');
  const description = top('description', 'Description', type ? type.description : '', 'textarea');
  const retired = top('retired', 'Retired (keep existing relationships)', type ? type.retired : false);
  const fields = element(document, 'div'); root.append(fields);
  const existing = new Set(type ? type.fields.map(field => field.id) : []);

  /** Add one owned field schema row and its removable listener lifetime. @param {object} field Exact definition. @returns {void} */
  function add(field) {
    const lifetime = new window.AbortController(), row = element(document, 'fieldset', { 'data-rr-field-definition': '' });
    row.style.cssText = 'display:grid;gap:6px;min-width:0'; fields.append(row);
    /** Render a labeled owned field control. @param {string} name Schema field. @param {string} label User label. @param {*} value Initial primitive. @param {string} kind Tag. @returns {Element} Control. */
    function entry(name, label, value, kind = 'input') {
      return control({ document, parent: row, name, label, value, kind, signal: lifetime.signal, onChange, attribute: 'data-rr-definition' });
    }
    const id = entry('id', 'Stable field ID', field.id); id.readOnly = existing.has(field.id);
    const label = entry('label', 'Field label', field.label), kind = entry('kind', 'Value kind', '', 'select');
    for (const value of ['string', 'number', 'boolean', 'date', 'enum']) kind.append(element(document, 'option', { value }, value));
    kind.value = field.kind;
    const required = entry('required', 'Required value', field.required);
    const options = entry('options', 'Enum options (one per line; no empty lines)', field.options.join('\n'), 'textarea');
    /** Show only applicable enum editing without losing a draft when toggling kind. @returns {void} */
    function visibility() { options.disabled = kind.value !== 'enum'; }
    kind.addEventListener('change', visibility, { signal: lifetime.signal }); visibility();
    const model = { row, lifetime,
      /** Read exact current field values; domain validation owns constraints. @returns {object} Schema field. */
      read() { return { id: id.value, label: label.value, kind: kind.value, required: required.checked, options: kind.value === 'enum' ? options.value.split('\n') : [] }; },
    };
    row.append(button(document, 'Remove field', 'remove-field', () => {
      lifetime.abort(); row.remove(); rows.splice(rows.indexOf(model), 1); onChange();
    }, lifetime.signal));
    rows.push(model);
  }
  for (const field of type ? type.fields : []) add(field);
  root.append(button(document, 'Add metadata field', 'add-field', () => {
    add({ id: '', label: '', kind: 'string', required: false, options: [] }); onChange();
  }, abort.signal));
  return {
    /** Read only current visible definition values without versions or writes. @returns {object} Exact command type. */
    read() { return { id: id.value, label: label.value, description: description.value, retired: retired.checked, fields: rows.map(row => row.read()) }; },
    /** Release owned controls/listeners and all removed-row lifetimes. @returns {void} */
    dispose() { abort.abort(); for (const row of rows) row.lifetime.abort(); root.remove(); },
  };
}
