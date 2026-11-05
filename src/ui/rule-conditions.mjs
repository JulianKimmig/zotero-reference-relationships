/** Root-only AND conditions with typed primitive values and explicit presence predicates. */
import { check } from '../domain/values.mjs';
import { element } from './dom.mjs';
import { metadataFields } from './metadata-fields.mjs';
import { ruleControl, ruleButton } from './rule-controls.mjs';

/** Own one root schema's bounded predicate list; replacing the root discards dependent predicates. @param {object} options {document,window,parent,root,conditions,t,onChange}. @returns {object} read/dispose controls. */
export function ruleConditions({ document, window, parent, root, conditions, t, onChange }) {
  const abort = new window.AbortController(), rows = [], fields = root ? root.fields : [];
  const owner = { document, t, signal: abort.signal };
  parent.replaceChildren(element(document, 'h3', {}, t('conditions')));

  /** Add one actual typed predicate without inventing a selected field. @param {object|null} condition Existing predicate or blank. @returns {void} */
  function add(condition) {
    check(rows.length < 16, 'Predicate count exceeds the v1 limit', 'limit');
    const lifetime = new window.AbortController(), row = element(document, 'fieldset', { 'data-rr-condition': '' });
    const signal = lifetime.signal;
    const field = ruleControl({ document, parent: row, label: t('field'), name: 'condition-field',
      value: condition?.field ?? '', choices: [['', t('choose')], ...fields.map(field => [field.id, `${field.label} (${field.id})`])], signal, onChange });
    field.setAttribute('data-rr-condition-field', '');
    const op = ruleControl({ document, parent: row, label: t('operator'), name: 'condition-op',
      value: condition?.op ?? 'eq', choices: ['eq', 'ne', 'exists'].map(key => [key, t(key)]), signal, onChange });
    op.setAttribute('data-rr-condition-op', '');
    const body = element(document, 'div'); row.append(body);
    let values, typed;
    /** Rebuild a changed predicate's value controls with their own listener lifetime. @param {object|null} existing Initial predicate or explicit reset. @returns {void} */
    function renderValue(existing) {
      if (typed) typed.abort(); typed = new window.AbortController(); body.replaceChildren(); values = null;
      const definition = fields.find(candidate => candidate.id === field.value);
      if (!definition) return;
      const target = op.value === 'exists' ? { id: definition.id, label: definition.label, kind: 'boolean', required: true, options: [] }
        : { ...definition, required: true };
      const metadata = existing ? { [target.id]: existing.value } : {};
      values = metadataFields({ document, parent: body, type: { fields: [target] }, metadata, signal: typed.signal, onChange });
    }
    field.addEventListener('change', () => renderValue(null), { signal });
    op.addEventListener('change', () => renderValue(null), { signal });
    const record = { row, field, op, read: () => values?.(), dispose: () => { lifetime.abort(); if (typed) typed.abort(); row.remove(); } };
    row.append(ruleButton({ document, t, signal }, 'remove-condition', 'remove-condition', () => {
      record.dispose(); rows.splice(rows.indexOf(record), 1); addButton.disabled = fields.length === 0; onChange();
    }));
    rows.push(record); parent.insertBefore(row, addButton); renderValue(condition);
    addButton.disabled = rows.length >= 16 || fields.length === 0;
  }
  const addButton = ruleButton(owner, 'add-condition', 'add-condition', () => { add(null); onChange(); });
  addButton.disabled = fields.length === 0; parent.append(addButton);
  if (!fields.length) parent.append(element(document, 'p', {}, t('no-fields')));
  for (const condition of conditions) add(condition);

  /** Read exact predicates, retaining false/zero/empty text while rejecting absent typed values. @returns {object[]} Predicates. */
  function read() {
    return rows.map(({ field, op, read }) => {
      const metadata = read();
      check(!!metadata && Object.hasOwn(metadata, field.value), 'Select a root field and enter a condition value');
      return { field: field.value, op: op.value, value: metadata[field.value] };
    });
  }
  /** Release predicate rows and listener ownership. @returns {void} */
  function dispose() { abort.abort(); for (const row of rows) row.dispose(); parent.replaceChildren(); }
  return { read, dispose };
}
