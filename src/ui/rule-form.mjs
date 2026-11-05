/** Stable rule identity, type selections and bounded declarative grammar controls. */
import { element, controlID } from './dom.mjs';
import { ruleControl } from './rule-controls.mjs';
import { ruleConditions } from './rule-conditions.mjs';
import { ruleMappings } from './rule-mappings.mjs';

/** Render an editable rule; changing schema selections explicitly discards dependent inputs. @param {object} options {document,window,parent,types,rule,t,onChange}. @returns {object} read/dispose form. */
export function ruleForm({ document, window, parent, types, rule, t, onChange }) {
  const abort = new window.AbortController(), signal = abort.signal, controls = {};
  const choices = [['', t('choose')], ...types.map(type => [type.id, `${type.label} (${type.id})${type.retired ? ` · ${t('retired')}` : ''}`])];
  controls.id = ruleControl({ document, parent, label: t('id'), name: 'id', value: rule?.id ?? '', signal, onChange });
  controls.id.readOnly = !!rule;
  const id = controlID();
  controls.enabled = element(document, 'input', { id, type: 'checkbox', 'data-rr-rule-field': 'enabled' });
  controls.enabled.checked = rule ? rule.enabled : true;
  controls.enabled.addEventListener('change', onChange, { signal });
  parent.append(element(document, 'label', { for: id }, t('enabled')), controls.enabled);
  for (const [name, key] of [['rootType', 'root-type'], ['inputType', 'input-type'], ['outputType', 'output-type']]) {
    controls[name] = ruleControl({ document, parent, label: t(key), name, value: rule?.[name] ?? '', choices, signal, onChange });
  }
  controls.transform = ruleControl({ document, parent, label: t('transform'), name: 'transform', value: rule?.transform ?? 'reverse',
    choices: ['same', 'reverse'].map(key => [key, t(key)]), signal, onChange });
  const help = element(document, 'p', { role: 'status' });
  const conditionsBody = element(document, 'div'), mappingBody = element(document, 'div');
  parent.append(help, conditionsBody, mappingBody);
  let conditions, mappings;
  /** Build predicates/mappings for selected actual root and output schemas. @param {boolean} initial Preserve existing definition only on initial mount. @returns {void} */
  function dependents(initial) {
    if (conditions) conditions.dispose(); if (mappings) mappings.dispose();
    const root = types.find(type => type.id === controls.rootType.value), output = types.find(type => type.id === controls.outputType.value);
    conditions = ruleConditions({ document, window, parent: conditionsBody, root, conditions: initial && rule ? rule.conditions : [], t, onChange });
    mappings = ruleMappings({ document, window, parent: mappingBody, root, output, mapping: initial && rule ? rule.mapping : {}, t, onChange });
    if (!initial) help.textContent = t('reset');
  }
  for (const name of ['rootType', 'outputType']) controls[name].addEventListener('change', () => dependents(false), { signal });
  dependents(true);
  /** Read exactly the editable rule shape, leaving grammar/type/value bounds to domain validation. @returns {object} Versionless declaration. */
  function read() {
    return { id: controls.id.value, enabled: controls.enabled.checked, rootType: controls.rootType.value,
      inputType: controls.inputType.value, outputType: controls.outputType.value, transform: controls.transform.value,
      conditions: conditions.read(), mapping: mappings.read() };
  }
  /** Release form and schema-dependent listener lifetimes. @returns {void} */
  function dispose() { abort.abort(); conditions.dispose(); mappings.dispose(); parent.replaceChildren(); }
  return { read, dispose };
}
