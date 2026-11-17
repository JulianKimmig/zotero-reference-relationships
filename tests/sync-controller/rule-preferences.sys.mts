/** Official preferences journeys for custom inverse/symmetric rules, impact review and provenance. */
import { found, present, readyState } from './evidence.sys.mts';
import type { FormControl } from '../../src/ui/contracts.mts';
import type { RelationshipApplication } from '../../src/application/service.mts';
import type { TestItem } from './platform-contracts.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { check, until, selectPane, click, type, createThroughUI } from './ui-helpers.sys.mts';
import { install, book, ref, applyOne, change } from './rules-fixtures.sys.mts';
import { paneID, preferences, openRule, fillRule, previewRule, saveRule, cancelRule, toggleRule, storedRule, sameAuthority, requiredRuleEvidence, verifyRestartRules, inspectRuleRestart } from './rule-preferences-helpers.sys.mts';
import { rulePreferenceEdges } from './rule-preferences-edges.sys.mts';
import { typedRulePreferences } from './rule-preferences-typed.sys.mts';

/** Query materialized rows using only the actual public application. @param {object} app Application. @param {object} item Native endpoint. @returns {Promise<object[]>} Rows. */
async function rows(app: RelationshipApplication, item: TestItem) { return (await app.listRelationships(ref(item), 'both', null, { offset: 0, limit: 100 })).relationships; }

