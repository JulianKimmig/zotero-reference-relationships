/** Native immutable-publication assertions; all notes contain synthetic experiment data. */
import { found, present, errorMessage } from './evidence.sys.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { ExperimentRecord, ExperimentCommit, ExperimentState } from './model-contracts.mts';
import { noteTools } from './note-tools.sys.mts';

/**
 * Seal expected snapshots for exact comparison with real received notes.
 * @param {object} job Marker and accumulated native fixture keys.
 * @param {object} t Bound real note tools.
 * @returns {Promise<object>} Record envelopes and commit specifications.
 */
async function expectedNotes(job: ControllerJob, t: ReturnType<typeof noteTools>) {
  const original = { marker: job.marker, revision: 0,
    assertions: [{ id: 'synthetic-assertion', from: 'synthetic:alpha', to: 'synthetic:beta',
      type: 'supports', metadata: { text: 'Cafe\u0301 你好 😀 <>& " \\ \n', number: 3.25,
        active: true, empty: '', absent: null, date: '2026-11-05', enumeration: 'similar', nested: [false, 0] },
      provenance: { origin: 'synthetic-publication-test', explicit: true } }],
    rules: [{ id: 'synthetic-rule', version: 1, enabled: true, transform: 'reverse' }] };
  const next: typeof original = JSON.parse(t.canonicalJSON(original));
  next.revision = 1;
  next.rules[0].version = 2;
  const deleted: typeof original = JSON.parse(t.canonicalJSON(next));
  deleted.assertions = [];
  const edited: typeof original = JSON.parse(t.canonicalJSON(next));
  edited.assertions[0].metadata.text = 'B1 synthetic metadata edit: Å';
  edited.assertions[0].metadata.number = 7.5;
  edited.rules[0].version = 3;
  edited.rules[0].enabled = false;
  const resolved: typeof original = JSON.parse(t.canonicalJSON(edited));
  resolved.assertions = [];
  const records: Record<string, ExperimentRecord<typeof original>> = {};
  for (const [name, payload] of Object.entries({ payload0: original, payload1: next,
    deletePayload: deleted, editPayload: edited, resolutionPayload: resolved })) {
    records[name] = await t.makeRecord(payload);
  }
  return { records, commits: [
    ['commit0', [], 'payload0'], ['head1', ['commit0'], 'payload1'],
    ['deleteHead', ['head1'], 'deletePayload'], ['editHead', ['head1'], 'editPayload'],
    ['resolutionHead', ['deleteHead', 'editHead'], 'resolutionPayload'],
  ] satisfies [string, string[], string][] };
}

/**
 * Read only fixture keys and verify every immutable envelope against its snapshot.
 * @param {object} job Exact library-scoped fixture keys and marker.
 * @param {object} api Native resources, including real DB-backed Items.
 * @returns {Promise<object>} Actual model evaluation of received native notes.
 */
async function observe(job: ControllerJob, api: NativeAPI) {
  const t: ReturnType<typeof noteTools> = noteTools(api), keys = job.fixtures;
  const libraryID = found(api.Zotero.Groups.get(job.groups.writable)).libraryID;
  const expected = await expectedNotes(job, t);
  const commitBodies: Record<string, ExperimentCommit> = {};
  for (const [name, parents, record] of expected.commits) {
    if (!present(keys)[name]) continue;
    commitBodies[name] = await t.makeCommit({ parents: parents.map(parent => present(keys)[parent]),
      records: [{ key: present(keys)[record], hash: expected.records[record].hash }] });
  }
  const commits = await t.readMany(libraryID, Object.keys(commitBodies).map(name => present(keys)[name]));
  t.check(commits.length === Object.keys(commitBodies).length, 'Published fixture commit is missing');
  const records = await t.readMany(libraryID, Object.keys(expected.records).filter(name => present(keys)[name]).map(name => present(keys)[name]));
  for (const [bodies, notes] of [[commitBodies, commits], [expected.records, records]] as const) {
    for (const note of notes) {
      const name = present(Object.keys(bodies).find(name => present(keys)[name] === note.key));
      t.check(t.canonicalJSON(note.body) === t.canonicalJSON(bodies[name]), `Immutable fixture ${name} changed`);
      const item = await api.Zotero.Items.getByLibraryAndKeyAsync(libraryID, note.key);
      t.check(found(item).isTopLevelItem(), 'Metadata authority acquired an endpoint parent');
    }
  }
  return t.evaluate(commits, records);
}

