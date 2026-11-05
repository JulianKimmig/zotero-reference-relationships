/** Explicit output-field mapping from immutable root fields or typed constants. */
import { check } from '../domain/values.mjs';
import { element } from './dom.mjs';
import { metadataFields } from './metadata-fields.mjs';
import { ruleControl } from './rule-controls.mjs';

/** Check a root field can satisfy every possible output value and required presence. @param {object} source Root field. @param {object} target Output field. @returns {boolean} Compatible mapping. */
function compatible(source, target) {
  return source.kind === target.kind && (!target.required || source.required)
    && (source.kind !== 'enum' || source.options.every(value => target.options.includes(value)));
}

/** Render one explicit mapping mode per output field; changing the root/output resets these controls. @param {object} options {document,window,parent,root,output,mapping,t,onChange}. @returns {object} read/dispose controls. */
export function ruleMappings({ document, window, parent, root, output, mapping, t, onChange }) {
  const abort = new window.AbortController(), rows = [];
  parent.replaceChildren(element(document, 'h3', {}, t('mappings')));
  for (const field of output?.fields ?? []) {
    const row = element(document, 'fieldset', { 'data-rr-mapping': field.id });
    row.append(element(document, 'legend', {}, `${field.label} (${field.id})`)); parent.append(row);
    const expression = mapping[field.id], signal = abort.signal;
    const mode = ruleControl({ document, parent: row, label: t('mappings'), name: `mapping-${field.id}`,
      value: expression?.kind ?? 'omit', choices: ['omit', 'root', 'constant'].map(key => [key, t(key)]), signal, onChange });
    mode.setAttribute('data-rr-map-mode', field.id);
    const body = element(document, 'div'); row.append(body);
    let lifetime, source, values;
    /** Build only the explicitly selected root/constant value control. @param {object|undefined} existing Initial mapping expression or reset. @returns {void} */
    function render(existing) {
      if (lifetime) lifetime.abort(); lifetime = new window.AbortController(); body.replaceChildren(); source = null; values = null;
      const signal = lifetime.signal;
      if (mode.value === 'root') {
        source = ruleControl({ document, parent: body, label: t('root'), name: `root-${field.id}`, value: existing?.field ?? '',
          choices: [['', t('choose')], ...(root?.fields ?? []).filter(value => compatible(value, field)).map(value => [value.id, `${value.label} (${value.id})`])], signal, onChange });
        source.setAttribute('data-rr-map-root', field.id);
      } else if (mode.value === 'constant') {
        values = metadataFields({ document, parent: body, type: { fields: [{ ...field, required: true }] },
          metadata: existing ? { [field.id]: existing.value } : {}, signal, onChange });
      }
    }
    mode.addEventListener('change', () => render(undefined), { signal }); render(expression);
    rows.push({ field, mode, source: () => source, values: () => values?.(), dispose: () => lifetime.abort() });
  }
  /** Read only explicit mapping choices; absent constants/field selections fail instead of coercion. @returns {object} Output mapping. */
  function read() {
    const mapping = {};
    for (const row of rows) {
      const id = row.field.id;
      if (row.mode.value === 'omit') continue;
      if (row.mode.value === 'root') {
        check(!!row.source()?.value, 'Select a compatible root metadata field');
        mapping[id] = { kind: 'root', field: row.source().value };
      } else {
        check(row.mode.value === 'constant', 'Select a supported metadata mapping');
        const metadata = row.values(); check(!!metadata && Object.hasOwn(metadata, id), 'Enter a typed constant value');
        mapping[id] = { kind: 'constant', value: metadata[id] };
      }
    }
    return mapping;
  }
  /** Abort all mode/value controls and release dependent DOM. @returns {void} */
  function dispose() { abort.abort(); for (const row of rows) row.dispose(); parent.replaceChildren(); }
  return { read, dispose };
}
