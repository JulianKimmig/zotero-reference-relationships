/** Stable rule identity, type selections and bounded declarative grammar controls. */
import { element, controlID } from './dom.mts';
import { ruleControl } from './rule-controls.mts';
import { ruleConditions } from './rule-conditions.mts';
import { ruleMappings } from './rule-mappings.mts';
import type { RelationshipType, Rule } from '../domain/contracts.mts';
import type { NativeWindow } from '../adapters/native-contracts.mts';
import type { Localizer } from './contracts.mts';

/** Render an editable rule; changing schema selections explicitly discards dependent inputs. @param {object} options {document,window,parent,types,rule,t,onChange}. @returns {object} read/dispose form. */
export function ruleForm({ document, window, parent, types, rule, t, onChange }: {
  document: Document; window: NativeWindow; parent: HTMLElement; types: RelationshipType[]; rule: Rule | null; t: Localizer; onChange(): void;
}) {
  const abort = new window.AbortController(), signal = abort.signal;
  const choices: (readonly [string, string])[] = [['', t('choose')], ...types.map(type => [type.id, `${type.label} (${type.id})${type.retired ? ` · ${t('retired')}` : ''}`] as const)];
  const identity = ruleControl({ document, parent, label: t('id'), name: 'id', value: rule?.id ?? '', signal, onChange });
  identity.readOnly = !!rule;
  const id = controlID();
  const enabled = element(document, 'input', { id, type: 'checkbox', 'data-rr-rule-field': 'enabled' });
  enabled.checked = rule ? rule.enabled : true;
  enabled.addEventListener('change', onChange, { signal });
  parent.append(element(document, 'label', { for: id }, t('enabled')), enabled);
  /** Render an exact type selector without choosing an absent type. @param name Rule property. @param key Label. @returns Choice control. */
  function selection(name: 'rootType' | 'inputType' | 'outputType', key: string): HTMLSelectElement {
    return ruleControl({ document, parent, label: t(key), name, value: rule?.[name] ?? '', choices, signal, onChange });
  }
  const controls = { id: identity, enabled, rootType: selection('rootType', 'root-type'), inputType: selection('inputType', 'input-type'),
    outputType: selection('outputType', 'output-type'), transform: ruleControl({ document, parent, label: t('transform'), name: 'transform', value: rule?.transform ?? 'reverse',
      choices: ['same', 'reverse'].map(key => [key, t(key)] as const), signal, onChange }) };
  const help = element(document, 'p', { role: 'status' });
  const conditionsBody = element(document, 'div'), mappingBody = element(document, 'div');
  parent.append(help, conditionsBody, mappingBody);
  let conditions: ReturnType<typeof ruleConditions>, mappings: ReturnType<typeof ruleMappings>;
  /** Build predicates/mappings for selected actual root and output schemas. @param {boolean} initial Preserve existing definition only on initial mount. @returns {void} */
  function dependents(initial: boolean) {
    if (conditions) conditions.dispose(); if (mappings) mappings.dispose();
    const root = types.find(type => type.id === controls.rootType.value), output = types.find(type => type.id === controls.outputType.value);
    conditions = ruleConditions({ document, window, parent: conditionsBody, root, conditions: initial && rule ? rule.conditions : [], t, onChange });
    mappings = ruleMappings({ document, window, parent: mappingBody, root, output, mapping: initial && rule ? rule.mapping : {}, t, onChange });
    if (!initial) help.textContent = t('reset');
  }
  for (const name of ['rootType', 'outputType'] as const) controls[name].addEventListener('change', () => dependents(false), { signal });
  dependents(true);
  /** Read exactly the editable rule shape, leaving grammar/type/value bounds to domain validation. @returns {object} Versionless declaration. */
  function read(): Omit<Rule, 'version'> {
    return { id: controls.id.value, enabled: controls.enabled.checked, rootType: controls.rootType.value,
      inputType: controls.inputType.value, outputType: controls.outputType.value, transform: controls.transform.value as Rule['transform'],
      conditions: conditions.read(), mapping: mappings.read() };
  }
  /** Release form and schema-dependent listener lifetimes. @returns {void} */
  function dispose() { abort.abort(); conditions.dispose(); mappings.dispose(); parent.replaceChildren(); }
  return { read, dispose };
}
