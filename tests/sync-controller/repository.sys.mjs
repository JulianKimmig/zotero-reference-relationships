/** Real production-repository conformance; only dedicated test libraries and synthetic references. */
import { storageBranches } from './storage-branches.sys.mjs';
import { storageCache } from './storage-cache.sys.mjs';

/** Native assertion. @param {boolean} value Condition. @param {string} message Failure. @returns {void} */
function check(value, message) { if (!value) throw new Error(message); }

/** Assert a typed operation failure. @param {Function} action Operation. @param {string} code Expected public code. @returns {Promise<void>} */
async function fails(action, code) {
  let failed = false;
  try { await action(); }
  catch (error) { check(error.code === code, `Expected ${code}, received ${error.code}: ${error.message}`); failed = true; }
  check(failed, `Expected ${code} failure`);
}

/** Create explicit real item endpoints in a native transaction. @param {object} api Native resources. @param {number} libraryID Library. @param {string} marker Test label. @returns {Promise<object[]>} Saved native items. */
async function endpoints(api, libraryID, marker) {
  const result = [];
  await api.Zotero.DB.executeTransaction(async function saveFixtures() {
    for (let index = 0; index < 101; index++) {
      const item = new api.Zotero.Item('book'); item.libraryID = libraryID;
      item.setField('title', `${marker} endpoint ${index}`); await item.save(); result.push(item);
    }
  });
  return result;
}

/** Build a substantial Unicode snapshot using actual native reference keys. @param {object} job Fixture labels. @param {object[]} items Native endpoints. @returns {object} Graph. */
function snapshot(job, items) {
  const library = `group:${job.groups.writable}`, stamp = '2026-11-05T12:00:00.000Z';
  const kinds = ['string', 'number', 'boolean', 'date', 'enum'];
  const fields = kinds.map(kind => ({ id: kind, label: kind, kind, required: true,
    options: kind === 'enum' ? ['similar', 'referencing'] : [] }));
  return { schema: 1, library,
    types: ['referencing', 'referenced-by', 'similar'].map(id => ({ id, label: id, description: '',
      version: 1, retired: false, fields: id === 'referencing' ? fields : [] })), rules: [],
    assertions: items.slice(1).map((item, index) => ({ id: `root-${index}`,
      source: { library, key: item.key }, target: { library, key: items[0].key }, type: 'referencing',
      metadata: { string: 'Café 你好 😀 <>& " \\ \n'.repeat(30), number: 3.25, boolean: false,
        date: '2000-02-29', enum: 'similar' }, createdAt: stamp, updatedAt: stamp })) };
}

/**
 * Run one independent native process against actual production modules.
 * The failed-clock case supplies an external clock returning an invalid time
 * after actual note creation; no plugin module or native persistence API is mocked.
 * @param {object} job Source URI, groups and prior fixture results.
 * @param {object} api Native resources and scoped synchronize.
 * @returns {Promise<object>} Observable persistence, rollback and restart evidence.
 */
