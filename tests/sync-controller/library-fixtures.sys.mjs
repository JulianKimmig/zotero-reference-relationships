/** Native local library fixtures are restricted to new unsigned-in profiles and never touch server memberships. */
import { check } from './ui-helpers.sys.mjs';

export const groupIDs = { keep: 9000801, copy: 9000802, removed: 9000803, idle: 9000804, disabled: 9000805, pending: 9000806 };

/** Create an actual native local group only in a fresh anonymous fixture. @param {object} job Marker and signed test group exclusions. @param {object} Zotero Native platform. @param {string} role Fixed isolated role. @returns {Promise<object>} Real persisted native group. */
export async function localGroup(job, Zotero, role) {
  check(!Zotero.Users.getCurrentUserID(), 'Library removal fixtures require an unsigned-in profile');
  const groupID = groupIDs[role];
  check(Number.isSafeInteger(groupID) && !Object.values(job.groups).includes(groupID) && !Zotero.Groups.get(groupID), 'Refusing to replace an existing or signed development group');
  const group = new Zotero.Group({ groupID, name: `${job.marker} ${role}`, description: 'Disposable local-only lifecycle fixture',
    version: 1, editable: true, filesEditable: true });
  await group.saveTx(); return group;
}

/** Create one actual regular item in the explicit native library. @param {object} Zotero Native platform. @param {number} libraryID Native owner. @param {string} title Fixture label. @returns {Promise<object>} Real saved item. */
export async function libraryBook(Zotero, libraryID, title) {
  const item = new Zotero.Item('book'); item.libraryID = libraryID; item.setField('title', title); await item.saveTx(); return item;
}

/** Scope an actual native bibliographic identity through the production gateway. @param {object} gateway Native gateway. @param {object} item Native item. @returns {object} Exact ItemRef. */
export function libraryRef(gateway, item) { return gateway.ref(item); }

/** Publish one actual relationship using its issued review and native transaction. @param {object} app Production application. @param {object} gateway Native gateway. @param {object} source Source native book. @param {object} target Target native book. @param {string} note Literal metadata. @returns {Promise<object>} Complete saved library state. */
export async function linked(app, gateway, source, target, note) {
  const draft = await app.draftCreate({ source: libraryRef(gateway, source), target: libraryRef(gateway, target), type: 'referencing', metadata: { note } });
  await app.applyReviewed(await app.preview(draft.command, draft.expectedRevision)); return app.read(gateway.scope(source.libraryID));
}

/** Require exact unrelated personal/group authority and copied-note contents. @param {object} api Actual platform. @param {object} saved Captured fixture states and IDs. @returns {Promise<void>} */
export async function librariesPreserved(api, saved) {
  const { Zotero } = api, app = Zotero.ReferenceRelationships.application;
  app.invalidateAll();
  check(JSON.stringify(await app.read('self')) === JSON.stringify(saved.personal), 'Group lifecycle changed personal authority');
  check(JSON.stringify(await app.read(`group:${groupIDs.keep}`)) === JSON.stringify(saved.keep), 'Group lifecycle changed another group authority');
  check((await app.read(`group:${groupIDs.copy}`)).state === 'uninitialized', 'Copied items inherited relationship authority');
  const note = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, saved.noteKey);
  if (note) await note.loadDataType('note');
  check(note?.getNote() === saved.noteText, 'Unrelated ordinary child note changed');
}
