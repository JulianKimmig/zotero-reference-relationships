/** An actual pending user Save cannot publish into a group removed by a held native transaction. */
import { present } from './evidence.sys.mts';
import type { FormControl } from '../../src/ui/contracts.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { check, until, click } from './ui-helpers.sys.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { preferences, openRule, fillRule, previewRule } from './rule-preferences-helpers.sys.mts';
import { groupIDs, localGroup, libraryBook, linked, librariesPreserved } from './library-fixtures.sys.mts';

/** Remove an owned local group while a real DOM Save awaits the native transaction boundary. @param {object} job Unrelated saved states. @param {object} api Actual platform. @returns {Promise<object>} Rejected save and preserved locked draft/other libraries. */
export async function reconciliationLibraryPending(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api, production = await resources(job, api), app = Zotero.ReferenceRelationships!.application;
  const group = await localGroup(job, Zotero, 'pending');
  const a = await libraryBook(Zotero, group.libraryID, `${job.marker} pending source`), b = await libraryBook(Zotero, group.libraryID, `${job.marker} pending target`);
  await linked(app, production.gateway, a, b, 'Actual pending-save group');
  const ui = await preferences(api, `group:${groupIDs.pending}`), editor = await openRule(api, ui.root);
  fillRule(ui.window, editor, { id: 'pending-rule-must-not-publish' }); await previewRule(api, editor);
  const entered = Zotero.Promise.defer(), change = Zotero.Promise.defer(), changed = Zotero.Promise.defer(), release = Zotero.Promise.defer();
  const outer = Zotero.DB.executeTransaction(async function heldActualLibraryRemoval() {
    entered.resolve(); await change.promise; await group.erase(); changed.resolve(); await release.promise;
  });
  try {
    await entered.promise; click(editor, 'save-rule'); await Zotero.Promise.delay(100);
    check(present(editor.querySelector<HTMLButtonElement>('[data-rr-action="save-rule"]')).disabled && !present(editor.querySelector<HTMLElement>('[role="alert"]')).textContent,
      'User Save failed before the held library change or did not lock its controls');
    change.resolve(); await changed.promise;
  } finally { change.resolve(); release.resolve(); await outer; }
  await until(Zotero, () => ui.root.dataset.rrState === 'unavailable'
    && present(editor.querySelector<HTMLElement>('[role="alert"]')).textContent, 'pending Save rejected after actual group removal');
  check(editor.isConnected && present(editor.querySelector<HTMLInputElement>('[data-rr-rule-field="id"]')).value === 'pending-rule-must-not-publish', 'Rejected pending Save discarded visible draft values');
  for (const control of editor.querySelectorAll<FormControl>('input,textarea,select,button')) {
    if (control.dataset.rrAction !== 'cancel-rule') check(control.disabled, 'Save completion re-enabled a removed-group control');
  }
  check(!present(ui.root.querySelector<HTMLSelectElement>('[data-rr-library]')).disabled && !Zotero.Groups.get(groupIDs.pending), 'Pending Save blocked explicit recovery or restored the removed group');
  await librariesPreserved(api, job); ui.window.close();
  return { actualSavePendingBeforeRemoval: true, removedGroupSaveRejected: true,
    draftPreservedAndLockedAfterCompletion: true, unrelatedLibrariesPreserved: true };
}