export async function repositoryConformance(job, api) {
  const handler = api.Services.io.getProtocolHandler('resource')
    .QueryInterface(api.Components.interfaces.nsIResProtocolHandler);
  handler.setSubstitution('rr-production', api.Services.io.newURI(job.sourceURI));
  const { GraphRepository } = api.ChromeUtils.importESModule('resource://rr-production/storage/repository.mjs');
  const { createNativeTransport, createEventTransport } = api.ChromeUtils.importESModule('resource://rr-production/storage/native-notes.mjs');
  const { canonicalJSON } = api.ChromeUtils.importESModule('resource://rr-production/storage/canonical.mjs');
  const { renderNote } = api.ChromeUtils.importESModule('resource://rr-production/storage/chunks.mjs');
  /** Real UTF-8 SHA-256. @param {string} text Canonical text. @returns {Promise<string>} Hex digest. */
  async function digest(text) {
    const bytes = await api.crypto.subtle.digest('SHA-256', new api.TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
  }
  const libraryID = api.Zotero.Groups.get(job.groups.writable).libraryID;
  const constructTransport = job.action === 'storage:transaction-guard' ? createNativeTransport : createEventTransport;
  const transport = constructTransport({ Zotero: api.Zotero, DOMParser: api.DOMParser, libraryID });
  /** Construct an independent repository sharing native writer ownership. @param {Function} now External clock. @returns {object} Repository. */
  function repository(now = () => new Date().toISOString()) { return new GraphRepository({ transport, digest, now }); }
  if (job.action !== 'storage:fork') await api.synchronize();
  const repo = repository();
  if (job.action === 'storage:index') {
    return storageCache({ ...api, repo, repository, transport, digest, libraryID });
  }
  if (['storage:fork', 'storage:publish', 'storage:conflict', 'storage:resolve', 'storage:editor',
    'storage:tamper', 'storage:transaction-guard', 'storage:rollback-cache'].includes(job.action)) {
    return storageBranches(job, { ...api, repo, repository, transport, canonicalJSON, libraryID });
  }
  if (job.action === 'storage:exercise') {
    check((await repo.read()).state === 'uninitialized', 'Exercise requires no prior production authority');
    const items = await endpoints(api, libraryID, job.marker), original = snapshot(job, items);
    const submitted = JSON.parse(canonicalJSON(original));
    const pendingFirst = repo.compareAndCommit(submitted, null);
    // Input must be detached before any asynchronous hashing/platform work.
    submitted.library = 'self'; submitted.assertions[0].metadata.number = 999;
    const firstHead = await pendingFirst;
    const first = await repo.read();
    check(first.state === 'ready' && first.head === firstHead && canonicalJSON(first.snapshot) === canonicalJSON(original), 'Initial roundtrip differs');
    const authority = await transport.scan();
    check(authority.length > 2, 'Large Unicode snapshot did not exercise chunked storage');
    const changed = JSON.parse(canonicalJSON(original)); changed.assertions[0].metadata.number = 5;
    await fails(() => repo.compareAndCommit(changed, 'ZZZZZZZZ'), 'conflict');
    check((await transport.scan()).length === authority.length, 'Stale revision wrote notes');
    const other = JSON.parse(canonicalJSON(changed)); other.assertions[0].metadata.number = 7;
    const attempts = await Promise.allSettled([repo.compareAndCommit(changed, firstHead), repository().compareAndCommit(other, firstHead)]);
    check(attempts.filter(result => result.status === 'fulfilled').length === 1, 'Concurrent writers did not serialize');
    check(attempts.filter(result => result.status === 'rejected' && result.reason.code === 'conflict').length === 1, 'Losing writer did not report stale revision');
    const current = await repo.read(), beforeCount = (await transport.scan()).length;
    let actualPartialWrites = false;
    /** A failed external clock verifies real partial writes before invalid time. @returns {Promise<string>} Invalid time fixture. */
    async function invalidClock() {
      actualPartialWrites = (await transport.scan()).length > beforeCount;
      check(actualPartialWrites, 'Clock failure occurred before actual payload saves');
      return 'invalid-time';
    }
    await fails(() => repository(invalidClock).compareAndCommit(original, current.head), 'validation');
    check(actualPartialWrites && (await transport.scan()).length === beforeCount, 'Failed write did not roll back authority');
    check(canonicalJSON(await repo.read()) === canonicalJSON(current), 'Failed transaction published a new graph/cache');
    const historical = await repo.readHead(firstHead);
    check(canonicalJSON(historical.snapshot) === canonicalJSON(original), 'Historical backup snapshot was lost');
    await api.synchronize();
    return { firstHead, currentHead: current.head, original, current: current.snapshot,
      chunked: true, staleRejected: true, concurrentWriterRejected: true, actualPartialWrites, rolledBack: true };
  }
  if (job.action === 'storage:receive') {
    const state = await repo.read();
    check(state.state === 'ready' && state.head === job.currentHead && canonicalJSON(state.snapshot) === canonicalJSON(job.current), 'Actual received/restarted snapshot differs');
    return { head: state.head, unicodeAndPrimitivesRetained: true, restarted: true };
  }
  if (job.action === 'storage:restore') {
    const head = await repo.compareAndCommit(job.original, job.currentHead);
    const state = await repository().read();
    check(state.head === head && head !== job.currentHead && canonicalJSON(state.snapshot) === canonicalJSON(job.original), 'Backup restoration did not create a complete new generation');
    await api.synchronize();
    return { currentHead: head, current: state.snapshot, backupRestored: true };
  }
  if (job.action === 'storage:permission') {
    const restrictedID = api.Zotero.Groups.get(job.groups.restricted).libraryID;
    const deniedTransport = createNativeTransport({ Zotero: api.Zotero, DOMParser: api.DOMParser, libraryID: restrictedID });
    const denied = new GraphRepository({ transport: deniedTransport, digest, now: () => new Date().toISOString() });
    const graph = JSON.parse(canonicalJSON(job.original)); graph.library = `group:${job.groups.restricted}`;
    for (const root of graph.assertions) root.source.library = root.target.library = graph.library;
    const before = await denied.read();
    await fails(() => denied.compareAndCommit(graph, null), 'permission');
    check(canonicalJSON(await denied.read()) === canonicalJSON(before), 'Denied write changed restricted authority');
    return { denied: true, unchanged: true };
  }
  if (job.action === 'storage:unknown') {
    const personalID = api.Zotero.Libraries.userLibraryID;
    const personalTransport = createNativeTransport({ Zotero: api.Zotero, DOMParser: api.DOMParser, libraryID: personalID });
    const unknown = new api.Zotero.Item('note'); unknown.libraryID = personalID;
    const body = { format: 'reference-relationships/record', schema: 999, index: 0, data: '', hash: '0'.repeat(64) };
    unknown.setNote(renderNote(body)); await unknown.saveTx();
    const personal = new GraphRepository({ transport: personalTransport, digest, now: () => new Date().toISOString() });
    const proposed = JSON.parse(canonicalJSON(job.original)); proposed.library = 'self';
    for (const root of proposed.assertions) root.source.library = root.target.library = 'self';
    try {
      await fails(() => personal.read(), 'unsupported-schema');
      await fails(() => personal.compareAndCommit(proposed, null), 'unsupported-schema');
      check(!unknown.deleted, 'Unknown authority was removed');
    } finally {
      // Remove only this deliberately invalid synthetic fixture, never user notes.
      check(unknown.getNote() === renderNote(body), 'Unknown fixture changed externally');
      await unknown.eraseTx();
    }
    return { unknownRejected: true, unchanged: true, ownedInvalidFixtureRemoved: true };
  }
  throw new Error(`Unknown production storage test ${job.action}`);
}
