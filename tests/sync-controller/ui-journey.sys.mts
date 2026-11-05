/** End-to-end relationship editing in actual Zotero using the built production XPI. */
import { present, readyState, found } from './evidence.sys.mts';
import type { FormControl } from '../../src/ui/contracts.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { TestItem } from './platform-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { TestPlatform } from './platform-contracts.mts';
import { check, until, selectPane, createThroughUI, click, type, contextMenu, previewRace } from './ui-helpers.sys.mts';
import { permissionFixtures, permissionJourney, invalidEndpoints, rejects } from './ui-permissions.sys.mts';

/** Create a labeled regular reference. @param {object} Zotero Native API. @param {number} libraryID Scope. @param {string} title Label. @returns {Promise<object>} Actual book. */
async function book(Zotero: TestPlatform, libraryID: number, title: string) {
  const item = new Zotero.Item('book'); item.libraryID = libraryID; item.setField('title', title); await item.saveTx(); return item;
}

/** Read actual current authority through the installed application. @param {object} Zotero Native API. @returns {Promise<object>} State. */
async function state(Zotero: TestPlatform) { return Zotero.ReferenceRelationships!.application.read('self'); }

/**
 * Exercise the installed UI and leave a relationship for the next actual process.
 * @param {object} job Phase, XPI and fixture identifiers.
 * @param {object} api Real platform, native AddonManager and scoped synchronization.
 * @returns {Promise<object>} Native UI journey results and fixture keys.
 */
async function runJourney(job: ControllerJob, api: NativeAPI) {
  const { Zotero, ChromeUtils } = api;
  if (job.action === 'ui:prepare') {
    check(!Zotero.Users.getCurrentUserID(), 'Fresh GUI profile unexpectedly has an account');
    return { anonymous: true };
  }
  if (job.action === 'ui:permission-fixtures') return permissionFixtures(job, api);
  if (job.action === 'ui:permissions') await api.synchronize();
  const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const addon = await AddonManager.installTemporaryAddon(Zotero.File.pathToFile(present(job.xpi)));
  check(addon.isActive, 'Production XPI failed to activate');
  if (job.action === 'ui:create') Zotero.Debug.setStore(true);
  const window = Zotero.getMainWindow(), libraryID = Zotero.Libraries.userLibraryID;
  await until(Zotero, () => window.ZoteroPane.loaded
    && typeof window.ZoteroPane.itemsView?.waitForLoad === 'function'
    && typeof window.ZoteroPane.collectionsView?.waitForLoad === 'function', 'native main-window trees');
  await Promise.all([window.ZoteroPane.itemsView.waitForLoad(), window.ZoteroPane.collectionsView.waitForLoad()]);
  if (job.action === 'ui:permissions') return permissionJourney(job, api);
  if (job.action === 'ui:create') {
    const a = await book(Zotero, libraryID, `${job.marker} source A`);
    const b = await book(Zotero, libraryID, `${job.marker} target B`);
    const c = await book(Zotero, libraryID, `${job.marker} other C`);
    a.addRelatedItem(c); c.addRelatedItem(a); await a.saveTx(); await c.saveTx();
    const ordinary = new Zotero.Item('note'); ordinary.libraryID = libraryID;
    ordinary.setNote('<div data-schema-version="9"><h1>RR unrelated note</h1><p>Preserve this content</p></div>'); await ordinary.saveTx();
    const originalNote = ordinary.getNote(), root = await selectPane(Zotero, window, a);
    check(root.dataset.rrState === 'uninitialized', 'Fresh personal graph must require explicit first save');
    await contextMenu(Zotero, window, root);
    const invalid = await invalidEndpoints(api, a, ordinary, 'AAAAAAAA', job.groups.writable);
    await previewRace(api, window, root, b);
    await createThroughUI(api, window, root, b, 'cancelled metadata', false);
    check((await state(Zotero)).state === 'uninitialized', 'Cancel created authority');
    const note = 'Café 你好 😀 <img src="x" onerror="invalid"> & relationship';
    await createThroughUI(api, window, root, b, note, true, true);
    const created = await state(Zotero); check(created.state === 'ready' && created.snapshot.assertions.length === 1, 'Saved relationship is missing');
    const assertion = created.snapshot.assertions[0];
    check(assertion.source.key === a.key && assertion.target.key === b.key && assertion.type === 'referencing' && assertion.metadata.note === note, 'Saved form values differ');
    check(root.textContent.includes(note) && !root.querySelector<HTMLElement>('img[src="x"]'), 'Metadata was not rendered as literal text');
    const application = Zotero.ReferenceRelationships!.application;
    const stale = await application.draftCreate({ source: { library: 'self', key: a.key },
      target: { library: 'self', key: c.key }, type: 'similar', metadata: { note: 'stale' } });
    click(root, 'edit');
    await until(Zotero, () => root.querySelector<HTMLElement>('[data-rr-editor]'), 'edit relationship');
    const editedNote = 'Edited relationship — retained after restart';
    type(window, root.querySelector<FormControl>('[data-rr-field="note"]'), editedNote);
    click(root, 'preview');
    await until(Zotero, () => root.querySelector<HTMLButtonElement>('[data-rr-action="save"]') && !present(root.querySelector<HTMLButtonElement>('[data-rr-action="save"]')).disabled, 'edit preview');
    click(root, 'save'); await until(Zotero, () => !root.querySelector<HTMLElement>('[data-rr-editor]'), 'saved edit');
    check(readyState((await state(Zotero))).snapshot.assertions[0].metadata.note === editedNote, 'Edited metadata was lost');
    await rejects(() => application.apply(stale.command, stale.expectedRevision), 'conflict');
    const unavailable = await application.draftCreate({ source: { library: 'self', key: a.key },
      target: { library: 'self', key: c.key }, type: 'similar', metadata: { note: 'unavailable' } });
    await application.preview(unavailable.command, unavailable.expectedRevision);
    c.deleted = true; await c.saveTx();
    try { await rejects(() => application.apply(unavailable.command, unavailable.expectedRevision), 'endpoint'); }
    finally { c.deleted = false; await c.saveTx(); }
    check(readyState((await state(Zotero))).snapshot.assertions.length === 1, 'Late ineligible endpoint created an assertion');
    await until(Zotero, () => root.dataset.rrState === 'ready' && root.querySelector<HTMLButtonElement>('[data-rr-action="navigate"]'), 'native notification refresh');
    click(root, 'navigate');
    await until(Zotero, () => window.ZoteroPane.getSelectedItems()[0]?.key === b.key, 'navigation to target');
    const incoming = await selectPane(Zotero, window, b);
    check(incoming.textContent.includes(a.getField('title')), 'Incoming relationship is missing');
    for (let attempt = 0; attempt < 3; attempt++) {
      const changing = window.ZoteroPane.selectItem(a.id);
      const changed = window.ZoteroPane.selectItem(c.id); await Promise.all([changing, changed]);
      const selected = window.ZoteroPane.getSelectedItems()[0];
      const current = await selectPane(Zotero, window, selected);
      check(current.dataset.rrState === 'ready', 'Latest visible selection did not render ready data');
      check(current.querySelectorAll<HTMLElement>('[data-rr-relation]').length === (selected.key === c.key ? 0 : 1), 'Previous selection relationships appeared on latest item');
    }
    check(ordinary.getNote() === originalNote && a.relatedItems.includes(c.key) && c.relatedItems.includes(a.key), 'Unrelated native data changed');
    if (job.sync) await api.synchronize();
    return { a: a.key, b: b.key, c: c.key, ordinary: ordinary.key, originalNote, assertionID: assertion.id,
      editedNote, invalid, contextMenu: true, staleRejected: true, changedEndpointRejected: true,
      previewRace: true, createdAndEdited: true, cancelUnchanged: true, navigated: true, selectionConsistent: true, nativeDataPreserved: true };
  }
  if (job.action === 'ui:restart') {
    const a = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, present(job.a)), b = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, present(job.b));
    const root = await selectPane(Zotero, window, found(a)), loaded = await state(Zotero);
    check(readyState(loaded).snapshot.assertions[0].id === job.assertionID && readyState(loaded).snapshot.assertions[0].metadata.note === job.editedNote, 'Restart lost relationship identity/metadata');
    click(root, 'remove');
    await until(Zotero, () => root.querySelector<HTMLButtonElement>('[data-rr-action="save"]') && !present(root.querySelector<HTMLButtonElement>('[data-rr-action="save"]')).disabled, 'remove preview');
    click(root, 'save');
    await until(Zotero, async () => readyState((await state(Zotero))).snapshot.assertions.length === 0, 'committed removal');
    await selectPane(Zotero, window, found(b));
    check(readyState((await state(Zotero))).snapshot.assertions.length === 0, 'Removal left an incoming assertion');
    return { restarted: true, removed: true };
  }
  throw new Error(`Unknown UI journey ${job.action}`);
}

