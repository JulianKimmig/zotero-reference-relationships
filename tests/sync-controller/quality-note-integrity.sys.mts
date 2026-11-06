/** Native note-discovery integrity regression on a previously checkpointed anonymous personal/group fixture. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { RepositoryState } from '../../src/storage/contracts.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { groupIDs } from './library-fixtures.sys.mts';
import { present, found, readyState, contractFailure } from './evidence.sys.mts';
import { check } from './ui-helpers.sys.mts';

/** Require the actual public failure category and, when specified, the affected native note key. @param action Real native-backed operation. @param code Required error code. @param key Optional corrupt authority key. @returns Recorded failure diagnostics. */
async function rejected(action: () => Promise<unknown>, code: string, key?: string) {
  try { await action(); }
  catch (error) {
    const failure = contractFailure(error);
    check(failure.code === code && (!key || failure.details.key === key), 'Native integrity failure lost its category or authority key');
    return { code: failure.code, key: failure.details.key, reason: failure.details.reason };
  }
  throw new Error(`Expected native ${code} failure`);
}

/** Verify marker/JSON/schema/reparenting failures, actual transaction rollback and readonly denial without changing checkpointed authority. @param job Exact installed XPI and existing successful note-query fixture. @param api Real unsigned-in native host. @returns Explicit integrity and transaction receipts; no server membership or synchronization claim. */
export async function qualityNoteIntegrity(job: ControllerJob, api: NativeAPI) {
  const { Zotero, ChromeUtils, DOMParser, crypto, TextEncoder } = api;
  check(!Zotero.Users.getCurrentUserID(), 'Native integrity regression requires an unsigned-in fixture');
  const io = present(api.IOUtils), production = await resources(job, api);
  const checkpoint: { states: { scope: string; value: RepositoryState }[] } = JSON.parse(
    await io.readUTF8(`${present(job.data)}/quality-note-discovery-fixture.json`));
  const { createRepositoryFactory } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/repositories.mjs');
  const { createNativeTransport, createEventTransport } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/storage/native-notes.mjs');
  const { GraphRepository } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/storage/repository.mjs');
  const factory = createRepositoryFactory({ Zotero, DOMParser, crypto, TextEncoder, gateway: production.gateway });
  const app = present(Zotero.ReferenceRelationships).application;
  check(checkpoint.states.length === 3, 'Expected exact personal/writable/readonly fixture checkpoint');
  app.invalidateAll();
  for (const state of checkpoint.states) check(JSON.stringify(await app.read(state.scope)) === JSON.stringify(state.value), 'Checkpointed authority changed before native integrity test');
  const before = readyState(present(checkpoint.states.find(state => state.scope === 'self')).value);
  const transport = createNativeTransport({ Zotero, DOMParser, libraryID: Zotero.Libraries.userLibraryID });
  const original = await transport.scan(), record = found(original.find(note => note.body.format === 'reference-relationships/record'));
  const item = found(await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, record.key));
  const parent = found(await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, before.snapshot.assertions[0].source.key));
  check(item.parentID === false, 'Integrity authority note is not initially standalone');
  await io.writeUTF8(`${job.data}/quality-note-integrity-checkpoint.json`, JSON.stringify({ checkpoint, original, noteKey: item.key,
    originalHTML: item.getNote(), originalParent: item.parentID }), { mode: 'create', flush: true });
  const failures = [];
  try {
    for (const [kind, html, parentID] of [
      ['malformed-json', '<h1>Reference Relationships data</h1><pre>not json</pre>', false],
      ['marker-evasion', record.html.replace('Reference Relationships data', 'Changed authority heading'), false],
      ['reparented-known-note', record.html, parent.id],
      ['wrong-namespace', '<h1>Reference Relationships data</h1><pre>{"format":"unrelated/data"}</pre>', false],
    ] as const) {
      item.setNote(html); item.parentID = parentID; await item.saveTx();
      try { failures.push({ kind, ...await rejected(() => transport.scan(), 'storage', item.key) }); }
      finally { item.parentID = false; item.setNote(record.html); await item.saveTx(); }
      check(JSON.stringify(await transport.scan()) === JSON.stringify(original), 'Native integrity case did not restore exact observations');
    }
    const unknown = JSON.stringify({ ...record.body, schema: 999 }).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    item.setNote(`<h1>Reference Relationships data</h1><pre>${unknown}</pre>`); await item.saveTx();
    try { failures.push({ kind: 'unknown-schema', ...await rejected(() => factory.repositoryFor('self', null).read(), 'unsupported-schema', item.key) }); }
    finally { item.setNote(record.html); await item.saveTx(); }
    const writerTransport = createEventTransport({ Zotero, DOMParser, libraryID: Zotero.Libraries.userLibraryID });
    const existing = new Set(original.map(note => note.key)); let staged: string[] = [];
    /** Force a real external-clock failure after actual note writes inside the native transaction. @returns Invalid timestamp whose validation must roll back every staged item. */
    async function invalidClock(): Promise<string> {
      staged = (await writerTransport.scan()).map(note => note.key).filter(key => !existing.has(key));
      check(staged.length > 0, 'Rollback probe did not observe actual staged native notes'); return 'invalid-clock';
    }
    const writer = new GraphRepository({ transport: writerTransport, digest: factory.digest, now: invalidClock });
    const proposed = structuredClone(before.snapshot); proposed.assertions[0].metadata.note = 'Must roll back native query transaction';
    await rejected(() => writer.compareAndCommit(proposed, before.head), 'validation');
    for (const key of staged) {
      check(!await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, key), 'Failed native transaction retained staged authority in the item cache');
      check(await Zotero.DB.valueQueryAsync('SELECT COUNT(*) FROM items WHERE libraryID=? AND key=?',
        [Zotero.Libraries.userLibraryID, key]) === 0, 'Failed native transaction retained staged SQL authority');
    }
    const strict = new GraphRepository({ transport, digest: factory.digest, now: () => new Date().toISOString() });
    await Zotero.DB.executeTransaction(async function enclosingTransaction() {
      await rejected(() => strict.compareAndCommit(before.snapshot, before.head), 'storage');
    });
    const readonlyScope = `group:${groupIDs.copy}`, restricted = readyState(present(checkpoint.states.find(state => state.scope === readonlyScope)).value);
    check(!production.gateway.library(readonlyScope).editable, 'Expected actual local readonly native library');
    const denied = factory.repositoryForEvent(readonlyScope, async () => { await production.gateway.assertWritable(readonlyScope, []); });
    await rejected(() => denied.compareAndCommit(restricted.snapshot, restricted.head), 'permission');
    app.invalidateAll();
    for (const state of checkpoint.states) check(JSON.stringify(await app.read(state.scope)) === JSON.stringify(state.value), 'Native integrity/rollback/permission test changed complete authority');
    check(JSON.stringify(await transport.scan()) === JSON.stringify(original), 'Native integrity tests changed the authority note set');
    return { failures, stagedRollbackKeys: staged, nativeCacheAndSQLRolledBack: true, nestedPublicationRejected: true,
      readonlyWriteDenied: true, checkpointedAuthorityUnchanged: true, personalAndLocalGroups: true, serverMembershipTest: false };
  } finally { factory.clear(); }
}

