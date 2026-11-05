/** Native group loss must retire stale scope choices, preserve visible drafts and reject old authority access. */
import { present, found, readyState } from './evidence.sys.mts';
import type { FormControl } from '../../src/ui/contracts.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { TestPlatform } from './platform-contracts.mts';
import { check, until, type, click } from './ui-helpers.sys.mts';
import { rejects } from './ui-permissions.sys.mts';
import { resources, setEnabled } from './reconciliation-fixtures.sys.mts';
import { preferences, openRule, fillRule, previewRule } from './rule-preferences-helpers.sys.mts';
import { groupIDs, localGroup, libraryBook, linked, librariesPreserved } from './library-fixtures.sys.mts';

/** Require honest removed-scope UI without automatically selecting an available library. @param {object} Zotero Native platform. @param {Element} root Actual preference root. @param {string} scope Removed scope. @returns {Promise<void>} */
async function unavailable(Zotero: TestPlatform, root: HTMLElement, scope: string) {
  await until(Zotero, () => root.dataset.rrState === 'unavailable', 'explicit unavailable library state');
  const selector = root.querySelector<HTMLSelectElement>('[data-rr-library]'), old = [...present(selector).options].find(option => option.value === scope);
  check(present(selector).value === scope && old?.disabled && present(selector).selectedOptions[0] === old && !present(selector).disabled,
    'Group loss silently selected another library or retained an enabled stale choice');
  const alert = root.querySelector<HTMLElement>(':scope > [role="alert"]');
  check(present(root.querySelector<HTMLButtonElement>('[data-rr-action="new-rule"]')).disabled && alert?.textContent,
    `Removed group still exposes mutation access or hides its unavailability: ${JSON.stringify({
      newDisabled: present(root.querySelector<HTMLButtonElement>('[data-rr-action="new-rule"]')).disabled,
      alerts: [...root.querySelectorAll<HTMLElement>('[role="alert"]')].map(node => node.textContent),
    })}`);
}

