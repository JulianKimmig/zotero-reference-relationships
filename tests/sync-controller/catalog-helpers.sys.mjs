/** Actual catalog and typed-metadata control interactions for native acceptance. */
import { check, until, click, type, chooseTarget } from './ui-helpers.sys.mjs';

export const definitions = [
  { id: 'text', label: 'Text', kind: 'string', required: true, options: [] },
  { id: 'count', label: 'Count', kind: 'number', required: true, options: [] },
  { id: 'flag', label: 'Flag', kind: 'boolean', required: true, options: [] },
  { id: 'date', label: 'Date', kind: 'date', required: true, options: [] },
  { id: 'choice', label: 'Choice', kind: 'enum', required: true, options: ['é', 'other'] },
  { id: 'spare', label: 'Optional flag', kind: 'boolean', required: false, options: [] },
];
export const values = { text: 'Custom Café 你好 😀 <b>literal</b>', count: 0, flag: false, date: '2000-02-29', choice: 'é' };

/** Set an actual checkbox through a click rather than replacing an implementation. @param {Element} control Checkbox. @param {boolean} checked Wanted state. @returns {void} */
export function checked(control, checked) { check(!!control, 'Checkbox missing'); if (control.checked !== checked) control.click(); }

/** Verify exact typed primitive values independent of JSON property order. @param {object} actual Persisted metadata. @param {object} expected Intended metadata. @returns {void} */
export function metadataEquals(actual, expected) {
  check(Object.keys(actual).length === Object.keys(expected).length, 'Metadata presence changed');
  for (const [key, value] of Object.entries(expected)) check(actual[key] === value, `Metadata ${key} differs`);
}

/** Open the actual owned catalog editor. @param {object} api Native API. @param {Element} root Pane. @param {string|null} id Existing type or new. @returns {Promise<Element>} Editor. */
export async function openCatalog(api, root, id = null) {
  click(root, 'manage-types');
  const editor = await until(api.Zotero, () => root.querySelector('[data-rr-catalog]'), 'catalog editor');
  if (id === null) click(editor, 'new-type');
  else {
    const edit = editor.querySelector(`[data-rr-type-id="${id}"]`); check(!!edit, `Catalog type ${id} missing`); edit.click();
  }
  await until(api.Zotero, () => editor.querySelector('[data-rr-catalog-field="id"]'), 'type definition form');
  return editor;
}

/** Fill one new schema through actual controls. @param {Window} window Owner. @param {Element} editor Catalog editor. @returns {void} */
export function fillDefinition(window, editor) {
  for (const [name, value] of Object.entries({ id: 'custom', label: 'Custom', description: 'Custom typed relationships' })) {
    type(window, editor.querySelector(`[data-rr-catalog-field="${name}"]`), value);
  }
  for (const field of definitions) {
    click(editor, 'add-field');
    const row = [...editor.querySelectorAll('[data-rr-field-definition]')].at(-1);
    for (const name of ['id', 'label', 'kind']) type(window, row.querySelector(`[data-rr-definition="${name}"]`), field[name]);
    checked(row.querySelector('[data-rr-definition="required"]'), field.required);
    if (field.kind === 'enum') type(window, row.querySelector('[data-rr-definition="options"]'), field.options.join('\n'));
  }
}

/** Preview a catalog change, then explicitly save or cancel. @param {object} api Native resources. @param {Element} root Pane. @param {boolean} save User decision. @returns {Promise<void>} Catalog closed and pane ready. */
export async function finishCatalog(api, root, save) {
  click(root, 'preview-type');
  await until(api.Zotero, () => !root.querySelector('[data-rr-action="save-type"]').disabled, 'catalog preview');
  click(root, save ? 'save-type' : 'cancel-catalog');
  await until(api.Zotero, () => !root.querySelector('[data-rr-catalog]') && root.dataset.rrState !== 'loading', 'catalog completion');
}

/** Change a schema value during a real asynchronous preview and require renewed review. @param {object} api Native resources. @param {Window} window Owner. @param {Element} editor Catalog form. @returns {Promise<void>} Stale review rejected. */
export async function catalogReviewRace(api, window, editor) {
  let changed = false;
  const observer = new window.MutationObserver(() => {
    if (editor.getAttribute('aria-busy') !== 'true') return;
    observer.disconnect(); type(window, editor.querySelector('[data-rr-catalog-field="description"]'), 'Changed during async catalog preview'); changed = true;
  });
  observer.observe(editor, { attributes: true, attributeFilter: ['aria-busy'] });
  try {
    click(editor, 'preview-type');
    await until(api.Zotero, () => changed && editor.getAttribute('aria-busy') === 'false', 'catalog preview race');
    check(editor.querySelector('[data-rr-action="save-type"]').disabled, 'Stale catalog preview enabled save');
  } finally { observer.disconnect(); }
}

/** Enter all primitive metadata and save an actual typed relationship. @param {object} api Native resources. @param {Window} window Owner. @param {Element} root Pane. @param {object} target Native reference. @returns {Promise<void>} Created. */
export async function typedRelationship(api, window, root, target) {
  click(root, 'add'); await until(api.Zotero, () => root.querySelector('[data-rr-editor]'), 'typed relationship editor');
  await chooseTarget(api, root, target);
  type(window, root.querySelector('[data-rr-type]'), 'custom');
  for (const [id, value] of Object.entries(values)) type(window, root.querySelector(`[data-rr-field="${id}"]`), String(value));
  type(window, root.querySelector('[data-rr-field="count"]'), '1000000000001');
  click(root, 'preview');
  await until(api.Zotero, () => root.querySelector('[data-rr-editor] [role="alert"]').textContent.includes('number'), 'invalid metadata error');
  check(root.querySelector('[data-rr-action="save"]').disabled, 'Invalid metadata enabled save');
  check((await api.Zotero.ReferenceRelationships.application.read('self')).snapshot.assertions.length === 0, 'Invalid form persisted metadata');
  type(window, root.querySelector('[data-rr-field="count"]'), '0');
  click(root, 'preview'); await until(api.Zotero, () => !root.querySelector('[data-rr-action="save"]').disabled, 'typed metadata review');
  click(root, 'save');
  await until(api.Zotero, () => !root.querySelector('[data-rr-editor]') && root.dataset.rrState === 'ready', 'typed relationship saved');
}
