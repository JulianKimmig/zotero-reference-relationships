/** A selected genuine HTTP download response is held across real native cancellation; plugin storage and payloads are never substituted. */
import type { NativeAPI } from './native-api.mts';
import type { TestPlatform } from './platform-contracts.mts';
import type { transferSyncContext } from './transfer-sync-context.sys.mts';
import type { GenerationFixture } from './transfer-sync-contracts.mts';
import type { NativeModuleLoader } from './module-contracts.mts';
import { check } from './ui-helpers.sys.mts';
import { present } from './evidence.sys.mts';

/** Parsed external responses remain untrusted until their selected note metadata/envelope is checked. */
type DownloadBatch = { keys: string[]; json: unknown[]; error?: never } | { keys: string[]; error: Error; json?: never };
/** The only external API-client surface touched by the controlled response gate. */
interface DownloadClient {
  downloadObjects(libraryType: 'user' | 'group', libraryID: number, objectType: 'item' | 'collection' | 'search', keys: string[]): Promise<DownloadBatch>[];
}
/** Native sync cancellation and external-client construction, without credentials, request options or headers. */
type DownloadPlatform = TestPlatform & { Sync: TestPlatform['Sync'] & {
  APIClient: { prototype: DownloadClient }; Runner: TestPlatform['Sync']['Runner'] & { stop(): void };
} };
/** Actual production envelope verification is used for the server's selected note. */
type EnvelopeLoader = NativeModuleLoader & {
  importESModule(uri: `resource://${string}/src/storage/envelopes.mjs`): typeof import('../../src/storage/envelopes.mts');
};
type SyncContext = Awaited<ReturnType<typeof transferSyncContext>>;

/** Require the exact incomplete generation with its old complete ancestor and no exposed partial snapshot. @param {object} context Real repository/native resources. @param {object} fixture Complete source generation. @returns {Promise<object>} Actual pending read state. */
export async function pendingDownload(context: SyncContext, fixture: GenerationFixture) {
  context.app.invalidate(context.scope); context.repository.invalidate();
  const state = await context.repository.read();
  check(state.state === 'pending' && JSON.stringify(state.missing) === JSON.stringify([fixture.withheld])
    && JSON.stringify(state.previousHeads) === JSON.stringify([fixture.before.head]) && !('snapshot' in state),
  `Interrupted download did not retain an exact pending generation; observed state ${state.state}`);
  return state;
}

/** Check one genuine parsed server note without serializing its client or other response metadata. @param {unknown} input External JSON item. @param {string} key Selected immutable record key. @returns {string} Actual server note HTML. */
function selectedHTML(input: unknown, key: string): string {
  check(input !== null && typeof input === 'object' && 'key' in input && input.key === key && 'version' in input
    && typeof input.version === 'number' && input.version > 0 && 'data' in input && input.data !== null && typeof input.data === 'object',
  'Selected native response lacks real server identity/version');
  const data = input.data;
  check('key' in data && data.key === key && 'version' in data && typeof data.version === 'number' && data.version > 0
    && 'itemType' in data && data.itemType === 'note' && 'note' in data && typeof data.note === 'string', 'Selected response is not the expected server note');
  return data.note;
}

