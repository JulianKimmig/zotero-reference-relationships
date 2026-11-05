/** Native group loss must retire stale scope choices, preserve visible drafts and reject old authority access. */
import { check, until, type, click } from './ui-helpers.sys.mjs';
import { rejects } from './ui-permissions.sys.mjs';
import { resources, setEnabled } from './reconciliation-fixtures.sys.mjs';
import { preferences, openRule, fillRule, previewRule } from './rule-preferences-helpers.sys.mjs';
import { groupIDs, localGroup, libraryBook, linked, librariesPreserved } from './library-fixtures.sys.mjs';

/** Require honest removed-scope UI without automatically selecting an available library. @param {object} Zotero Native platform. @param {Element} root Actual preference root. @param {string} scope Removed scope. @returns {Promise<void>} */
async function unavailable(Zotero, root, scope) {
  await until(Zotero, () => root.dataset.rrState === 'unavailable', 'explicit unavailable library state');
  const selector = root.querySelector('[data-rr-library]'), old = [...selector.options].find(option => option.value === scope);
  check(selector.value === scope && old?.disabled && selector.selectedOptions[0] === old && !selector.disabled,
    'Group loss silently selected another library or retained an enabled stale choice');
  const alert = root.querySelector(':scope > [role="alert"]');
  check(root.querySelector('[data-rr-action="new-rule"]').disabled && alert?.textContent,
    `Removed group still exposes mutation access or hides its unavailability: ${JSON.stringify({
      newDisabled: root.querySelector('[data-rr-action="new-rule"]').disabled,
      alerts: [...root.querySelectorAll('[role="alert"]')].map(node => node.textContent),
    })}`);
}

