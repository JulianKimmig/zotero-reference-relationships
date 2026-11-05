/** Real editor/storage feasibility actions; no production backend is installed. */
import { noteTools } from './note-tools.sys.mjs';
import { runLifecycle } from './lifecycle.sys.mjs';
import { runPublication } from './publication.sys.mjs';

/**
 * Exercise real editor serialization and its transactional save path.
 * @param {object} job Explicit experiment marker/options.
 * @param {object} api Real native controller APIs.
 * @returns {Promise<object>} Verifiable note key and semantic/hash evidence.
 */
async function editorRoundTrip(job, api) {
  const t = noteTools(api);
  const { Zotero } = api;
  await api.synchronize();
  const payload = { marker: job.marker, scope: 'personal', text: 'Cafe\u0301 Überprüfung 你好 <>& " \\ \n',
    metadata: { number: 3.25, bool: true, empty: '', date: '2026-11-05', enumeration: 'similar', nested: [null, false] } };
  const record = await t.makeRecord(payload);
  const note = await t.writeNote(Zotero.Libraries.userLibraryID, record);
  const originalHTML = note.getNote();
  const editor = await Zotero.Notes.open(note.id);
  t.check(!!editor, 'Real note editor did not open');
  await editor._initPromise;
  const snapshot = JSON.parse(JSON.stringify(editor._iframeWindow.wrappedJSObject.getDataSync(false)));
  t.check(typeof snapshot.html === 'string', 'Real editor did not return HTML');
  t.check(t.canonicalJSON(t.parse(snapshot.html)) === t.canonicalJSON(record), 'Editor serialization changed metadata');
  await editor._save(snapshot);
  const stored = await t.readNote(note.libraryID, note.key);
  t.check(stored.body.hash === record.hash, 'Editor changed the record digest');
  const commit = await t.makeCommit({ parents: [], records: [{ key: note.key, hash: record.hash }] });
  const state = await t.evaluate([{ key: 'editor-commit', body: commit }], [stored]);
  t.check(state.state === 'ready', 'Saved record failed native integrity evaluation');
  const tabID = editor._tabID;
  if (tabID) Zotero.getMainWindow().Zotero_Tabs.close(tabID);
  await api.synchronize();
  return { noteKey: note.key, recordHash: record.hash, canonical: t.canonicalJSON(record),
    editorHTMLChanged: originalHTML !== snapshot.html, standalone: note.isTopLevelItem() };
}

/** Verify the editor's exact semantic result on another real client. @param {object} job Expected note/hash. @param {object} api Native APIs. @returns {Promise<object>} Cross-client result. */
async function verifyEditor(job, api) {
  const t = noteTools(api);
  await api.synchronize();
  const record = await t.readNote(api.Zotero.Libraries.userLibraryID, job.noteKey);
  t.check(!!record && record.body.hash === job.recordHash, 'Synced editor note/hash is missing');
  t.check(t.canonicalJSON(record.body) === job.canonical, 'Cross-client editor payload differs');
  t.check(await t.digest(t.canonicalJSON(record.body.payload)) === record.body.hash, 'Synced metadata integrity failed');
  return { noteKey: job.noteKey, hashVerified: true, unicode: record.body.payload.text };
}

/** Dispatch explicit storage experiments. @param {object} job Action. @param {object} api Native APIs. @returns {Promise<object>} Experiment evidence. */
export async function runExperiment(job, api) {
  if (job.action.startsWith('publication:')) return runPublication(job, api);
  if (job.action === 'feasibility:editor') return editorRoundTrip(job, api);
  if (job.action === 'feasibility:verify-editor') return verifyEditor(job, api);
  if (['feasibility:lifecycle', 'feasibility:verify-lifecycle', 'feasibility:identity-seed',
    'feasibility:identity-verify'].includes(job.action)) return runLifecycle(job, api);
  throw new Error(`Unknown feasibility action: ${job.action}`);
}
