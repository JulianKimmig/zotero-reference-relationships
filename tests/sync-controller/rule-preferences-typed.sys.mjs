/** Actual rule controls preserve typed conditions/constants and bound large contributor explanations. */
import { check, until, click, type, selectPane } from './ui-helpers.sys.mjs';
import { applyOne, change, ref } from './rules-fixtures.sys.mjs';
import { openRule, fillRule, previewRule, saveRule, storedRule } from './rule-preferences-helpers.sys.mjs';

const values = { text: '', count: 0, flag: false, date: '2000-02-29', choice: 'é' };
const fields = [['text', 'string'], ['count', 'number'], ['flag', 'boolean'], ['date', 'date'], ['choice', 'enum']]
  .map(([id, kind]) => ({ id, label: id, kind, required: true, options: kind === 'enum' ? ['é', 'other'] : [] }));
fields.push({ id: 'absent', label: 'Absent optional text', kind: 'string', required: false, options: [] });

/** Exercise all typed control kinds and contributor pagination using actual native persistence. @param {object} api Native resources. @param {Window} window Preference window. @param {Element} root Preferences. @param {object} a Actual source. @param {object} c Actual target. @returns {Promise<void>} */
export async function typedRulePreferences(api, window, root, a, c) {
  const { Zotero } = api, app = Zotero.ReferenceRelationships.application;
  const oldRow = [...root.querySelectorAll('[data-rr-rule-id]')].find(row => row.dataset.rrRuleId === 'inverse-ui');
  const removedEdit = oldRow.querySelector('[data-rr-action="edit-rule"]');
  for (const id of ['typed-root', 'typed-output']) await applyOne(api, await app.manageTypes({ library: 'self', kind: 'create', migration: null,
    type: { id, label: id, description: 'Typed native rule UI fixture', retired: false, fields } }));
  await until(Zotero, () => root.dataset.rrState === 'ready' && !oldRow.isConnected, 'fresh rule list after catalog change');
  removedEdit.click();
  check(!root.querySelector('[data-rr-rule-editor]'), 'Removed rule control retained its callback after list reload');
  await applyOne(api, await app.draftCreate({ source: ref(a), target: ref(c), type: 'typed-root', metadata: values }));
  await until(Zotero, () => root.dataset.rrState === 'ready', 'typed root authority');
  const before = await app.read('self'), editor = await openRule(api, root);
  fillRule(window, editor, { id: 'typed-ui', rootType: 'typed-root', inputType: 'typed-root', outputType: 'typed-output' });
  for (const [field, value] of Object.entries(values)) {
    click(editor, 'add-condition');
    const condition = [...editor.querySelectorAll('[data-rr-condition]')].at(-1);
    type(window, condition.querySelector('[data-rr-condition-field]'), field);
    type(window, condition.querySelector('[data-rr-condition-op]'), 'eq');
    type(window, condition.querySelector(`[data-rr-field="${field}"]`), String(value));
    const mode = editor.querySelector(`[data-rr-map-mode="${field}"]`);
    if (field === 'text') {
      type(window, mode, 'root');
      const source = editor.querySelector('[data-rr-map-root="text"]');
      check([...source.options].map(option => option.value).join(',') === ',text', 'Mapping offered an incompatible or optional source for required output');
    }
    if (field === 'count') continue;
    type(window, mode, 'constant');
    type(window, editor.querySelector(`[data-rr-mapping="${field}"] [data-rr-field="${field}"]`), String(value));
  }
  click(editor, 'add-condition');
  const absent = [...editor.querySelectorAll('[data-rr-condition]')].at(-1);
  type(window, absent.querySelector('[data-rr-condition-field]'), 'absent');
  type(window, absent.querySelector('[data-rr-condition-op]'), 'exists');
  type(window, absent.querySelector('[data-rr-field="absent"]'), 'false');
  click(editor, 'preview-rule');
  await until(Zotero, () => editor.querySelector('[role="alert"]').textContent, 'missing required output mapping');
  check(editor.querySelector('[data-rr-action="save-rule"]').disabled && JSON.stringify(await app.read('self')) === JSON.stringify(before), 'Invalid required mapping changed authority');
  type(window, editor.querySelector('[data-rr-map-mode="count"]'), 'constant');
  type(window, editor.querySelector('[data-rr-mapping="count"] [data-rr-field="count"]'), '0');
  const review = await previewRule(api, editor); check(Number(review.dataset.rrAdded) === 1, 'Typed predicates did not select the root');
  await saveRule(api, root);
  const rule = await storedRule(app, 'typed-ui');
  for (const [field, value] of Object.entries(values)) {
    check(rule.conditions.find(condition => condition.field === field).value === value, `Typed condition ${field} changed value or presence`);
    check(rule.mapping[field].value === value, `Typed mapping ${field} changed value or presence`);
  }
  check(rule.conditions.find(condition => condition.field === 'absent').value === false && !Object.hasOwn(rule.mapping, 'absent'), 'Absent optional root was coerced or mapped');
  await applyOne(api, await change(app, graph => {
    for (let index = 0; index < 30; index++) graph.rules.push({ ...rule, id: `typed-page-${index}` });
  }));
  const main = Zotero.getMainWindow(), pane = await selectPane(Zotero, main, c);
  const row = [...pane.querySelectorAll('[data-rr-relation]')].find(row => JSON.parse(row.dataset.rrRelation)[2] === 'typed-output');
  click(row, 'explain');
  const explanation = await until(Zotero, () => row.querySelector('[data-rr-provenance]'), 'typed contributor explanation');
  check(explanation.querySelectorAll('[data-rr-support]').length === 25, 'Contributor explanations mounted more than one bounded page');
  click(explanation, 'support-next');
  check(explanation.querySelectorAll('[data-rr-support]').length === 6, 'Contributor next page omitted producing rules');
  click(explanation, 'support-previous');
  check(explanation.querySelectorAll('[data-rr-support]').length === 25, 'Contributor previous page differs');
  await applyOne(api, await change(app, graph => { graph.rules = graph.rules.filter(rule => !rule.id.startsWith('typed-page-')); }));
}