/** Verify active/idle group removal, dynamic addition/rename/permission choices and unrelated data. @param {object} job Saved copy fixture. @param {object} api Actual platform. @returns {Promise<object>} Real native removal evidence. */
export async function reconciliationLibraryRemoval(job, api) {
  const { Zotero } = api, production = await resources(job, api), app = Zotero.ReferenceRelationships.application;
  check(!Zotero.Users.getCurrentUserID(), 'Removal is restricted to the anonymous fixture');
  const scope = `group:${groupIDs.removed}`, group = Zotero.Groups.get(groupIDs.removed);
  const ui = await preferences(api, scope), editor = await openRule(api, ui.root);
  fillRule(ui.window, editor, { id: 'visible-unsaved-group-rule' });
  try { await previewRule(api, editor); }
  catch (error) { error.message += `; actual alerts=${JSON.stringify([...ui.root.querySelectorAll('[role="alert"]')].map(node => node.textContent))}`; throw error; }
  group.name = `${job.marker} active read only`; group.editable = false; await group.saveTx();
  await until(Zotero, () => ui.root.querySelector('[data-rr-action="new-rule"]').disabled
    && editor.querySelector('[data-rr-action="preview-rule"]').disabled, 'active draft permission revoked');
  check(editor.querySelector('[data-rr-rule-field="id"]').value === 'visible-unsaved-group-rule', 'Permission loss discarded draft values');
  group.name = `${job.marker} active editable again`; group.editable = true; await group.saveTx();
  await until(Zotero, () => !editor.querySelector('[data-rr-action="preview-rule"]').disabled, 'active draft permission restored');
  check(editor.querySelector('[data-rr-action="save-rule"]').disabled, 'Permission restoration resurrected an old review');
  await previewRule(api, editor);
  const draft = await app.manageRules({ library: scope, kind: 'create', rule: { id: 'backend-stale-group-rule', enabled: true,
    rootType: 'referencing', inputType: 'referencing', outputType: 'referenced-by', transform: 'reverse', conditions: [], mapping: {} } });
  const receipt = await app.preview(draft.command, draft.expectedRevision);
  await group.eraseTx();
  await unavailable(Zotero, ui.root, scope);
  check(editor.isConnected && editor.querySelector('[data-rr-rule-field="id"]').value === 'visible-unsaved-group-rule', 'Group loss discarded visible draft values');
  for (const control of editor.querySelectorAll('input,textarea,select,button')) {
    if (control.dataset.rrAction !== 'cancel-rule') check(control.disabled, 'Removed-group draft still permits mutations');
  }
  await rejects(() => app.read(scope), 'endpoint');
  await rejects(() => app.applyReviewed(receipt), 'endpoint');
  await rejects(() => app.describe({ library: scope, key: job.removedSource }), 'endpoint');
  await librariesPreserved(api, job);
  click(editor, 'cancel-rule'); await until(Zotero, () => !ui.root.querySelector('[data-rr-rule-editor]'), 'removed-scope draft canceled');
  await unavailable(Zotero, ui.root, scope);
  type(ui.window, ui.root.querySelector('[data-rr-library]'), 'self');
  await until(Zotero, () => ui.root.dataset.rrState === 'ready' && ui.root.dataset.rrLibrary === 'self', 'explicit personal library selection');
  const rejoined = await localGroup(job, Zotero, 'removed');
  check((await app.read(scope)).state === 'uninitialized', 'Recreated native owner retained a stale transport or inherited erased authority');
  const rejoinA = await libraryBook(Zotero, rejoined.libraryID, `${job.marker} rejoined source`);
  const rejoinB = await libraryBook(Zotero, rejoined.libraryID, `${job.marker} rejoined target`);
  const rejoinedState = await linked(app, production.gateway, rejoinA, rejoinB, 'Fresh rejoined library authority');
  check(rejoinedState.head !== job.removedState.head, 'Rejoined group inherited its erased local head');
  await rejoined.eraseTx(); await rejects(() => app.read(scope), 'endpoint');
  const idle = await localGroup(job, Zotero, 'idle'), idleScope = `group:${groupIDs.idle}`;
  await until(Zotero, () => [...ui.root.querySelector('[data-rr-library]').options].some(option => option.value === idleScope && !option.disabled), 'new native group choice');
  const a = await libraryBook(Zotero, idle.libraryID, `${job.marker} idle source`), b = await libraryBook(Zotero, idle.libraryID, `${job.marker} idle target`);
  await linked(app, production.gateway, a, b, 'Local idle group metadata');
  type(ui.window, ui.root.querySelector('[data-rr-library]'), idleScope);
  await until(Zotero, () => ui.root.dataset.rrState === 'ready' && ui.root.dataset.rrLibrary === idleScope, 'new group selected');
  idle.name = `${job.marker} renamed read only`; idle.editable = false; await idle.saveTx();
  await until(Zotero, () => ui.root.querySelector('[data-rr-action="new-rule"]').disabled
    && [...ui.root.querySelector('[data-rr-library]').options].find(option => option.value === idleScope)?.textContent === idle.name, 'native rename and read-only refresh');
  idle.name = `${job.marker} editable again`; idle.editable = true; await idle.saveTx();
  await until(Zotero, () => !ui.root.querySelector('[data-rr-action="new-rule"]').disabled, 'native write permission restored');
  await idle.eraseTx(); await unavailable(Zotero, ui.root, idleScope);
  await rejects(() => app.read(idleScope), 'endpoint'); await librariesPreserved(api, job);
  type(ui.window, ui.root.querySelector('[data-rr-library]'), 'self');
  await until(Zotero, () => ui.root.dataset.rrState === 'ready' && ui.root.dataset.rrLibrary === 'self', 'explicit recovery from idle group loss');
  ui.window.close();
  return { activeDraftPreservedAndLocked: true, idleRemovalExplicit: true, oldScopeReadAndReceiptRejected: true,
    dynamicGroupChoices: true, recreatedOwnerUsesFreshTransport: true, renameAndPermissionRefresh: true, explicitRecovery: true, unrelatedLibrariesPreserved: true };
}

/** Erase an owned local group while disabled, then verify fresh production scopes after re-enable. @param {object} job Saved unrelated states. @param {object} api Actual native platform. @returns {Promise<object>} Disabled native removal evidence. */
export async function reconciliationLibraryDisabled(job, api) {
  const { Zotero } = api, production = await resources(job, api), group = await localGroup(job, Zotero, 'disabled');
  const a = await libraryBook(Zotero, group.libraryID, `${job.marker} disabled source`), b = await libraryBook(Zotero, group.libraryID, `${job.marker} disabled target`);
  await linked(Zotero.ReferenceRelationships.application, production.gateway, a, b, 'Disabled group authority');
  await setEnabled(Zotero, production.addon, false); await group.eraseTx(); await setEnabled(Zotero, production.addon, true);
  const app = Zotero.ReferenceRelationships.application;
  await rejects(() => app.read(`group:${groupIDs.disabled}`), 'endpoint'); await librariesPreserved(api, job);
  const ui = await preferences(api);
  for (const role of ['removed', 'idle', 'disabled']) check(![...ui.root.querySelector('[data-rr-library]').options].some(option => option.value === `group:${groupIDs[role]}`), 'Restarted choices contain a removed group');
  ui.window.close();
  return { disabledGroupRemoval: true, freshScopesRejectRemovedGroup: true, unrelatedLibrariesPreserved: true };
}