/** Assert whole-state equality, including absence of payloads on pending/conflict.
 * @param {object} job Fixtures. @param {object} api Native APIs.
 * @param {object} expected Complete expected state. @returns {Promise<object>} Observed state.
 */
async function expectState(job: ControllerJob, api: NativeAPI, expected: ExperimentState) {
  const t: ReturnType<typeof noteTools> = noteTools(api), state = await observe(job, api);
  t.check(t.canonicalJSON(state) === t.canonicalJSON(expected),
    `Publication state mismatch: ${JSON.stringify({ expected, actual: state })}`);
  return state;
}

/** Assert a complete generation and its exact typed, normalized snapshot.
 * @param {object} job Fixtures. @param {object} api Native APIs.
 * @param {string} head Commit fixture name. @param {string} payload Record name.
 * @returns {Promise<object>} Verified native state.
 */
async function expectReady(job: ControllerJob, api: NativeAPI, head: string, payload: string) {
  const expected = await expectedNotes(job, noteTools(api));
  return expectState(job, api, { state: 'ready', head: present(job.fixtures)[head], payloads: [expected.records[payload].payload] });
}

/** Save an immutable payload/manifest pair using native notes, without synchronizing.
 * @param {object} job Mutable result key map. @param {object} api Native APIs.
 * @param {string} head New commit name. @param {string} record New record name.
 * @param {string[]} parents Parent commit names. @returns {Promise<void>} Locally saved notes.
 */
async function saveGeneration(job: ControllerJob, api: NativeAPI, head: string, record: string, parents: string[]) {
  const t: ReturnType<typeof noteTools> = noteTools(api), keys = job.fixtures;
  t.check(!present(keys)[head] && !present(keys)[record], 'Refusing to replace an existing immutable generation');
  const libraryID = found(api.Zotero.Groups.get(job.groups.writable)).libraryID;
  const expected = await expectedNotes(job, t);
  present(keys)[record] = (await t.writeNote(libraryID, expected.records[record])).key;
  const body = await t.makeCommit({ parents: parents.map(parent => present(keys)[parent]),
    records: [{ key: present(keys)[record], hash: expected.records[record].hash }] });
  present(keys)[head] = (await t.writeNote(libraryID, body)).key;
}

/**
 * Fail a real second save through native group permissions and prove SQL rollback.
 * @param {object} job Existing complete fixture graph; no new head is published.
 * @param {object} api Native Zotero transaction and permission APIs.
 * @returns {Promise<object>} Synthetic attempted keys and rollback evidence.
 */