/** Verify active/idle group removal, dynamic addition/rename/permission choices and unrelated data. @param {object} job Saved copy fixture. @param {object} api Actual platform. @returns {Promise<object>} Real native removal evidence. */
export async function reconciliationLibraryRemoval(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api, production = await resources(job, api), app = Zotero.ReferenceRelationships!.application;
  check(!Zotero.Users.getCurrentUserID(), 'Removal is restricted to the anonymous fixture');
  const scope = `group:${groupIDs.removed}` as const, group = Zotero.Groups.get(groupIDs.removed);
  const ui = await preferences(api, scope), editor = await openRule(api, ui.root);
  fillRule(ui.window, editor, { id: 'visible-unsaved-group-rule' });
  try { await previewRule(api, editor); }
  catch (caught) { const error = caught instanceof Error ? caught : new Error(String(caught)); error.message += `; actual alerts=${JSON.stringify([...ui.root.querySelectorAll<HTMLElement>('[role="alert"]')].map(node => node.textContent))}`; throw error; }
  found(group).name = `${job.marker} active read only`; found(group).editable = false; await found(group).saveTx();
  await until(Zotero, () => present(ui.root.querySelector<HTMLButtonElement>('[data-rr-action="new-rule"]')).disabled
    && present(editor.querySelector<HTMLButtonElement>('[data-rr-action="preview-rule"]')).disabled, 'active draft permission revoked');
  check(present(editor.querySelector<HTMLInputElement>('[data-rr-rule-field="id"]')).value === 'visible-unsaved-group-rule', 'Permission loss discarded draft values');
  found(group).name = `${job.marker} active editable again`; found(group).editable = true; await found(group).saveTx();
  await until(Zotero, () => !present(editor.querySelector<HTMLButtonElement>('[data-rr-action="preview-rule"]')).disabled, 'active draft permission restored');
  check(present(editor.querySelector<HTMLButtonElement>('[data-rr-action="save-rule"]')).disabled, 'Permission restoration resurrected an old review');
  await previewRule(api, editor);
  const draft = await app.manageRules({ library: scope, kind: 'create', rule: { id: 'backend-stale-group-rule', enabled: true,
    rootType: 'referencing', inputType: 'referencing', outputType: 'referenced-by', transform: 'reverse', conditions: [], mapping: {} } });
  const receipt = await app.preview(draft.command, draft.expectedRevision);
  await found(group).eraseTx();
  await unavailable(Zotero, ui.root, scope);
  check(editor.isConnected && present(editor.querySelector<HTMLInputElement>('[data-rr-rule-field="id"]')).value === 'visible-unsaved-group-rule', 'Group loss discarded visible draft values');
  for (const control of editor.querySelectorAll<FormControl>('input,textarea,select,button')) {
    if (control.dataset.rrAction !== 'cancel-rule') check(control.disabled, 'Removed-group draft still permits mutations');
  }
  await rejects(() => app.read(scope), 'endpoint');
  await rejects(() => app.applyReviewed(receipt), 'endpoint');
  await rejects(() => app.describe({ library: scope, key: job.removedSource }), 'endpoint');
  await librariesPreserved(api, job);
  click(editor, 'cancel-rule'); await until(Zotero, () => !ui.root.querySelector<HTMLElement>('[data-rr-rule-editor]'), 'removed-scope draft canceled');
  await unavailable(Zotero, ui.root, scope);
  type(ui.window, ui.root.querySelector<HTMLSelectElement>('[data-rr-library]'), 'self');
  await until(Zotero, () => ui.root.dataset.rrState === 'ready' && ui.root.dataset.rrLibrary === 'self', 'explicit personal library selection');
  const rejoined = await localGroup(job, Zotero, 'removed');
  check((await app.read(scope)).state === 'uninitialized', 'Recreated native owner retained a stale transport or inherited erased authority');
  const rejoinA = await libraryBook(Zotero, rejoined.libraryID, `${job.marker} rejoined source`);
  const rejoinB = await libraryBook(Zotero, rejoined.libraryID, `${job.marker} rejoined target`);
  const rejoinedState = await linked(app, production.gateway, rejoinA, rejoinB, 'Fresh rejoined library authority');
  check(readyState(rejoinedState).head !== present(job.removedState).head, 'Rejoined group inherited its erased local head');
  await rejoined.eraseTx(); await rejects(() => app.read(scope), 'endpoint');
  const idle = await localGroup(job, Zotero, 'idle'), idleScope = `group:${groupIDs.idle}` as const;
  await until(Zotero, () => [...present(ui.root.querySelector<HTMLSelectElement>('[data-rr-library]')).options].some(option => option.value === idleScope && !option.disabled), 'new native group choice');
  const a = await libraryBook(Zotero, idle.libraryID, `${job.marker} idle source`), b = await libraryBook(Zotero, idle.libraryID, `${job.marker} idle target`);
  await linked(app, production.gateway, a, b, 'Local idle group metadata');
  type(ui.window, ui.root.querySelector<HTMLSelectElement>('[data-rr-library]'), idleScope);
  await until(Zotero, () => ui.root.dataset.rrState === 'ready' && ui.root.dataset.rrLibrary === idleScope, 'new group selected');
  idle.name = `${job.marker} renamed read only`; idle.editable = false; await idle.saveTx();
  await until(Zotero, () => present(ui.root.querySelector<HTMLButtonElement>('[data-rr-action="new-rule"]')).disabled
    && [...present(ui.root.querySelector<HTMLSelectElement>('[data-rr-library]')).options].find(option => option.value === idleScope)?.textContent === idle.name, 'native rename and read-only refresh');
  idle.name = `${job.marker} editable again`; idle.editable = true; await idle.saveTx();
  await until(Zotero, () => !present(ui.root.querySelector<HTMLButtonElement>('[data-rr-action="new-rule"]')).disabled, 'native write permission restored');
  await idle.eraseTx(); await unavailable(Zotero, ui.root, idleScope);
  await rejects(() => app.read(idleScope), 'endpoint'); await librariesPreserved(api, job);
  type(ui.window, ui.root.querySelector<HTMLSelectElement>('[data-rr-library]'), 'self');
  await until(Zotero, () => ui.root.dataset.rrState === 'ready' && ui.root.dataset.rrLibrary === 'self', 'explicit recovery from idle group loss');
  ui.window.close();
  return { activeDraftPreservedAndLocked: true, idleRemovalExplicit: true, oldScopeReadAndReceiptRejected: true,
    dynamicGroupChoices: true, recreatedOwnerUsesFreshTransport: true, renameAndPermissionRefresh: true, explicitRecovery: true, unrelatedLibrariesPreserved: true };
}

/** Erase an owned local group while disabled, then verify fresh production scopes after re-enable. @param {object} job Saved unrelated states. @param {object} api Actual native platform. @returns {Promise<object>} Disabled native removal evidence. */
export async function reconciliationLibraryDisabled(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api, production = await resources(job, api), group = await localGroup(job, Zotero, 'disabled');
  const a = await libraryBook(Zotero, group.libraryID, `${job.marker} disabled source`), b = await libraryBook(Zotero, group.libraryID, `${job.marker} disabled target`);
  await linked(Zotero.ReferenceRelationships!.application, production.gateway, a, b, 'Disabled group authority');
  await setEnabled(Zotero, production.addon, false); await group.eraseTx(); await setEnabled(Zotero, production.addon, true);
  const app = Zotero.ReferenceRelationships!.application;
  await rejects(() => app.read(`group:${groupIDs.disabled}`), 'endpoint'); await librariesPreserved(api, job);
  const ui = await preferences(api);
  for (const role of ['removed', 'idle', 'disabled'] as const) check(![...present(ui.root.querySelector<HTMLSelectElement>('[data-rr-library]')).options].some(option => option.value === `group:${groupIDs[role]}`), 'Restarted choices contain a removed group');
  ui.window.close();
  return { disabledGroupRemoval: true, freshScopesRejectRemovedGroup: true, unrelatedLibrariesPreserved: true };
}
