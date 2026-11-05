/** Native offline forks, all-head resolution, editor preservation and integrity diagnostics. */
import type { StorageContext } from './storage-context.mts';
import { contractFailure, errorMessage, present, readyState, found } from './evidence.sys.mts';
import type { ControllerJob } from './job-contracts.mts';

/** Assert observed native behavior. @param {boolean} condition Fact. @param {string} message Failure. @returns {void} */

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

/** Require typed failure. @param {Function} action Operation. @param {string} code Expected failure. @returns {Promise<object>} Actual failure. */
async function fails(action: () => unknown, code: string) {
  try { await action(); }
  catch (error) { check(contractFailure(error).code === code, `Expected ${code}: ${errorMessage(error)}`); return error; }
  throw new Error(`Expected ${code} failure`);
}

/**
 * Exercise actual production repository/platform behavior using existing synthetic authority.
 * @param {object} job Exact expected heads and explicit branch/resolution snapshots.
 * @param {object} context Bound real APIs, repository, transport and production canonical serializer.
 * @returns {Promise<object>} Verified branch/editor/diagnostic outcomes.
 */
export async function storageBranches(job: ControllerJob, context: StorageContext & Required<Pick<StorageContext, 'canonicalJSON'>>) {
  const { repo, transport, repository, canonicalJSON, Zotero, Services, TextEncoder, libraryID, synchronize } = context;
  if (job.action === 'storage:fork') {
    const offline = Services.io.offline;
    try {
      Services.io.offline = true;
      const before = readyState(await repo.read());
      check(before.state === 'ready' && before.head === job.currentHead, 'Offline branch baseline differs');
      const snapshot = JSON.parse(canonicalJSON(before.snapshot));
      if (job.branch === 'assertion') snapshot.assertions[0].metadata.number = 42;
      else {
        check(job.branch === 'rule', 'Explicit fork kind required');
        snapshot.rules = [{ id: 'native-inverse', version: 1, enabled: true,
          rootType: 'referencing', inputType: 'referencing', outputType: 'referenced-by',
          transform: 'reverse', conditions: [], mapping: {} }];
      }
      const head = await repo.compareAndCommit(snapshot, before.head);
      const state = await repo.read();
      check(state.state === 'ready' && state.head === head, 'Local branch did not publish atomically');
      const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, head);
      check(!found(item).synced, 'Offline branch unexpectedly synchronized');
      return { currentHead: head, current: state.snapshot, offline: true };
    } finally { Services.io.offline = offline; }
  }
  if (['storage:publish', 'storage:conflict'].includes(job.action)) {
    const state = await repo.read();
    if (job.expectedHeads) {
      check(state.state === 'conflict' && JSON.stringify(state.heads) === JSON.stringify([...job.expectedHeads].sort()), 'Native fork conflict was hidden');
    } else check(state.state === 'ready' && state.head === job.currentHead, 'Published branch differs');
    return { state };
  }
  if (job.action === 'storage:resolve') {
    const before = await transport.scan();
    await fails(() => repo.resolve(job.resolvedSnapshot, [present(job.expectedHeads)[0], 'ZZZZZZZZ']), 'conflict');
    check((await transport.scan()).length === before.length, 'Stale resolution wrote authority');
    const head = await repo.resolve(job.resolvedSnapshot, present(job.expectedHeads));
    const state = await repo.read();
    check(state.state === 'ready' && state.head === head && canonicalJSON(state.snapshot) === canonicalJSON(job.resolvedSnapshot), 'All-head resolution differs');
    await synchronize();
    return { currentHead: head, current: state.snapshot, allHeadsResolved: true, staleResolutionRejected: true };
  }
  if (job.action === 'storage:editor') {
    const before = readyState(await repo.read()), notes = (await transport.scan()).filter(note => note.body.format === 'reference-relationships/record');
    notes.sort((a, b) => new TextEncoder().encode(b.html).length - new TextEncoder().encode(a.html).length);
    const selected = notes[0], item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, selected.key);
    const editor = await Zotero.Notes.open(found(item).id); await editor._initPromise;
    const snapshot = JSON.parse(JSON.stringify(editor._iframeWindow.wrappedJSObject.getDataSync(false)));
    await editor._save(snapshot);
    const tab = editor._tabID;
    if (tab) Zotero.getMainWindow().Zotero_Tabs.close(tab);
    const after = await transport.get(selected.key);
    check(present(after).body.hash === selected.body.hash && canonicalJSON(await repo.read()) === canonicalJSON(before), 'Native editor changed chunk semantics');
    await synchronize();
    return { head: before.head, key: selected.key, editorHTMLChanged: selected.html !== present(after).html,
      beforeBytes: new TextEncoder().encode(selected.html).length, afterBytes: new TextEncoder().encode(present(after).html).length,
      fullSnapshotRetained: true };
  }
  if (job.action === 'storage:tamper') {
    const before = readyState(await repo.read()), selected = (await transport.scan()).find(note => note.body.format === 'reference-relationships/record');
    const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, present(selected).key);
    const corruptions = [
      ['<div data-schema-version="9"><h1>Reference Relationships data</h1><pre>not json</pre></div>', 'not json'],
      [present(selected).html.replace('Reference Relationships data', 'Changed authority heading'), 'Changed authority heading'],
    ];
    for (const [html, marker] of corruptions) {
      found(item).setNote(html); await found(item).saveTx();
      try {
        const error = await fails(() => repo.read(), 'storage');
        check(contractFailure(error).details.key === present(selected).key && !!contractFailure(error).details.reason, 'Integrity failure lost authority diagnostics');
      } finally {
        check(found(item).getNote().includes(marker), 'Synthetic tamper fixture changed externally');
        found(item).setNote(present(selected).html); await found(item).saveTx();
      }
    }
    check(canonicalJSON(await repo.read()) === canonicalJSON(before), 'Restored chunk did not recover the graph');
    return { corruptNoteRejected: true, markerEvasionRejected: true, keyDiagnostics: true, originalRestored: true };
  }
  if (job.action === 'storage:rollback-cache') {
    const before = readyState(await repo.read()), original = new Set((await transport.scan()).map(note => note.key));
    let attempted: string[] = [];
    /** Return invalid external clock data only after real payload writes. @returns {Promise<string>} Invalid timestamp. */
    async function invalidClock() {
      attempted = (await transport.scan()).map(note => note.key).filter(key => !original.has(key));
      check(attempted.length > 0, 'Rollback cache test never wrote actual notes');
      return 'invalid-clock';
    }
    const proposed = JSON.parse(canonicalJSON(before.snapshot)); proposed.assertions[0].metadata.number = -123;
    await fails(() => repository(invalidClock).compareAndCommit(proposed, before.head), 'validation');
    for (const key of attempted) {
      check(!await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key), 'Failed transaction retained a native cached item');
    }
    const root = before.snapshot.assertions[0];
    const cached = repo.adjacent(root.source, before.head, 'outgoing', null, { offset: 0, limit: 100 });
    check(present(cached.assertions.find(assertion => assertion.id === root.id)).metadata.number === root.metadata.number,
      'Failed write published its prepared adjacency cache');
    check((await transport.scan()).length === original.size && canonicalJSON(await repo.read()) === canonicalJSON(before),
      'Failed transaction changed persisted authority');
    return { actualPayloadNotes: attempted.length, sqlAndNativeCacheRolledBack: true,
      publishedHeadUnchanged: true, adjacencyUnchanged: true };
  }
  if (job.action === 'storage:transaction-guard') {
    const before = readyState(await repo.read()), count = (await transport.scan()).length;
    await Zotero.DB.executeTransaction(async function outerTransaction() {
      await fails(() => repo.compareAndCommit(before.snapshot, before.head), 'storage');
    });
    check((await transport.scan()).length === count, 'External transaction bypassed repository ownership');
    return { nestedPublicationRejected: true, unchanged: true };
  }
  throw new Error(`Unknown storage branch action ${job.action}`);
}