/** Set up a real bulk graph with one unrelated explicit native note. @param {object} job Marker. @param {object} api Platform. @returns {Promise<object>} Actual fixture items/keys. */
async function fixtures(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api, app = Zotero.ReferenceRelationships!.application;
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
async function bulkReview(api: NativeAPI, review: HTMLElement) {
  check(Number(review.dataset.rrAdded) === 31, 'Bulk preview omitted generated inverse edges');
  check(review.querySelectorAll<HTMLElement>('[data-rr-impact]').length === 25, 'Impact preview is not a bounded first page');
  click(review, 'impact-next');
  check(review.querySelectorAll<HTMLElement>('[data-rr-impact]').length === 6, 'Bulk preview second page differs');
  await until(api.Zotero, () => review.getAttribute('aria-busy') === 'false', 'second impact page explanations');
  check(review.textContent.includes('Bulk Café 你好'), 'Second impact page lacks metadata explanations');
  click(review, 'impact-previous');
  check(review.querySelectorAll<HTMLElement>('[data-rr-impact]').length === 25, 'Impact previous page differs');
  await until(api.Zotero, () => review.getAttribute('aria-busy') === 'false', 'first impact page explanations');
}

/** Run native user journeys on installed production code; no application internals are mocked. @param {object} job Explicit phase. @param {object} api Native resources. @returns {Promise<object>} Evidence. */
export async function rulePreferences(job: ControllerJob, api: NativeAPI) {
  if (job.action === 'ruleui:inspect-restart') return inspectRuleRestart(job, api);
  requiredRuleEvidence(job.xpi, 'job.xpi');
  const { Zotero } = api, main = await install(job, api), app = Zotero.ReferenceRelationships!.application;
  if (job.action === 'ruleui:readonly') {
    await api.synchronize();
    const group = Zotero.Groups.get(job.groups.restricted), library = `group:${job.groups.restricted}` as const;
    check(!found(group).editable, 'Native rule UI denial needs real read-only membership');
    const before = await app.read(library), { window, root } = await preferences(api, library);
    check(present(root.querySelector<HTMLButtonElement>('[data-rr-action="new-rule"]')).disabled, 'Read-only preferences enable rule creation');
    for (const control of root.querySelectorAll<HTMLButtonElement>('[data-rr-action="edit-rule"],[data-rr-action="delete-rule"]')) check(control.disabled, 'Read-only preferences enable rule mutation');
    check(JSON.stringify(await app.read(library)) === JSON.stringify(before), 'Opening readonly rule preferences mutated authority');
    window.close(); return { realReadOnlyUI: true, unchanged: true };
  }
  if (job.action === 'ruleui:create') {
    const { a, b, c } = await fixtures(job, api), pane = await selectPane(Zotero, main, a);
    click(pane, 'manage-rules');
    const { window, root } = await preferences(api), before = await app.read('self');
    let editor = await openRule(api, root); fillRule(window, editor);
    const review = await previewRule(api, editor); await bulkReview(api, present(review));
    check(present(review).textContent.includes('inverse-ui') && present(review).textContent.includes('Bulk Café 你好'), 'Preview lacks rule or metadata explanation');
    await cancelRule(api, root); await sameAuthority(app, before);
    editor = await openRule(api, root); fillRule(window, editor); await bulkReview(api, present(await previewRule(api, editor))); await saveRule(api, root);
    check(present((await storedRule(app, 'inverse-ui'))).version === 1 && readyState((await app.read('self'))).snapshot.assertions.length === 31, 'UI inverse persisted generated authority');
    window.close();
    const refreshed = await selectPane(Zotero, main, a);
    await createThroughUI(api, main, refreshed, c, 'After configure 你好', true);
    const exact = (await rows(app, c)).filter(edge => edge.type === 'referenced-by');
    check(exact.length === 1 && exact[0].source.key === c.key && exact[0].target.key === a.key && exact[0].assertions.length === 0,
      'User-configured inverse did not produce the exact requested pair');
    const cPane = await selectPane(Zotero, main, c), generated = [...cPane.querySelectorAll<HTMLElement>('[data-rr-relation]')].find(row => row.dataset.rrOrigin === 'generated');
    check(!present(generated).querySelector<HTMLButtonElement>('[data-rr-action="edit"]') && !present(generated).querySelector<HTMLButtonElement>('[data-rr-action="remove"]'), 'Generated-only relationship offers manual mutation');
    click(present(generated), 'explain');
    await until(Zotero, () => present(generated).querySelector<HTMLElement>('[data-rr-provenance]'), 'generated root/rule explanation');
    const explanation = present(present(generated).querySelector<HTMLElement>('[data-rr-provenance]')).textContent;
    check(explanation.includes('inverse-ui') && explanation.includes('After configure 你好') && explanation.includes(a.getDisplayTitle()), 'Generated explanation lacks actual root, rule or metadata');
    await applyOne(api, await app.draftCreate({ source: ref(b), target: ref(a), type: 'referenced-by', metadata: {} }));
    return { a: a.key, b: b.key, c: c.key, snapshot: readyState((await app.read('self'))).snapshot,
      actualOfficialPreferences: true, bulkPagination: true, previewCancel: true, exactCustomInverse: true, generatedExplanation: true };
  }
  const a = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, requiredRuleEvidence(job.a, 'restart.job.a'));
  const b = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, requiredRuleEvidence(job.b, 'restart.job.b'));
  const c = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, requiredRuleEvidence(job.c, 'restart.job.c'));
  check(JSON.stringify(readyState((await app.read('self'))).snapshot) === JSON.stringify(job.snapshot), 'Rule UI restart changed saved authority');
  const { window, root } = await preferences(api);
  if (job.action === 'ruleui:edit') {
    const removed = await toggleRule(api, root, 'inverse-ui', false);
    check(removed.removed === 31 && removed.updated === 1, 'Disable impact did not distinguish manual inverse');
    const manual = (await rows(app, found(a))).find(edge => edge.type === 'referenced-by' && edge.source.key === found(b).key);
    check(manual && manual.supports.length === 0 && manual.assertions.length === 1, 'Manual inverse did not survive rule UI disable');
    await toggleRule(api, root, 'inverse-ui', true);
    await applyOne(api, await app.manageTypes({ library: 'self', kind: 'create', migration: null,
      type: { id: 'discussed-by', label: 'Discussed by', description: 'User output type', retired: false,
        fields: [{ id: 'note', label: 'Note', kind: 'string', required: false, options: [] }] } }));
    await until(Zotero, () => root.dataset.rrState === 'ready', 'preferences updated catalog');
    let editor = await openRule(api, root, 'inverse-ui');
    type(window, editor.querySelector<HTMLSelectElement>('[data-rr-rule-field="outputType"]'), 'discussed-by');
    type(window, editor.querySelector<HTMLSelectElement>('[data-rr-map-mode="note"]'), 'root');
    type(window, editor.querySelector<HTMLSelectElement>('[data-rr-map-root="note"]'), 'note');
    let review = await previewRule(api, editor);
    check(Number(present(review).dataset.rrAdded) === 32 && Number(present(review).dataset.rrRemoved) === 31, 'Retype preview differs');
    await saveRule(api, root);
    check(present((await storedRule(app, 'inverse-ui'))).version === 4 && (await rows(app, found(c))).some(edge => edge.type === 'discussed-by'), 'Retype did not persist');
    editor = await openRule(api, root, 'inverse-ui');
    type(window, editor.querySelector<HTMLSelectElement>('[data-rr-rule-field="outputType"]'), 'referenced-by');
    type(window, editor.querySelector<HTMLSelectElement>('[data-rr-map-mode="note"]'), 'root'); type(window, editor.querySelector<HTMLSelectElement>('[data-rr-map-root="note"]'), 'note');
    await previewRule(api, editor); await saveRule(api, root);
    editor = await openRule(api, root); fillRule(window, editor, { id: 'conditional-ui', outputType: 'discussed-by' });
    type(window, editor.querySelector<HTMLSelectElement>('[data-rr-map-mode="note"]'), 'constant');
    type(window, editor.querySelector<FormControl>('[data-rr-mapping="note"] [data-rr-field="note"]'), 'Conditional constant');
    click(editor, 'add-condition');
    const condition = editor.querySelector<HTMLElement>('[data-rr-condition]');
    type(window, present(condition).querySelector<HTMLSelectElement>('[data-rr-condition-field]'), 'note');
    type(window, present(condition).querySelector<HTMLSelectElement>('[data-rr-condition-op]'), 'eq');
    type(window, present(condition).querySelector<FormControl>('[data-rr-field="note"]'), 'After configure 你好');
    review = await previewRule(api, editor); check(Number(present(review).dataset.rrAdded) === 1, 'Root condition did not select exactly one output');
    await saveRule(api, root);
    await applyOne(api, await app.draftCreate({ source: ref(found(a)), target: ref(found(c)), type: 'similar', metadata: { note: 'Symmetric note' } }));
    await until(Zotero, () => root.dataset.rrState === 'ready', 'preferences updated root');
    editor = await openRule(api, root); fillRule(window, editor, { id: 'symmetric-ui', rootType: 'similar', inputType: 'similar', outputType: 'similar' });
    review = await previewRule(api, editor); check(Number(present(review).dataset.rrAdded) === 1 && Number(present(review).dataset.rrUpdated) === 1, 'Symmetric rule preview differs');
    await saveRule(api, root);
    await rulePreferenceEdges(api, window, root);
    await typedRulePreferences(api, window, root, found(a), found(c));
    const snapshot = readyState((await app.read('self'))).snapshot; window.close();
    return { ...job, action: undefined, xpi: undefined, snapshot, disableReenableRetype: true, manualSurvived: true,
      rootConditionAndConstant: true, symmetricRule: true, invalidStaleAsyncCancel: true, deleteRetraction: true };
  }
  check(job.action === 'ruleui:restart', 'Unknown rule preference phase');
  let editor = await openRule(api, root, 'inverse-ui');
  check(requiredRuleEvidence(editor.querySelector<HTMLSelectElement>('[data-rr-rule-field="outputType"]'), 'restart.output-type').value === 'referenced-by'
    && requiredRuleEvidence(editor.querySelector<HTMLSelectElement>('[data-rr-map-mode="note"]'), 'restart.note-map-mode').value === 'root'
    && requiredRuleEvidence(editor.querySelector<HTMLSelectElement>('[data-rr-map-root="note"]'), 'restart.note-map-root').value === 'note', 'Restart lost UI definition or mapping');
  await cancelRule(api, root);
  await verifyRestartRules(app);
  const { AddonManager } = api.ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const addon = await AddonManager.getAddonByID('reference-relationships@zotero-plugins.local');
  const snapshot = JSON.stringify(readyState((await app.read('self'))).snapshot);
  await requiredRuleEvidence(addon, 'restart.addon-before-disable').disable();
  await until(Zotero, () => !Object.hasOwn(Zotero, 'ReferenceRelationships') && !Zotero.PreferencePanes.pluginPanes.some(pane => pane.id === paneID), 'preference pane teardown');
  check(root.dataset.rrState === 'disposed', 'Removed preference controls still advertise ready authority');
  check(!root.querySelector<HTMLElement>('[data-rr-rule-editor]') && !root.querySelector<HTMLButtonElement>('[data-rr-action="new-rule"]'), 'Disabled runtime retained owned preference controls');
  await requiredRuleEvidence(addon, 'restart.addon-before-enable').enable();
  let reloaded;
  try { reloaded = await preferences(api); }
  catch (caught) { const error = caught instanceof Error ? caught : new Error(String(caught)); error.message += '; stage=after-native-enable'; throw error; }
  check(JSON.stringify(readyState((await Zotero.ReferenceRelationships!.application.read('self'))).snapshot) === snapshot, 'Preference re-enable altered authority');
  reloaded.window.close(); return { actualRestartedPreferences: true, definitionsPreserved: true, openPreferenceDisableReenable: true,
    registrationsObservedImmediatelyAfterEnable: reloaded.initialRegistrationCount };
}
