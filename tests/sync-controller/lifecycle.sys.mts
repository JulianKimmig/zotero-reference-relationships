/** Native lifecycle proofs for standalone authority and reversible endpoint projection. */
import { found, present } from './evidence.sys.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { noteTools } from './note-tools.sys.mts';
import type { ExperimentRecord } from './model-contracts.mts';

/** The lifecycle experiment deliberately stores its own opaque snapshot rather than production v1 authority. */
interface LifecyclePayload {
  marker: string; libraryScope: string;
  assertions: { id: string; source: string; target: string; type: string; metadata: Record<string, string | boolean> }[];
  derivedSupports: { root: string; rule: string; source: string; target: string; type: string }[];
}

/** Resolve an immutable library-scoped key through native merge aliases. @param {object} api Native APIs. @param {number} libraryID Local library. @param {string} key Original key. @returns {Promise<object>} Current endpoint state. */
async function resolveEndpoint(api: NativeAPI, libraryID: number, key: string) {
  const { Zotero } = api;
  const original = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
  if (original && !original.deleted) return { state: 'active', key: original.key };
  const uri = `${Zotero.URI.getLibraryURI(libraryID)}/items/${key}`;
  const aliases = await Zotero.Relations.getByPredicateAndObject('item', Zotero.Relations.replacedItemPredicate, uri);
  if (aliases.length > 1) throw new Error('Ambiguous native merge aliases');
  if (aliases.length === 1) return { state: aliases[0].deleted ? 'trashed' : 'active', key: aliases[0].key };
  return { state: original ? 'trashed' : 'missing', key };
}

/** Create a real regular-item endpoint. @param {object} api Native APIs. @param {number} libraryID Library. @param {string} title Marker. @returns {Promise<object>} Native item. */
async function endpoint(api: NativeAPI, libraryID: number, title: string) {
  const item = new api.Zotero.Item('book');
  item.libraryID = libraryID;
  item.setField('title', title);
  await item.saveTx();
  return item;
}

/** Prove merge/undo/redo, deletion, duplicate/copy and independent metadata. @param {object} job Marker/groups. @param {object} api Native APIs. @returns {Promise<object>} Lifecycle evidence. */
async function lifecycle(job: ControllerJob, api: NativeAPI) {
  const { Zotero, ChromeUtils } = api;
  const t: ReturnType<typeof noteTools> = noteTools(api);
  await api.synchronize();
  t.check(!Object.hasOwn(Zotero, 'ReferenceRelationships'), 'Lifecycle test must not depend on an installed plugin');
  const libraryID = Zotero.Libraries.userLibraryID;
  const first = await endpoint(api, libraryID, `${job.marker} survivor`);
  const second = await endpoint(api, libraryID, `${job.marker} merged endpoint`);
  const orphan = await endpoint(api, libraryID, `${job.marker} erased endpoint`);
  const payload = { marker: job.marker, libraryScope: 'personal', assertions: [
    { id: 'manual-self', source: first.key, target: second.key, type: 'referencing', metadata: { text: 'retain manual support' } },
    { id: 'manual-first', source: first.key, target: orphan.key, type: 'similar', metadata: { flag: false } },
    { id: 'manual-second', source: second.key, target: orphan.key, type: 'similar', metadata: { flag: true } },
  ], derivedSupports: [
    { root: 'manual-first', rule: 'reverse-v1', source: orphan.key, target: first.key, type: 'similar' },
    { root: 'manual-second', rule: 'reverse-v1', source: orphan.key, target: second.key, type: 'similar' },
  ] };
  const body = await t.makeRecord(payload);
  const note = await t.writeNote(libraryID, body);
  const duplicate = first.clone();
  duplicate.setField('title', `${job.marker} duplicate`);
  await duplicate.saveTx();
  const copy = first.clone(found(Zotero.Groups.get(job.groups.writable)).libraryID);
  copy.setField('title', `${job.marker} cross-library copy`);
  await copy.saveTx();
  t.check(duplicate.key !== first.key && copy.libraryID !== first.libraryID, 'Native duplicate/copy did not create distinct identities');
  const { mergeItems } = ChromeUtils.importESModule('chrome://zotero/content/mergeItems.mjs');
  await mergeItems(first, [second]);
  let resolved = await resolveEndpoint(api, libraryID, second.key);
  t.check(resolved.key === first.key && second.deleted, 'Native merge projection failed');
  t.check((await resolveEndpoint(api, libraryID, payload.assertions[1].source)).key === resolved.key,
    'Fixture did not create a projected assertion collision');
  t.check(present((await t.readNote<typeof body>(libraryID, note.key))).body.hash === body.hash,
    'Merge lost distinct explicit metadata or derived supports');
  await Zotero.UndoHistory.undo();
  resolved = await resolveEndpoint(api, libraryID, second.key);
  t.check(resolved.key === second.key && !second.deleted, 'Merge Undo did not recover original endpoint');
  t.check(present((await t.readNote<typeof body>(libraryID, note.key))).body.hash === body.hash,
    'Undo failed to recover distinct assertion ownership');
  await Zotero.UndoHistory.redo();
  resolved = await resolveEndpoint(api, libraryID, second.key);
  t.check(resolved.key === first.key && second.deleted, 'Merge Redo did not restore survivor projection');
  first.deleted = true;
  await first.saveTx();
  t.check((await resolveEndpoint(api, libraryID, second.key)).state === 'trashed', 'Trash did not make the endpoint inactive');
  first.deleted = false;
  await first.saveTx();
  await orphan.eraseTx();
  t.check((await resolveEndpoint(api, libraryID, orphan.key)).state === 'missing', 'Permanent erase was not detectable');
  const stored = await t.readNote<typeof body>(libraryID, note.key);
  t.check(present(stored).body.hash === body.hash && t.canonicalJSON(present(stored).body) === t.canonicalJSON(body), 'Lifecycle mutated or deleted standalone authority');
  t.check(!present(stored).body.payload.assertions.some(edge => edge.source === duplicate.key || edge.target === duplicate.key), 'Duplicate inherited graph assertions');
  const undoFirst = await endpoint(api, libraryID, `${job.marker} undo survivor`);
  const undoSecond = await endpoint(api, libraryID, `${job.marker} undo original`);
  const undoBody = await t.makeRecord({ marker: job.marker, source: undoSecond.key,
    target: undoFirst.key, metadata: { retainedAfterUndo: true } });
  const undoNote = await t.writeNote(libraryID, undoBody);
  await mergeItems(undoFirst, [undoSecond]);
  await Zotero.UndoHistory.undo();
  t.check((await resolveEndpoint(api, libraryID, undoSecond.key)).key === undoSecond.key,
    'Plugin-disabled merge/Undo did not restore original ownership');
  await api.synchronize();
  return { noteKey: note.key, recordHash: body.hash, survivorKey: first.key, originalKey: second.key,
    erasedKey: orphan.key, duplicateKey: duplicate.key, copiedKey: copy.key,
    mergeUndoRedo: true, collapsedSelfEdgeDetectable: true, standaloneRetained: true,
    collisionMetadataAndSupportsRetained: true, undoOriginalKey: undoSecond.key,
    undoNoteKey: undoNote.key, undoHash: undoBody.hash };
}