/** Interrupt only delivery of one real selected response after all other native batches are persisted. @param {object} api Actual signed native platform. @param {object} context Group-only service/storage resources. @param {object} fixture Complete server-published generation absent from this receiver. @returns {Promise<object>} Actual persisted pending-state and cancellation evidence. */
export async function interruptDownload(api: NativeAPI, context: SyncContext, fixture: GenerationFixture) {
  const Zotero = api.Zotero as DownloadPlatform, prototype = Zotero.Sync.APIClient.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'downloadObjects');
  check(!!descriptor && typeof descriptor.value === 'function' && typeof Zotero.Sync.Runner.stop === 'function', 'Native download/cancellation boundary unavailable');
  const original = prototype.downloadObjects, held = Zotero.Promise.defer<DownloadBatch>();
  const tailObserved = held.promise.then(value => ({ value }), (error: unknown) => ({ error }));
  const observedRequests: Promise<PromiseSettledResult<DownloadBatch>[]>[] = [];
  let receiver: DownloadClient | null = null, released = false, requested = false, nativeStopped = false;
  let syncObserved: Promise<{ value: Awaited<ReturnType<SyncContext['synchronizeGroup']>> } | { error: unknown }> | null = null;

  /** Delegate all unrelated requests unchanged and put the selected response after genuine remaining batches. @param {string} libraryType Actual native owner kind. @param {number} libraryID Public server group ID. @param {string} objectType Native resource kind. @param {string[]} keys Actual requested keys. @returns {Promise<object>[]} Actual batches followed by the one controlled response. */
  function downloadObjects(this: DownloadClient, libraryType: 'user' | 'group', libraryID: number, objectType: 'item' | 'collection' | 'search', keys: string[]): Promise<DownloadBatch>[] {
    if (libraryType !== 'group' || libraryID !== 6749379 || objectType !== 'item' || !keys.includes(fixture.withheld)) {
      return original.call(this, libraryType, libraryID, objectType, keys);
    }
    check(receiver === null, 'Selected native response was requested twice'); receiver = this;
    const others = keys.filter(key => key !== fixture.withheld);
    const batches = others.length ? original.call(this, libraryType, libraryID, objectType, others) : [];
    observedRequests.push(Promise.allSettled(batches)); return [...batches, held.promise];
  }

  Object.defineProperty(prototype, 'downloadObjects', { ...descriptor, value: downloadObjects });
  try {
    check(!await Zotero.Items.getByLibraryAndKeyAsync(context.group.libraryID, fixture.withheld), 'Receiver already has the selected record');
    syncObserved = context.synchronizeGroup().then(value => ({ value }), (error: unknown) => ({ error }));
    const deadline = Date.now() + 90000; let completeOthers = false;
    while (Date.now() < deadline) {
      if (receiver !== null) {
        const keys = [fixture.after.head, ...fixture.records.filter(key => key !== fixture.withheld)];
        const items = await Promise.all(keys.map(key => Zotero.Items.getByLibraryAndKeyAsync(context.group.libraryID, key)));
        if (items.every(item => item && item.synced && item.version > 0)) { completeOthers = true; break; }
      }
      await Zotero.Promise.delay(100);
    }
    check(completeOthers && receiver !== null, 'Native receiver did not persist the manifest and every other record');
    await Zotero.DB.waitForTransaction(); await pendingDownload(context, fixture);
    check(!requested, 'Selected response request already consumed'); requested = true;
    const selected = original.call(receiver, 'group', 6749379, 'item', [fixture.withheld]);
    check(selected.length === 1, 'A single selected key unexpectedly required multiple HTTP batches');
    observedRequests.push(Promise.allSettled(selected));
    const batch = await selected[0];
    check('json' in batch && Array.isArray(batch.json) && batch.keys.includes(fixture.withheld), 'Selected real HTTP download failed');
    const value = batch.json.find(value => value !== null && typeof value === 'object' && 'key' in value && value.key === fixture.withheld);
    const html = selectedHTML(value, fixture.withheld), document = new api.DOMParser().parseFromString(html, 'text/html');
    const body: unknown = JSON.parse(present(document.querySelector('pre')).textContent!);
    const { verifyEnvelope } = (api.ChromeUtils as EnvelopeLoader).importESModule('resource://rr-reconciliation-production/src/storage/envelopes.mjs');
    const envelope = await verifyEnvelope(body, context.factory.digest);
    check(envelope.format === 'reference-relationships/record', 'Selected server note is not an immutable production record');
    const observation = await context.repository.observation(), manifest = present(observation.commits.find(note => note.key === fixture.after.head));
    const commit = await verifyEnvelope(manifest.body, context.factory.digest);
    check(commit.format === 'reference-relationships/commit' && commit.records.some(record => record.key === fixture.withheld
      && record.hash === envelope.hash && record.index === envelope.index), 'Real selected record does not match the published manifest');
    check(!await Zotero.Items.getByLibraryAndKeyAsync(context.group.libraryID, fixture.withheld), 'Held HTTP response was prematurely saved');
    Zotero.Sync.Runner.stop(); nativeStopped = true; held.resolve(batch); released = true;
    const result = await syncObserved; if ('error' in result) throw result.error;
    check(!Zotero.Sync.Runner.syncInProgress, 'Native canceled sync has not drained');
    check(!await Zotero.Items.getByLibraryAndKeyAsync(context.group.libraryID, fixture.withheld), 'Canceled selected response was consumed');
    const state = await pendingDownload(context, fixture);
    return { state, actualServerRecordVerified: true, genuineHTTPResponsesOnly: true, nativeCancellation: true,
      manifestAndOtherRecordsPersisted: true, selectedRecordNotConsumed: true, noPartialSnapshot: true };
  } finally {
    try {
      if (!nativeStopped && Zotero.Sync.Runner.syncInProgress) Zotero.Sync.Runner.stop();
      if (!released) { held.reject(new Error('Controlled native download fixture ended before response release')); released = true; }
      if (syncObserved) await syncObserved;
      await tailObserved; await Promise.all(observedRequests);
    } finally { Object.defineProperty(prototype, 'downloadObjects', descriptor); }
  }
}
