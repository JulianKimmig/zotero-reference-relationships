/** Official preferences journeys for custom inverse/symmetric rules, impact review and provenance. */
import { check, until, selectPane, click, type, createThroughUI } from './ui-helpers.sys.mjs';
import { install, book, ref, applyOne, change } from './rules-fixtures.sys.mjs';
import { paneID, preferences, openRule, fillRule, previewRule, saveRule, cancelRule, toggleRule, storedRule, sameAuthority } from './rule-preferences-helpers.sys.mjs';
import { rulePreferenceEdges } from './rule-preferences-edges.sys.mjs';
import { typedRulePreferences } from './rule-preferences-typed.sys.mjs';

/** Query materialized rows using only the actual public application. @param {object} app Application. @param {object} item Native endpoint. @returns {Promise<object[]>} Rows. */
async function rows(app, item) { return (await app.listRelationships(ref(item), 'both', null, { offset: 0, limit: 100 })).relationships; }

/** Set up a real bulk graph with one unrelated explicit native note. @param {object} job Marker. @param {object} api Platform. @returns {Promise<object>} Actual fixture items/keys. */
async function fixtures(job, api) {
  const { Zotero } = api, app = Zotero.ReferenceRelationships.application;
  const a = await book(Zotero, `${job.marker} source`), b = await book(Zotero, `${job.marker} target`), c = await book(Zotero, `${job.marker} later target`);
  const books = [a, b];
  for (let index = 0; index < 5; index++) books.push(await book(Zotero, `${job.marker} bulk ${index}`));
  await applyOne(api, await app.draftCreate({ source: ref(a), target: ref(b), type: 'referencing', metadata: { note: 'Bulk Café 你好' } }));
  await applyOne(api, await change(app, graph => {
    const timestamp = new Date().toISOString();
    for (const source of books) for (const target of books) {
      if (source === target || (source === a && target === b) || graph.assertions.length >= 31) continue;
      graph.assertions.push({ id: `bulk-${graph.assertions.length}`, source: ref(source), target: ref(target), type: 'referencing',
        metadata: { note: 'Bulk Café 你好' }, createdAt: timestamp, updatedAt: timestamp });
    }
  }));
  return { a, b, c };
}

/** Verify actual preview pagination shows every affected edge after native titles finish loading. @param {object} api Platform. @param {Element} review Review. @returns {Promise<void>} */
async function bulkReview(api, review) {
  check(Number(review.dataset.rrAdded) === 31, 'Bulk preview omitted generated inverse edges');
  check(review.querySelectorAll('[data-rr-impact]').length === 25, 'Impact preview is not a bounded first page');
  click(review, 'impact-next');
  check(review.querySelectorAll('[data-rr-impact]').length === 6, 'Bulk preview second page differs');
  await until(api.Zotero, () => review.getAttribute('aria-busy') === 'false', 'second impact page explanations');
  check(review.textContent.includes('Bulk Café 你好'), 'Second impact page lacks metadata explanations');
  click(review, 'impact-previous');
  check(review.querySelectorAll('[data-rr-impact]').length === 25, 'Impact previous page differs');
  await until(api.Zotero, () => review.getAttribute('aria-busy') === 'false', 'first impact page explanations');
}