/** Verify persisted lifecycle state in a separately restarted client. @param {object} job Known fixture identities. @param {object} api Native APIs. @returns {Promise<object>} Cross-client proof. */
async function verifyLifecycle(job: ControllerJob, api: NativeAPI) {
  const t: ReturnType<typeof noteTools> = noteTools(api);
  await api.synchronize();
  const libraryID = api.Zotero.Libraries.userLibraryID;
  const stored = await t.readNote<ExperimentRecord<LifecyclePayload>>(libraryID, present(job.noteKey));
  t.check(!!stored && stored.body.hash === job.recordHash, 'Restart lost graph authority');
  t.check((await resolveEndpoint(api, libraryID, present(job.originalKey))).key === job.survivorKey, 'Restart lost merge projection');
  t.check((await resolveEndpoint(api, libraryID, present(job.erasedKey))).state === 'missing', 'Restart revived erased endpoint');
  const undoRecord = await t.readNote<ExperimentRecord>(libraryID, present(job.undoNoteKey));
  t.check(undoRecord?.body.hash === job.undoHash &&
    (await resolveEndpoint(api, libraryID, present(job.undoOriginalKey))).key === job.undoOriginalKey,
  'Restart after plugin-disabled merge/Undo lost original ownership');
  t.check(present(stored).body.payload.assertions.length === 3 && present(stored).body.payload.derivedSupports.length === 2,
    'Restart lost collision metadata or separate derived supports');
  return { standaloneRetained: true, mergeProjectionRetained: true, erasedEndpointReported: true,
    pluginDisabledUndoRetainedAfterRestart: true, collisionMetadataAndSupportsRetained: true };
}

/** Create real metadata before the first account sign-in. @param {object} job Marker. @param {object} api Anonymous native client. @returns {Promise<object>} Keys and pre-auth URI. */
async function identitySeed(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api;
  const t: ReturnType<typeof noteTools> = noteTools(api);
  t.check(!Zotero.Users.getCurrentUserID(), 'Identity seed requires a genuinely unsigned-in profile');
  const item = await endpoint(api, Zotero.Libraries.userLibraryID, `${job.marker} before account login`);
  const body = await t.makeRecord({ marker: job.marker, libraryScope: 'personal', targetKey: item.key, metadata: { retained: true } });
  const note = await t.writeNote(item.libraryID, body);
  return { itemKey: item.key, noteKey: note.key, recordHash: body.hash,
    localURI: Zotero.URI.getItemURI(item), beforeUserID: null };
}

/** Verify the same immutable key-scoped payload after genuine account sign-in. @param {object} job Pre-login fixture. @param {object} api Signed-in native client. @returns {Promise<object>} Migration proof. */
async function identityVerify(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api;
  const t: ReturnType<typeof noteTools> = noteTools(api);
  await api.synchronize();
  const userID = Number(Zotero.Users.getCurrentUserID());
  t.check(userID > 0 && userID === job.expectedUserID, 'Identity fixture is not signed into the expected A account');
  const note = await t.readNote<ExperimentRecord<{ targetKey: string }>>(Zotero.Libraries.userLibraryID, present(job.noteKey));
  const item = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, present(job.itemKey));
  t.check(note && item && note.body.hash === job.recordHash && note.body.payload.targetKey === item.key, 'First sign-in lost or rewrote graph metadata');
  const currentURI = Zotero.URI.getItemURI(item);
  t.check(currentURI !== job.localURI && currentURI.includes(`/users/${userID}/`), 'Local-user identity did not become account identity');
  return { userID, oldURI: job.localURI, currentURI, immutablePayloadRetained: true };
}

/** Dispatch only known lifecycle experiments. @param {object} job Action/options. @param {object} api Native APIs. @returns {Promise<object>} Evidence. */
export async function runLifecycle(job: ControllerJob, api: NativeAPI) {
  if (job.action === 'feasibility:lifecycle') return lifecycle(job, api);
  if (job.action === 'feasibility:verify-lifecycle') return verifyLifecycle(job, api);
  if (job.action === 'feasibility:identity-seed') return identitySeed(job, api);
  if (job.action === 'feasibility:identity-verify') return identityVerify(job, api);
  throw new Error(`Unknown lifecycle experiment ${job.action}`);
}
