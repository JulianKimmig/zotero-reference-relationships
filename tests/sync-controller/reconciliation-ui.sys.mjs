/** Native user saves must retain their issued review when host item events are delayed. */
import { check, until, selectPane, click, type, chooseTarget } from './ui-helpers.sys.mjs';
import { resources, fixtures } from './reconciliation-fixtures.sys.mjs';
import { commits } from './rules-fixtures.sys.mjs';
import { openCatalog } from './catalog-helpers.sys.mjs';
import { preferences, openRule, fillRule, previewRule, cancelRule } from './rule-preferences-helpers.sys.mjs';

/** Persist real host alias/trash changes with the native save API's deferred-notification option. No plugin methods are replaced. @param {object} Zotero Platform. @param {object} a Actual survivor. @param {object} b Actual original. @returns {Promise<string>} Native original URI. */
async function silentMerge(Zotero, a, b) {
  const uri = Zotero.URI.getItemURI(b);
  a.addRelation(Zotero.Relations.replacedItemPredicate, uri); await a.saveTx({ skipNotifier: true });
  b.deleted = true; await b.saveTx({ skipNotifier: true }); return uri;
}

/** Restore only the owned adversarial native fixture and deliver normal host notifications. @param {object} Zotero Platform. @param {object} a Survivor. @param {object} b Original. @param {string} uri Owned relation. @returns {Promise<void>} */
async function restore(Zotero, a, b, uri) {
  a.removeRelation(Zotero.Relations.replacedItemPredicate, uri); await a.saveTx();
  b.deleted = false; await b.saveTx();
}

/** Require the actual still-enabled Save to reject a native-stale review without publishing. @param {object} api Native API. @param {Element} editor Actual editor. @param {string} action Save action. @param {object} before Exact authority. @param {number} count Native generations. @returns {Promise<void>} */
async function staleSave(api, editor, action, before, count) {
  check(!editor.querySelector(`[data-rr-action="${action}"]`).disabled, 'External delayed-event fixture unexpectedly invalidated UI before Save');
  click(editor, action);
  await until(api.Zotero, () => !editor.isConnected || editor.querySelector('[role="alert"]')?.textContent, 'native-stale UI save result');
  check(editor.isConnected && editor.querySelector('[role="alert"]').textContent.includes('Native endpoints changed'), 'UI Save accepted a native-stale review or reported another failure');
  const app = api.Zotero.ReferenceRelationships.application;
  check(JSON.stringify(await app.read('self')) === JSON.stringify(before) && await commits(api) === count, 'Stale user review published a graph generation');
}

/** Verify all three actual native editors publish only their previously displayed review. @param {object} job Artifact. @param {object} api Native resources. @returns {Promise<object>} User save binding evidence. */
export async function reconciliationUI(job, api) {
  const { Zotero } = api; await resources(job, api);
  const { a, b, d, before, count } = await fixtures(job, api), main = Zotero.getMainWindow();
  let pane = await selectPane(Zotero, main, a);
  click(pane, 'add'); await until(Zotero, () => pane.querySelector('[data-rr-editor]'), 'relationship binding editor');
  await chooseTarget(api, pane, d); type(main, pane.querySelector('[data-rr-field="note"]'), 'Must remain reviewed');
  click(pane, 'preview'); await until(Zotero, () => !pane.querySelector('[data-rr-action="save"]').disabled, 'relationship binding review');
  let editor = pane.querySelector('[data-rr-editor]'), uri = await silentMerge(Zotero, a, b);
  await staleSave(api, editor, 'save', before, count); click(editor, 'cancel'); await restore(Zotero, a, b, uri);
  pane = await selectPane(Zotero, main, a);
  editor = await openCatalog(api, pane);
  for (const [field, value] of Object.entries({ id: 'binding-type', label: 'Binding type', description: 'Native review binding' })) {
    type(main, editor.querySelector(`[data-rr-catalog-field="${field}"]`), value);
  }
  click(editor, 'preview-type'); await until(Zotero, () => !editor.querySelector('[data-rr-action="save-type"]').disabled, 'catalog binding review');
  uri = await silentMerge(Zotero, a, b);
  await staleSave(api, editor, 'save-type', before, count); click(editor, 'cancel-catalog'); await restore(Zotero, a, b, uri);
  const preferencesUI = await preferences(api);
  editor = await openRule(api, preferencesUI.root);
  fillRule(preferencesUI.window, editor, { id: 'binding-rule', rootType: 'similar', inputType: 'similar', outputType: 'similar' });
  await previewRule(api, editor); uri = await silentMerge(Zotero, a, b);
  await staleSave(api, editor, 'save-rule', before, count); await cancelRule(api, preferencesUI.root);
  await restore(Zotero, a, b, uri); preferencesUI.window.close();
  return { relationshipReviewBound: true, catalogReviewBound: true, ruleReviewBound: true,
    nativePersistenceWithDelayedNotifications: true, originalGraphUnchanged: true };
}
