/** Actual rule controls preserve typed conditions/constants and bound large contributor explanations. */
import { constantMapping, present } from './evidence.sys.mts';
import type { FormControl } from '../../src/ui/contracts.mts';
import type { TestWindow } from './platform-contracts.mts';
import type { TestItem } from './platform-contracts.mts';
import type { MetadataField } from '../../src/domain/contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { check, until, click, type, selectPane } from './ui-helpers.sys.mts';
import { applyOne, change, ref } from './rules-fixtures.sys.mts';
import { openRule, fillRule, previewRule, saveRule, storedRule } from './rule-preferences-helpers.sys.mts';

const values = { text: '', count: 0, flag: false, date: '2000-02-29', choice: 'é' };
const fields: MetadataField[] = ([['text', 'string'], ['count', 'number'], ['flag', 'boolean'], ['date', 'date'], ['choice', 'enum']] as const)
  .map(([id, kind]) => ({ id, label: id, kind, required: true, options: kind === 'enum' ? ['é', 'other'] : [] }));
fields.push({ id: 'absent', label: 'Absent optional text', kind: 'string', required: false, options: [] });

/** Exercise all typed control kinds and contributor pagination using actual native persistence. @param {object} api Native resources. @param {Window} window Preference window. @param {Element} root Preferences. @param {object} a Actual source. @param {object} c Actual target. @returns {Promise<void>} */
export async function typedRulePreferences(api: NativeAPI, window: TestWindow, root: HTMLElement, a: TestItem, c: TestItem) {
  const { Zotero } = api, app = Zotero.ReferenceRelationships!.application;
  const oldRow = [...root.querySelectorAll<HTMLElement>('[data-rr-rule-id]')].find(row => row.dataset.rrRuleId === 'inverse-ui');
  const removedEdit = present(oldRow).querySelector<HTMLButtonElement>('[data-rr-action="edit-rule"]');
  for (const id of ['typed-root', 'typed-output']) await applyOne(api, await app.manageTypes({ library: 'self', kind: 'create', migration: null,
    type: { id, label: id, description: 'Typed native rule UI fixture', retired: false, fields } }));
  await until(Zotero, () => root.dataset.rrState === 'ready' && !present(oldRow).isConnected, 'fresh rule list after catalog change');
  present(removedEdit).click();
  check(!root.querySelector<HTMLElement>('[data-rr-rule-editor]'), 'Removed rule control retained its callback after list reload');
  await applyOne(api, await app.draftCreate({ source: ref(a), target: ref(c), type: 'typed-root', metadata: values }));
  await until(Zotero, () => root.dataset.rrState === 'ready', 'typed root authority');
  const before = await app.read('self'), editor = await openRule(api, root);
  fillRule(window, editor, { id: 'typed-ui', rootType: 'typed-root', inputType: 'typed-root', outputType: 'typed-output' });
  for (const [field, value] of Object.entries(values)) {
    click(editor, 'add-condition');
    const condition = [...editor.querySelectorAll<HTMLElement>('[data-rr-condition]')].at(-1);
    type(window, present(condition).querySelector<HTMLSelectElement>('[data-rr-condition-field]'), field);
    type(window, present(condition).querySelector<HTMLSelectElement>('[data-rr-condition-op]'), 'eq');
    type(window, present(condition).querySelector<FormControl>(`[data-rr-field="${field}"]`), String(value));
    const mode = editor.querySelector<HTMLSelectElement>(`[data-rr-map-mode="${field}"]`);
    if (field === 'text') {
      type(window, mode, 'root');
      const source = editor.querySelector<HTMLSelectElement>('[data-rr-map-root="text"]');
      check([...present(source).options].map(option => option.value).join(',') === ',text', 'Mapping offered an incompatible or optional source for required output');
    }
    if (field === 'count') continue;
    type(window, mode, 'constant');
    type(window, editor.querySelector<FormControl>(`[data-rr-mapping="${field}"] [data-rr-field="${field}"]`), String(value));
  }
  click(editor, 'add-condition');
  const absent = [...editor.querySelectorAll<HTMLElement>('[data-rr-condition]')].at(-1);
  type(window, present(absent).querySelector<HTMLSelectElement>('[data-rr-condition-field]'), 'absent');
  type(window, present(absent).querySelector<HTMLSelectElement>('[data-rr-condition-op]'), 'exists');
  type(window, present(absent).querySelector<FormControl>('[data-rr-field="absent"]'), 'false');
  click(editor, 'preview-rule');
  await until(Zotero, () => present(editor.querySelector<HTMLElement>('[role="alert"]')).textContent, 'missing required output mapping');
  check(present(editor.querySelector<HTMLButtonElement>('[data-rr-action="save-rule"]')).disabled && JSON.stringify(await app.read('self')) === JSON.stringify(before), 'Invalid required mapping changed authority');
  type(window, editor.querySelector<HTMLSelectElement>('[data-rr-map-mode="count"]'), 'constant');
  type(window, editor.querySelector<FormControl>('[data-rr-mapping="count"] [data-rr-field="count"]'), '0');
  const review = await previewRule(api, editor); check(Number(present(review).dataset.rrAdded) === 1, 'Typed predicates did not select the root');
  await saveRule(api, root);
  const rule = await storedRule(app, 'typed-ui');
  for (const [field, value] of Object.entries(values)) {
    check(present(present(rule).conditions.find(condition => condition.field === field)).value === value, `Typed condition ${field} changed value or presence`);
    check(constantMapping(present(rule).mapping[field]).value === value, `Typed mapping ${field} changed value or presence`);
  }
  check(present(present(rule).conditions.find(condition => condition.field === 'absent')).value === false && !Object.hasOwn(present(rule).mapping, 'absent'), 'Absent optional root was coerced or mapped');
  await applyOne(api, await change(app, graph => {
    for (let index = 0; index < 30; index++) graph.rules.push({ ...rule, id: `typed-page-${index}` });
  }));
  const main = Zotero.getMainWindow(), pane = await selectPane(Zotero, main, c);
  const row = [...pane.querySelectorAll<HTMLElement>('[data-rr-relation]')].find(row => JSON.parse(present(row.dataset.rrRelation))[2] === 'typed-output');
  click(present(row), 'explain');
  const explanation = await until(Zotero, () => present(row).querySelector<HTMLElement>('[data-rr-provenance]'), 'typed contributor explanation');
  check(explanation.querySelectorAll<HTMLElement>('[data-rr-support]').length === 25, 'Contributor explanations mounted more than one bounded page');
  click(explanation, 'support-next');
  check(explanation.querySelectorAll<HTMLElement>('[data-rr-support]').length === 6, 'Contributor next page omitted producing rules');
  click(explanation, 'support-previous');
  check(explanation.querySelectorAll<HTMLElement>('[data-rr-support]').length === 25, 'Contributor previous page differs');
  await applyOne(api, await change(app, graph => { graph.rules = graph.rules.filter(rule => !rule.id.startsWith('typed-page-')); }));
}