/** Run native user journeys on installed production code; no application internals are mocked. @param {object} job Explicit phase. @param {object} api Native resources. @returns {Promise<object>} Evidence. */
export async function rulePreferences(job, api) {
  const { Zotero } = api, main = await install(job, api), app = Zotero.ReferenceRelationships.application;
  if (job.action === 'ruleui:readonly') {
    await api.synchronize();
    const group = Zotero.Groups.get(job.groups.restricted), library = `group:${job.groups.restricted}`;
    check(!group.editable, 'Native rule UI denial needs real read-only membership');
    const before = await app.read(library), { window, root } = await preferences(api, library);
    check(root.querySelector('[data-rr-action="new-rule"]').disabled, 'Read-only preferences enable rule creation');
    for (const control of root.querySelectorAll('[data-rr-action="edit-rule"],[data-rr-action="delete-rule"]')) check(control.disabled, 'Read-only preferences enable rule mutation');
    check(JSON.stringify(await app.read(library)) === JSON.stringify(before), 'Opening readonly rule preferences mutated authority');
    window.close(); return { realReadOnlyUI: true, unchanged: true };
  }
  if (job.action === 'ruleui:create') {
    const { a, b, c } = await fixtures(job, api), pane = await selectPane(Zotero, main, a);
    click(pane, 'manage-rules');
    const { window, root } = await preferences(api), before = await app.read('self');
    let editor = await openRule(api, root); fillRule(window, editor);
    const review = await previewRule(api, editor); await bulkReview(api, review);
    check(review.textContent.includes('inverse-ui') && review.textContent.includes('Bulk Café 你好'), 'Preview lacks rule or metadata explanation');
    await cancelRule(api, root); await sameAuthority(app, before);
    editor = await openRule(api, root); fillRule(window, editor); await bulkReview(api, await previewRule(api, editor)); await saveRule(api, root);
    check((await storedRule(app, 'inverse-ui')).version === 1 && (await app.read('self')).snapshot.assertions.length === 31, 'UI inverse persisted generated authority');
    window.close();
    const refreshed = await selectPane(Zotero, main, a);
    await createThroughUI(api, main, refreshed, c, 'After configure 你好', true);
    const exact = (await rows(app, c)).filter(edge => edge.type === 'referenced-by');
    check(exact.length === 1 && exact[0].source.key === c.key && exact[0].target.key === a.key && exact[0].assertions.length === 0,
      'User-configured inverse did not produce the exact requested pair');
    const cPane = await selectPane(Zotero, main, c), generated = [...cPane.querySelectorAll('[data-rr-relation]')].find(row => row.dataset.rrOrigin === 'generated');
    check(!generated.querySelector('[data-rr-action="edit"]') && !generated.querySelector('[data-rr-action="remove"]'), 'Generated-only relationship offers manual mutation');
    click(generated, 'explain');
    await until(Zotero, () => generated.querySelector('[data-rr-provenance]'), 'generated root/rule explanation');
    const explanation = generated.querySelector('[data-rr-provenance]').textContent;
    check(explanation.includes('inverse-ui') && explanation.includes('After configure 你好') && explanation.includes(a.getDisplayTitle()), 'Generated explanation lacks actual root, rule or metadata');
    await applyOne(api, await app.draftCreate({ source: ref(b), target: ref(a), type: 'referenced-by', metadata: {} }));
    return { a: a.key, b: b.key, c: c.key, snapshot: (await app.read('self')).snapshot,
      actualOfficialPreferences: true, bulkPagination: true, previewCancel: true, exactCustomInverse: true, generatedExplanation: true };
  }
  const a = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, job.a);
  const b = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, job.b);
  const c = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, job.c);
  check(JSON.stringify((await app.read('self')).snapshot) === JSON.stringify(job.snapshot), 'Rule UI restart changed saved authority');
  const { window, root } = await preferences(api);
  if (job.action === 'ruleui:edit') {
    const removed = await toggleRule(api, root, 'inverse-ui', false);
    check(removed.removed === 31 && removed.updated === 1, 'Disable impact did not distinguish manual inverse');
    const manual = (await rows(app, a)).find(edge => edge.type === 'referenced-by' && edge.source.key === b.key);
    check(manual && manual.supports.length === 0 && manual.assertions.length === 1, 'Manual inverse did not survive rule UI disable');
    await toggleRule(api, root, 'inverse-ui', true);
    await applyOne(api, await app.manageTypes({ library: 'self', kind: 'create', migration: null,
      type: { id: 'discussed-by', label: 'Discussed by', description: 'User output type', retired: false,
        fields: [{ id: 'note', label: 'Note', kind: 'string', required: false, options: [] }] } }));
    await until(Zotero, () => root.dataset.rrState === 'ready', 'preferences updated catalog');
    let editor = await openRule(api, root, 'inverse-ui');
    type(window, editor.querySelector('[data-rr-rule-field="outputType"]'), 'discussed-by');
    type(window, editor.querySelector('[data-rr-map-mode="note"]'), 'root');
    type(window, editor.querySelector('[data-rr-map-root="note"]'), 'note');
    let review = await previewRule(api, editor);
    check(Number(review.dataset.rrAdded) === 32 && Number(review.dataset.rrRemoved) === 31, 'Retype preview differs');
    await saveRule(api, root);
    check((await storedRule(app, 'inverse-ui')).version === 4 && (await rows(app, c)).some(edge => edge.type === 'discussed-by'), 'Retype did not persist');
    editor = await openRule(api, root, 'inverse-ui');
    type(window, editor.querySelector('[data-rr-rule-field="outputType"]'), 'referenced-by');
    type(window, editor.querySelector('[data-rr-map-mode="note"]'), 'root'); type(window, editor.querySelector('[data-rr-map-root="note"]'), 'note');
    await previewRule(api, editor); await saveRule(api, root);
    editor = await openRule(api, root); fillRule(window, editor, { id: 'conditional-ui', outputType: 'discussed-by' });
    type(window, editor.querySelector('[data-rr-map-mode="note"]'), 'constant');
    type(window, editor.querySelector('[data-rr-mapping="note"] [data-rr-field="note"]'), 'Conditional constant');
    click(editor, 'add-condition');
    const condition = editor.querySelector('[data-rr-condition]');
    type(window, condition.querySelector('[data-rr-condition-field]'), 'note');
    type(window, condition.querySelector('[data-rr-condition-op]'), 'eq');
    type(window, condition.querySelector('[data-rr-field="note"]'), 'After configure 你好');
    review = await previewRule(api, editor); check(Number(review.dataset.rrAdded) === 1, 'Root condition did not select exactly one output');
    await saveRule(api, root);
    await applyOne(api, await app.draftCreate({ source: ref(a), target: ref(c), type: 'similar', metadata: { note: 'Symmetric note' } }));
    await until(Zotero, () => root.dataset.rrState === 'ready', 'preferences updated root');
    editor = await openRule(api, root); fillRule(window, editor, { id: 'symmetric-ui', rootType: 'similar', inputType: 'similar', outputType: 'similar' });
    review = await previewRule(api, editor); check(Number(review.dataset.rrAdded) === 1 && Number(review.dataset.rrUpdated) === 1, 'Symmetric rule preview differs');
    await saveRule(api, root);
    await rulePreferenceEdges(api, window, root);
    await typedRulePreferences(api, window, root, a, c);
    const snapshot = (await app.read('self')).snapshot; window.close();
    return { ...job, action: undefined, xpi: undefined, snapshot, disableReenableRetype: true, manualSurvived: true,
      rootConditionAndConstant: true, symmetricRule: true, invalidStaleAsyncCancel: true, deleteRetraction: true };
  }
  check(job.action === 'ruleui:restart', 'Unknown rule preference phase');
  let editor = await openRule(api, root, 'inverse-ui');
  check(editor.querySelector('[data-rr-rule-field="outputType"]').value === 'referenced-by'
    && editor.querySelector('[data-rr-map-mode="note"]').value === 'root'
    && editor.querySelector('[data-rr-map-root="note"]').value === 'note', 'Restart lost UI definition or mapping');
  await cancelRule(api, root);
  check(!(await storedRule(app, 'conditional-ui')).enabled && !(await storedRule(app, 'symmetric-ui')), 'Restart lost disable/delete state');
  const { AddonManager } = api.ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const addon = await AddonManager.getAddonByID('reference-relationships@zotero-plugins.local');
  const snapshot = JSON.stringify((await app.read('self')).snapshot);
  await addon.disable();
  await until(Zotero, () => !Object.hasOwn(Zotero, 'ReferenceRelationships') && !Zotero.PreferencePanes.pluginPanes.some(pane => pane.id === paneID), 'preference pane teardown');
  check(root.dataset.rrState === 'disposed', 'Removed preference controls still advertise ready authority');
  check(!root.querySelector('[data-rr-rule-editor]') && !root.querySelector('[data-rr-action="new-rule"]'), 'Disabled runtime retained owned preference controls');
  await addon.enable();
  let reloaded;
  try { reloaded = await preferences(api); }
  catch (error) { error.message += '; stage=after-native-enable'; throw error; }
  check(JSON.stringify((await Zotero.ReferenceRelationships.application.read('self')).snapshot) === snapshot, 'Preference re-enable altered authority');
  reloaded.window.close(); return { actualRestartedPreferences: true, definitionsPreserved: true, openPreferenceDisableReenable: true,
    registrationsObservedImmediatelyAfterEnable: reloaded.initialRegistrationCount };
}