/** Independently inspect a successful rollback in a new native process without replaying setup or writes. @param job Exact artifact, checkpointed existing profile and explicit staged key from the prior report. @param api Actual native host. @returns SQL/cache absence and complete checkpoint equality across all fixture libraries. */
export async function qualityNoteIntegrityReadback(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api, key = job.fixtures?.stagedKey;
  check(!Zotero.Users.getCurrentUserID() && !!key && /^[A-Z0-9]{8}$/.test(key), 'Independent integrity readback requires an anonymous fixture and explicit staged key');
  await resources(job, api);
  const saved: { checkpoint: { states: { scope: string; value: RepositoryState }[] } } = JSON.parse(
    await present(api.IOUtils).readUTF8(`${present(job.data)}/quality-note-integrity-checkpoint.json`));
  const rows = await Zotero.DB.valueQueryAsync('SELECT COUNT(*) FROM items WHERE libraryID=? AND key=?', [Zotero.Libraries.userLibraryID, key]);
  const cached = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, key);
  check(rows === 0 && !cached, 'Prior rolled-back native note remains in SQL or the item cache');
  const app = present(Zotero.ReferenceRelationships).application; app.invalidateAll();
  for (const state of saved.checkpoint.states) check(JSON.stringify(await app.read(state.scope)) === JSON.stringify(state.value), 'Independent readback differs from original complete authority');
  return { key, sqlRows: rows, cacheAbsent: !cached, checkpointedAuthorityUnchanged: true, noAuthorityWrites: true };
}
