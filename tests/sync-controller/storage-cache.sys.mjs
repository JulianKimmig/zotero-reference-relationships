/** Native adjacency publication, shared revision cache and isolation from in-flight writes. */

/** Assert behavior. @param {boolean} value Condition. @param {string} message Failure. @returns {void} */
function check(value, message) { if (!value) throw new Error(message); }

/** Require typed failure. @param {Function} action Operation. @param {string} code Expected code. @returns {Promise<void>} */
async function fails(action, code) {
  let failed = false;
  try { await action(); }
  catch (error) { check(error.code === code, `Expected ${code}: ${error.message}`); failed = true; }
  check(failed, `Expected ${code} failure`);
}

/**
 * Verify actual repository cache publication and native transaction read isolation.
 * @param {object} context Real repository/platform resources bound by the controller.
 * @returns {Promise<object>} Native cache/revision and current snapshot evidence.
 */
export async function storageCache(context) {
  const { repo, repository, transport, Zotero, ChromeUtils, digest, libraryID, synchronize } = context;
  check(Zotero.Prefs.get('sync.autoSync') === false, 'Controlled cache fixture requires autosync disabled');
  const before = await repo.read(), root = before.snapshot.assertions[0], page = { offset: 0, limit: 100 };
  const first = repo.adjacent(root.source, before.head, 'outgoing', null, page);
  check(first.total >= 1 && first.revision === before.head, 'Current adjacency index was not published');
  first.assertions[0].metadata.number = 999;
  check(repository().adjacent(root.source, before.head, 'outgoing', null, page).assertions[0].metadata.number !== 999,
    'Shared adjacency results exposed mutable cache data');
  await fails(() => repo.adjacent(root.source, 'ZZZZZZZZ', 'both', null, page), 'conflict');
  repo.invalidate();
  await fails(() => repository().adjacent(root.source, before.head, 'both', null, page), 'conflict');
  await repo.read();
  let entered, release;
  const clockEntered = new Promise(resolve => { entered = resolve; });
  const clockGate = new Promise(resolve => { release = resolve; });
  /** Delay only the explicit external clock while actual notes are in the transaction. @returns {Promise<string>} Real timestamp. */
  async function pausedClock() { entered(); await clockGate; return new Date().toISOString(); }
  const writing = repository(pausedClock).compareAndCommit(before.snapshot, before.head);
  await clockEntered;
  let readSettledEarly = false;
  const reading = repository().read();
  reading.then(() => { readSettledEarly = true; }, () => { readSettledEarly = true; });
  let early;
  try { await Zotero.Promise.delay(10); early = readSettledEarly; }
  finally { release(); }
  const head = await writing, state = await reading;
  check(!early && state.state === 'ready' && state.head === head, 'Reader escaped an unfinished writer transaction');
  check(repo.adjacent(root.source, head, 'incoming', null, page).revision === head, 'Committed index was not shared');
  await fails(() => repo.adjacent(root.source, before.head, 'both', null, page), 'conflict');
  const { makeCommit } = ChromeUtils.importESModule('resource://rr-production/storage/envelopes.mjs');
  const current = await transport.get(head), missingKey = Zotero.DataObjectUtilities.generateKey();
  const incomplete = await makeCommit({ parents: [head], records: [{ key: missingKey, hash: '0'.repeat(64), index: 0 }],
    snapshotHash: current.body.snapshotHash, bytes: current.body.bytes, createdAt: new Date().toISOString() }, digest);
  let fixtureKey;
  await transport.transaction(async function publishIncompleteFixture() { fixtureKey = await transport.create(incomplete); });
  try {
    check((await repo.read()).state === 'pending', 'Incomplete generation did not block cached reads');
    await fails(() => repo.adjacent(root.source, head, 'both', null, page), 'conflict');
  } finally {
    // Remove only this deliberately incomplete, unsynced fixture manifest.
    const fixture = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, fixtureKey);
    check(fixture && !fixture.synced, 'Incomplete fixture changed externally'); await fixture.eraseTx();
  }
  const restored = await repo.read(); check(restored.head === head, 'Fixture cleanup changed complete authority');
  await synchronize();
  return { currentHead: head, current: restored.snapshot, sharedIndex: true, detachedResults: true,
    staleQueryRejected: true, readWaitedForCommit: true, pendingClearedCache: true };
}
