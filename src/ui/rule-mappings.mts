/** Explicit output-field mapping from immutable root fields or typed constants. */
import { check } from '../domain/values.mts';
import { element } from './dom.mts';
import { metadataFields } from './metadata-fields.mts';
import { ruleControl } from './rule-controls.mts';
import type { MappingExpression, Metadata, MetadataField, RelationshipType } from '../domain/contracts.mts';
import type { NativeWindow } from '../adapters/native-contracts.mts';
import type { Localizer } from './contracts.mts';

/** Check a root field can satisfy every possible output value and required presence. @param {object} source Root field. @param {object} target Output field. @returns {boolean} Compatible mapping. */
function compatible(source: MetadataField, target: MetadataField): boolean {
  return source.kind === target.kind && (!target.required || source.required)
    && (source.kind !== 'enum' || source.options.every(value => target.options.includes(value)));
}

/** Render one explicit mapping mode per output field; changing the root/output resets these controls. @param {object} options {document,window,parent,root,output,mapping,t,onChange}. @returns {object} read/dispose controls. */
export function ruleMappings({ document, window, parent, root, output, mapping, t, onChange }: {
  document: Document; window: NativeWindow; parent: HTMLElement; root: RelationshipType | undefined;
  output: RelationshipType | undefined; mapping: Record<string, MappingExpression>; t: Localizer; onChange(): void;
}) {
  const abort = new window.AbortController(), rows: { field: MetadataField; mode: HTMLSelectElement;
    source(): HTMLSelectElement | null; values(): Metadata | undefined; dispose(): void }[] = [];
  parent.replaceChildren(element(document, 'h3', {}, t('mappings')));
  for (const field of output?.fields ?? []) {
    const row = element(document, 'fieldset', { 'data-rr-mapping': field.id });
    row.append(element(document, 'legend', {}, `${field.label} (${field.id})`)); parent.append(row);
    const expression = mapping[field.id], signal = abort.signal;
    const mode = ruleControl({ document, parent: row, label: t('mappings'), name: `mapping-${field.id}`,
      value: expression?.kind ?? 'omit', choices: ['omit', 'root', 'constant'].map(key => [key, t(key)]), signal, onChange });
    mode.setAttribute('data-rr-map-mode', field.id);
    const body = element(document, 'div'); row.append(body);
    let lifetime: AbortController, source: HTMLSelectElement | null, values: (() => Metadata) | null;
    /** Build only the explicitly selected root/constant value control. @param {object|undefined} existing Initial mapping expression or reset. @returns {void} */
    function render(existing: MappingExpression | undefined): void {
      if (lifetime) lifetime.abort(); lifetime = new window.AbortController(); body.replaceChildren(); source = null; values = null;
      const signal = lifetime.signal;
      if (mode.value === 'root') {
        source = ruleControl({ document, parent: body, label: t('root'), name: `root-${field.id}`, value: existing?.kind === 'root' ? existing.field : '',
          choices: [['', t('choose')], ...(root?.fields ?? []).filter(value => compatible(value, field)).map(value => [value.id, `${value.label} (${value.id})`] as const)], signal, onChange });
        source.setAttribute('data-rr-map-root', field.id);
      } else if (mode.value === 'constant') {
        values = metadataFields({ document, parent: body, type: { fields: [{ ...field, required: true }] },
          metadata: existing?.kind === 'constant' ? { [field.id]: existing.value } : {}, signal, onChange });
      }
    }
    mode.addEventListener('change', () => render(undefined), { signal }); render(expression);
    rows.push({ field, mode, source: () => source, values: () => values?.(), dispose: () => lifetime.abort() });
  }
  /** Read only explicit mapping choices; absent constants/field selections fail instead of coercion. @returns {object} Output mapping. */
  function read(): Record<string, MappingExpression> {
    const mapping: Record<string, MappingExpression> = {};
    for (const row of rows) {
      const id = row.field.id;
      if (row.mode.value === 'omit') continue;
      if (row.mode.value === 'root') {
        check(!!row.source()?.value, 'Select a compatible root metadata field');
        mapping[id] = { kind: 'root', field: row.source()!.value };
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