/** Run the native journey with concrete DOM diagnostics on failure. @param {object} job Explicit UI fixture job. @param {object} api Actual platform resources. @returns {Promise<object>} Native report. */
export async function uiJourney(job: ControllerJob, api: NativeAPI) {
  try { return await runJourney(job, api); }
  catch (caught) { const error = caught instanceof Error ? caught : new Error(String(caught));
    const window = api.Zotero.getMainWindow();
    const panes = [...window.document.querySelectorAll<HTMLElement>('[data-rr-pane]')].map(node => ({
      key: node.dataset.rrItemKey, state: node.dataset.rrState, text: node.textContent.slice(0, 700),
      width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
      top: node.getBoundingClientRect().top,
      nativeVisible: present(node.closest<HTMLElement & { isPaneVisible(pane: string): boolean }>('item-details')).isPaneVisible(present(node.closest<HTMLElement & { skipRender: boolean }>('item-pane-custom-section')).dataset.pane! ),
      nativeSkip: present(node.closest<HTMLElement & { skipRender: boolean }>('item-pane-custom-section')).skipRender,
    }));
    error.message += `; UI=${JSON.stringify({ selected: window.ZoteroPane.getSelectedItems().map(item => item.key), panes })}`;
    if (job.action === 'ui:create') {
      const debug = await api.Zotero.Debug.get();
      error.message += `; trace=${debug.split('\n').filter(line => line.includes('ReferenceRelationships view')).slice(-70).join('\n')}`;
    }
    throw error;
  }
}
