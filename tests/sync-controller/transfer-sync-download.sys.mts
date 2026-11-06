/** Separate complete-server download interruption uses actual imported production generations and native restart recovery. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { transferSyncContext } from './transfer-sync-context.sys.mts';
import type { GenerationFixture } from './transfer-sync-contracts.mts';
import { createGeneration } from './transfer-sync-fixtures.sys.mts';
import { interruptDownload, pendingDownload } from './transfer-sync-network.sys.mts';
import { found, readyState } from './evidence.sys.mts';
import { check } from './ui-helpers.sys.mts';

/** Publish a full second import, or interrupt/restart its actual recipient download without altering payloads. @param {object} job Controlled phase with complete fixture DTO. @param {object} api Actual native platform. @param {object} context Group-only production resources. @returns {Promise<object>} Exact complete/pending evidence. */
export async function transferSyncDownload(job: ControllerJob, api: NativeAPI, context: Awaited<ReturnType<typeof transferSyncContext>>) {
  check(job.transferFixture?.kind === 'generation', 'Download phases require an actual prior generation fixture');
  const previous: GenerationFixture = job.transferFixture;
  if (job.action === 'transfer:sync-download-publish') {
    const current = readyState(await context.repository.read());
    check(current.head === previous.after.head && JSON.stringify(current.snapshot) === JSON.stringify(previous.after.snapshot), 'Source no longer has the prior complete imported generation');
    const fixture = await createGeneration(job, api, context, previous.baseline, 'download');
    await context.requireSync();
    for (const key of [fixture.after.head, ...fixture.records]) {
      const note = found(await api.Zotero.Items.getByLibraryAndKeyAsync(context.group.libraryID, key));
      check(note.synced && note.version > 0, 'Download fixture is not completely present on the actual server');
    }
    return { fixture, completeServerGeneration: true, noUploadSuppression: true };
  }
  if (job.action === 'transfer:sync-download-interrupt') {
    const current = readyState(await context.repository.read());
    check(current.head === previous.before.head && JSON.stringify(current.snapshot) === JSON.stringify(previous.before.snapshot), 'Receiver already changed from the old complete generation');
    const report = await interruptDownload(api, context, previous);
    return { fixture: previous, ...report };
  }
  check(job.action === 'transfer:sync-download-restart', 'Unknown controlled download phase');
  check(!await api.Zotero.Items.getByLibraryAndKeyAsync(context.group.libraryID, previous.withheld), 'Restart unexpectedly completed the interrupted download');
  const state = await pendingDownload(context, previous);
  return { fixture: previous, state, restartedPendingWithoutSync: true };
}
