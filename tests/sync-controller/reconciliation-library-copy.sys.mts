/** Drive Zotero's actual native cross-library copy path with child notes and verify independent graph ownership. */
import { present, found } from './evidence.sys.mts';
import type { TestWindow } from './platform-contracts.mts';
import type { TestItem, TestLibrary } from './platform-contracts.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { TestPlatform } from './platform-contracts.mts';
import { check, until, selectPane, type } from './ui-helpers.sys.mts';
import { rejects } from './ui-permissions.sys.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { groupIDs, localGroup, libraryBook, linked, librariesPreserved } from './library-fixtures.sys.mts';
import { preferences } from './rule-preferences-helpers.sys.mts';

/** Invalid native authority must remain a visible error with mutations disabled. @param {object} api Actual platform. @param {object} group Disposable target group. @returns {Promise<void>} */
async function invalidAuthority(api: NativeAPI, group: TestLibrary) {
  const { Zotero } = api, bad = new Zotero.Item('note'); bad.libraryID = group.libraryID;
  bad.setNote('<h1>Reference Relationships data</h1><pre>{"format":"reference-relationships/future"}</pre>'); await bad.saveTx();
  let ui: Awaited<ReturnType<typeof preferences>> | undefined;
  try {
    ui = await preferences(api);
    type(ui.window, ui.root.querySelector<HTMLSelectElement>('[data-rr-library]'), `group:${group.groupID}`);
    await until(Zotero, () => present(ui).root.dataset.rrState === 'error', 'invalid authority visible error');
    check(present(ui.root.querySelector<HTMLButtonElement>('[data-rr-action="new-rule"]')).disabled, 'Unavailable authority left the new-rule action enabled');
    check(present(ui.root.querySelector<HTMLElement>(':scope > [role="alert"]')).textContent.includes('Unknown authority format'), 'Authority failure was silently treated as empty');
  } finally { if (ui) ui.window.close(); await bad.eraseTx(); }
}

/** Copy a real native reference through the same collection-tree method as native drag/drop. @param {object} Zotero Actual platform. @param {Window} window Real main window. @param {object} item Real source. @param {object} target Native library. @returns {Promise<object>} Real core-created linked copy. */
async function nativeCopy(Zotero: TestPlatform, window: TestWindow, item: TestItem, target: TestLibrary) {
  const tree = window.ZoteroPane.collectionsView;
  const index = await until(Zotero, () => {
    const index = tree.getRowIndexByID(`L${target.libraryID}`);
    return Number.isInteger(index) && index !== false && index >= 0 ? { value: index } : null;
  }, 'native target library row');
  const row = tree.getRow(index.value); check(row.ref.libraryID === target.libraryID, 'Native copy row has another owner');
  const id = await Zotero.DB.executeTransaction(async function actualCoreCopy() {
    return tree._copyItem({ item, targetLibraryID: target.libraryID, targetTreeRow: row,
      options: { tags: true, childNotes: true, childLinks: false, childFileAttachments: false, annotations: false } });
  });
  const copied = await Zotero.Items.getAsync(id);
  check(found(copied).libraryID === target.libraryID && found(copied).key !== item.key && found(await item.getLinkedItem(target.libraryID, true)).id === found(copied).id,
    'Core copy did not create an independent linked identity');
  return copied;
}

/** Seed independent libraries, copy in both directions and leave a group-removal fixture. @param {object} job Marker/artifact. @param {object} api Actual platform. @returns {Promise<object>} Saved native ownership evidence. */
export async function reconciliationLibraryCopy(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api, production = await resources(job, api), gateway = production.gateway, app = Zotero.ReferenceRelationships!.application;
  const keep = await localGroup(job, Zotero, 'keep'), copy = await localGroup(job, Zotero, 'copy'), removed = await localGroup(job, Zotero, 'removed');
  const a = await libraryBook(Zotero, Zotero.Libraries.userLibraryID, `${job.marker} personal source`);
  const b = await libraryBook(Zotero, a.libraryID, `${job.marker} personal target`);
  const note = new Zotero.Item('note'); note.libraryID = a.libraryID; note.parentID = a.id;
  note.setNote('<p>Ordinary child note Café 你好</p>'); await note.saveTx();
  const personal = await linked(app, gateway, a, b, 'Personal graph metadata Café 你好');
  const g = await libraryBook(Zotero, keep.libraryID, `${job.marker} retained group source`);
  const h = await libraryBook(Zotero, keep.libraryID, `${job.marker} retained group target`);
  const keepState = await linked(app, gateway, g, h, 'Another group metadata');
  const r = await libraryBook(Zotero, removed.libraryID, `${job.marker} removed group source`);
  const s = await libraryBook(Zotero, removed.libraryID, `${job.marker} removed group target`);
  const removedState = await linked(app, gateway, r, s, 'Removed group metadata retained until native removal');
  const window = Zotero.getMainWindow(), copied = found(await nativeCopy(Zotero, window, a, copy));
  check((await app.read(`group:${groupIDs.copy}`)).state === 'uninitialized', 'Copy created destination authority');
  const children = found(copied).getNotes(); check(children.length === 1, 'Native copy did not include ordinary child notes');
  const child = await Zotero.Items.getAsync(children[0]); check(found(child).getNote() === note.getNote(), 'Core copy changed ordinary child note content');
  const pane = await selectPane(Zotero, window, found(copied)); check(pane.dataset.rrState === 'uninitialized', 'Copied native reference inherited source graph UI');
  const personalCopy = await nativeCopy(Zotero, window, g, found(Zotero.Libraries.get(Zotero.Libraries.userLibraryID)));
  check((await app.listRelationships(gateway.ref(personalCopy), 'both', null, { offset: 0, limit: 25 })).total === 0,
    'Group-to-personal copy inherited relationship ownership');
  await rejects(() => app.draftCreate({ source: gateway.ref(a), target: gateway.ref(copied), type: 'similar', metadata: {} }), 'validation');
  const saved = { personal, keep: keepState, noteKey: note.key, noteText: note.getNote(), removedState,
    removedSource: r.key, removedTarget: s.key, copiedKey: found(copied).key };
  await librariesPreserved(api, saved);
  await invalidAuthority(api, copy); await librariesPreserved(api, saved);
  return { ...saved, nativeCopyWithChildren: true, bidirectionalCopyNoInheritance: true, crossLibraryLinkRejected: true, invalidAuthorityLocksMutations: true };
}
