/** Actual catalog and typed-metadata control interactions for native acceptance. */
import type { Metadata, MetadataField } from '../../src/domain/contracts.mts';
import { present, readyState } from './evidence.sys.mts';
import type { FormControl } from '../../src/ui/contracts.mts';
import type { TestWindow } from './platform-contracts.mts';
import type { TestItem } from './platform-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { check, until, click, type, chooseTarget } from './ui-helpers.sys.mts';

export const definitions: MetadataField[] = [
  { id: 'text', label: 'Text', kind: 'string', required: true, options: [] },
  { id: 'count', label: 'Count', kind: 'number', required: true, options: [] },
  { id: 'flag', label: 'Flag', kind: 'boolean', required: true, options: [] },
  { id: 'date', label: 'Date', kind: 'date', required: true, options: [] },
  { id: 'choice', label: 'Choice', kind: 'enum', required: true, options: ['é', 'other'] },
  { id: 'spare', label: 'Optional flag', kind: 'boolean', required: false, options: [] },
];
export const values = { text: 'Custom Café 你好 😀 <b>literal</b>', count: 0, flag: false, date: '2000-02-29', choice: 'é' };

/** Set an actual checkbox through a click rather than replacing an implementation. @param {Element} control Checkbox. @param {boolean} checked Wanted state. @returns {void} */
export function checked(control: HTMLInputElement | null, checked: boolean) { check(!!control, 'Checkbox missing'); if (control.checked !== checked) control.click(); }

/** Verify exact typed primitive values independent of JSON property order. @param {object} actual Persisted metadata. @param {object} expected Intended metadata. @returns {void} */
export function metadataEquals(actual: Metadata, expected: Metadata) {
  check(Object.keys(actual).length === Object.keys(expected).length, 'Metadata presence changed');
  for (const [key, value] of Object.entries(expected)) check(actual[key] === value, `Metadata ${key} differs`);
}

/** Open the actual owned catalog editor. @param {object} api Native API. @param {Element} root Pane. @param {string|null} id Existing type or new. @returns {Promise<Element>} Editor. */
export async function openCatalog(api: NativeAPI, root: HTMLElement, id: string|null = null) {
  click(root, 'manage-types');
  const editor = await until(api.Zotero, () => root.querySelector<HTMLElement>('[data-rr-catalog]'), 'catalog editor');
  if (id === null) click(editor, 'new-type');
  else {
    const edit = editor.querySelector<HTMLElement>(`[data-rr-type-id="${id}"]`); check(!!edit, `Catalog type ${id} missing`); edit.click();
  }
  await until(api.Zotero, () => editor.querySelector<HTMLInputElement>('[data-rr-catalog-field="id"]'), 'type definition form');
  return editor;
}

/** Fill one new schema through actual controls. @param {Window} window Owner. @param {Element} editor Catalog editor. @returns {void} */
export function fillDefinition(window: TestWindow, editor: HTMLElement) {
  for (const [name, value] of Object.entries({ id: 'custom', label: 'Custom', description: 'Custom typed relationships' })) {
    type(window, editor.querySelector<FormControl>(`[data-rr-catalog-field="${name}"]`), value);
  }
  for (const field of definitions) {
    click(editor, 'add-field');
    const row = [...editor.querySelectorAll<HTMLElement>('[data-rr-field-definition]')].at(-1);
    for (const name of ['id', 'label', 'kind'] as const) type(window, present(row).querySelector<FormControl>(`[data-rr-definition="${name}"]`), field[name]);
    checked(present(row).querySelector<HTMLInputElement>('[data-rr-definition="required"]'), field.required);
    if (field.kind === 'enum') type(window, present(row).querySelector<FormControl>('[data-rr-definition="options"]'), field.options.join('\n'));
  }
}

/** Preview a catalog change, then explicitly save or cancel. @param {object} api Native resources. @param {Element} root Pane. @param {boolean} save User decision. @returns {Promise<void>} Catalog closed and pane ready. */
export async function finishCatalog(api: NativeAPI, root: HTMLElement, save: boolean) {
  click(root, 'preview-type');
  await until(api.Zotero, () => !present(root.querySelector<HTMLButtonElement>('[data-rr-action="save-type"]')).disabled, 'catalog preview');
  click(root, save ? 'save-type' : 'cancel-catalog');
  await until(api.Zotero, () => !root.querySelector<HTMLElement>('[data-rr-catalog]') && root.dataset.rrState !== 'loading', 'catalog completion');
}

/** Change a schema value during a real asynchronous preview and require renewed review. @param {object} api Native resources. @param {Window} window Owner. @param {Element} editor Catalog form. @returns {Promise<void>} Stale review rejected. */
export async function catalogReviewRace(api: NativeAPI, window: TestWindow, editor: HTMLElement) {
  let changed = false;
  const observer = new window.MutationObserver(() => {
    if (editor.getAttribute('aria-busy') !== 'true') return;
    observer.disconnect(); type(window, editor.querySelector<FormControl>('[data-rr-catalog-field="description"]'), 'Changed during async catalog preview'); changed = true;
  });
  observer.observe(editor, { attributes: true, attributeFilter: ['aria-busy'] });
  try {
    click(editor, 'preview-type');
    await until(api.Zotero, () => changed && editor.getAttribute('aria-busy') === 'false', 'catalog preview race');
    check(present(editor.querySelector<HTMLButtonElement>('[data-rr-action="save-type"]')).disabled, 'Stale catalog preview enabled save');
  } finally { observer.disconnect(); }
}

/** Enter all primitive metadata and save an actual typed relationship. @param {object} api Native resources. @param {Window} window Owner. @param {Element} root Pane. @param {object} target Native reference. @returns {Promise<void>} Created. */
export async function typedRelationship(api: NativeAPI, window: TestWindow, root: HTMLElement, target: TestItem) {
  click(root, 'add'); await until(api.Zotero, () => root.querySelector<HTMLElement>('[data-rr-editor]'), 'typed relationship editor');
  await chooseTarget(api, root, target);
  type(window, root.querySelector<HTMLSelectElement>('[data-rr-type]'), 'custom');
  for (const [id, value] of Object.entries(values)) type(window, root.querySelector<FormControl>(`[data-rr-field="${id}"]`), String(value));
  type(window, root.querySelector<FormControl>('[data-rr-field="count"]'), '1000000000001');
  click(root, 'preview');
  await until(api.Zotero, () => present(root.querySelector<HTMLElement>('[data-rr-editor] [role="alert"]')).textContent.includes('number'), 'invalid metadata error');
  check(present(root.querySelector<HTMLButtonElement>('[data-rr-action="save"]')).disabled, 'Invalid metadata enabled save');
  check(readyState((await api.Zotero.ReferenceRelationships!.application.read('self'))).snapshot.assertions.length === 0, 'Invalid form persisted metadata');
  type(window, root.querySelector<FormControl>('[data-rr-field="count"]'), '0');
  click(root, 'preview'); await until(api.Zotero, () => !present(root.querySelector<HTMLButtonElement>('[data-rr-action="save"]')).disabled, 'typed metadata review');
  click(root, 'save');
  await until(api.Zotero, () => !root.querySelector<HTMLElement>('[data-rr-editor]') && root.dataset.rrState === 'ready', 'typed relationship saved');
}