async function failedTransaction(job: ControllerJob, api: NativeAPI) {
  const { Zotero, Services } = api, t: ReturnType<typeof noteTools> = noteTools(api);
  const writable = Zotero.Groups.get(job.groups.writable);
  const restricted = Zotero.Groups.get(job.groups.restricted);
  t.check(!!restricted && !restricted.editable, 'Rollback probe requires B1 restricted-group denial');
  const before = await observe(job, api), offline = Services.io.offline;
  const keys = [Zotero.DataObjectUtilities.generateKey(), Zotero.DataObjectUtilities.generateKey()];
  let firstWritten = false, denied = false;
  try {
    Services.io.offline = true;
    t.check(Services.io.offline, 'Failed to enter offline mode for the transaction probe');
    try {
      /** Execute actual native saves inside one outer transaction. @returns {Promise<void>} */
      await Zotero.DB.executeTransaction(async function writeThenDeny() {
        for (const [index, libraryID] of [found(writable).libraryID, found(restricted).libraryID].entries()) {
          const note = new Zotero.Item('note');
          note.libraryID = libraryID;
          note.key = keys[index];
          await note.loadPrimaryData();
          note.setNote(t.html(await t.makeRecord({ marker: job.marker, scope: 'synthetic-rollback', index })));
          await note.save();
          t.check(note.isTopLevelItem(), 'Rollback fixture must be standalone');
          if (index === 0) {
            t.check(Number(await Zotero.DB.valueQueryAsync(
              'SELECT COUNT(*) FROM items WHERE libraryID=? AND key=?', [libraryID, keys[0]])) === 1,
            'First native save never reached the transaction');
            firstWritten = true;
          }
        }
      });
    } catch (error) {
      t.check(firstWritten && String(errorMessage(error)).includes('Cannot edit item'), 'Unexpected transaction failure');
      denied = true;
    }
    t.check(firstWritten && denied, 'Restricted save did not roll back a real preceding save');
    for (const [index, libraryID] of [found(writable).libraryID, found(restricted).libraryID].entries()) {
      t.check(Number(await Zotero.DB.valueQueryAsync(
        'SELECT COUNT(*) FROM items WHERE libraryID=? AND key=?', [libraryID, keys[index]])) === 0,
      'Failed transaction left a persisted note');
      t.check(!await Zotero.Items.getByLibraryAndKeyAsync(libraryID, keys[index]), 'Failed transaction left a cached note');
    }
    await expectState(job, api, before);
  } finally { Services.io.offline = offline; }
  return { attemptedKeys: keys, firstWritten, denied, rolledBack: true, publishedNewHead: false };
}

/**
 * Execute one explicit native publication assertion; each invocation is restart-safe.
 * Requires autosync disabled. The parent invokes separate nativeJob processes for
 * repeated pending reads and stages both offline forks before either publish job.
 * @param {object} job {action,groups,marker,fixtures?,branch?}; only synthetic keys.
 * @param {object} api Real Zotero, Services, codecs and scoped synchronize.
 * @returns {Promise<object>} Accumulated fixture keys and actual assertion evidence.
 */
export async function runPublication(job: ControllerJob, api: NativeAPI) {
  const { Zotero, Services } = api, t: ReturnType<typeof noteTools> = noteTools(api);
  t.check(typeof job.marker === 'string' && job.marker.length > 0, 'Synthetic marker required');
  t.check(Zotero.Prefs.get('sync.autoSync') === false, 'Disable autosync before controlled publication jobs');
  t.check(!Zotero.Sync.Runner.syncInProgress, 'A native sync is already running');
  const actions = ['seed', 'partial', 'pending', 'complete', 'ready', 'fork', 'fork-verify', 'publish', 'conflict',
    'resolve', 'resolved', 'failed-local-transaction'];
  const action = job.action.slice('publication:'.length);
  t.check(job.action.startsWith('publication:') && actions.includes(action), `Unknown publication action: ${job.action}`);
  job = { ...job, fixtures: { ...job.fixtures } };
  if (!['fork', 'fork-verify'].includes(action)) await api.synchronize();
  const writable = Zotero.Groups.get(job.groups.writable);
  t.check(!!writable && writable.editable, 'Publication writes require the explicit writable group');
  const keys = present(job.fixtures);
  let state, transaction;
  if (action === 'seed') {
    t.check(Object.keys(present(keys)).length === 0, 'Seed requires a fresh fixture map');
    await saveGeneration(job, api, 'commit0', 'payload0', []);
    await api.synchronize();
    state = await expectReady(job, api, 'commit0', 'payload0');
  } else if (action === 'partial') {
    await expectReady(job, api, 'commit0', 'payload0');
    t.check(!present(keys).head1 && !present(keys).payload1, 'Partial generation already exists');
    // Native source: data/dataObjectUtilities.js generateKey() -> Utilities.generateObjectKey().
    present(keys).payload1 = Zotero.DataObjectUtilities.generateKey();
    t.check(Zotero.Utilities.isValidObjectKey(present(keys).payload1), 'Native future key is invalid');
    t.check(!await Zotero.Items.getByLibraryAndKeyAsync(found(writable).libraryID, present(keys).payload1), 'Future key already exists');
    const expected = await expectedNotes(job, t);
    const body = await t.makeCommit({ parents: [present(keys).commit0],
      records: [{ key: present(keys).payload1, hash: expected.records.payload1.hash }] });
    present(keys).head1 = (await t.writeNote(found(writable).libraryID, body)).key;
    await api.synchronize();
  } else if (action === 'complete') {
    await expectState(job, api, { state: 'pending', missing: [present(keys).payload1], previousHeads: [present(keys).commit0] });
    const expected = await expectedNotes(job, t);
    const saved = await t.writeNote(found(writable).libraryID, expected.records.payload1, present(keys).payload1);
    t.check(saved.key === present(keys).payload1, 'Future payload was saved under a different key');
    await api.synchronize();
    state = await expectReady(job, api, 'head1', 'payload1');
  } else if (action === 'fork' || action === 'fork-verify') {
    t.check(['delete', 'edit'].includes(present(job.branch)), 'Explicit delete/edit fork required');
    const offline = Services.io.offline;
    try {
      Services.io.offline = true;
      t.check(Services.io.offline, 'Failed to enter offline mode for the local fork');
      if (action === 'fork') {
        await expectReady(job, api, 'head1', 'payload1');
        await saveGeneration(job, api, `${job.branch}Head`, `${job.branch}Payload`, ['head1']);
      } else {
        t.check(!!present(keys)[`${job.branch}Head`] && !!present(keys)[`${job.branch}Payload`], 'Saved fork keys required');
      }
      for (const suffix of ['Payload', 'Head']) {
        const note = await Zotero.Items.getByLibraryAndKeyAsync(found(writable).libraryID, present(keys)[`${job.branch}${suffix}`]);
        t.check(!found(note).synced, 'Offline fork was unexpectedly published');
      }
      state = await expectReady(job, api, `${job.branch}Head`, `${job.branch}Payload`);
    } finally { Services.io.offline = offline; }
  } else if (action === 'resolve') {
    await expectState(job, api, { state: 'conflict', heads: [present(keys).deleteHead, present(keys).editHead].sort() });
    await saveGeneration(job, api, 'resolutionHead', 'resolutionPayload', ['deleteHead', 'editHead']);
    await api.synchronize();
    state = await expectReady(job, api, 'resolutionHead', 'resolutionPayload');
  } else if (action === 'failed-local-transaction') {
    transaction = await failedTransaction(job, api);
    state = await observe(job, api);
  }
  if (action === 'pending' || action === 'partial') {
    state = await expectState(job, api, { state: 'pending', missing: [present(keys).payload1], previousHeads: [present(keys).commit0] });
  } else if (action === 'ready') state = await expectReady(job, api, 'head1', 'payload1');
  else if (action === 'conflict') {
    state = await expectState(job, api, { state: 'conflict', heads: [present(keys).deleteHead, present(keys).editHead].sort() });
  } else if (action === 'resolved') state = await expectReady(job, api, 'resolutionHead', 'resolutionPayload');
  else if (action === 'publish') {
    t.check(['delete', 'edit'].includes(present(job.branch)), 'Explicit branch required for publish evidence');
    state = present(keys).deleteHead && present(keys).editHead
      ? await expectState(job, api, { state: 'conflict', heads: [present(keys).deleteHead, present(keys).editHead].sort() })
      : await expectReady(job, api, `${job.branch}Head`, `${job.branch}Payload`);
    for (const suffix of ['Payload', 'Head']) {
      const note = await Zotero.Items.getByLibraryAndKeyAsync(found(writable).libraryID, present(keys)[`${job.branch}${suffix}`]);
      t.check(!!note && note.synced, 'Explicit native sync did not publish the local branch');
    }
  }
  return { fixtures: keys, state, ...(transaction ? { transaction } : {}) };
}
