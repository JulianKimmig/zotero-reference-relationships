/** Inspect actual dedicated signed development libraries before any new transfer publication or interruption fixture. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { transferSyncContext } from './transfer-sync-context.sys.mts';
import { transferSyncUpload } from './transfer-sync-upload.sys.mts';
import { transferSyncDownload } from './transfer-sync-download.sys.mts';
import { transferSyncForks } from './transfer-sync-forks.sys.mts';
import { captureUnrelated, requireUnrelated } from './transfer-sync-fixtures.sys.mts';
import { check } from './ui-helpers.sys.mts';

/** Reobserve current server-backed authority without inventing an empty baseline or copying credentials. @param {object} job Explicit signed profile action. @param {object} api Actual native platform. @returns {Promise<object>} Public ownership/readiness evidence for the next controlled fixture. */
export async function transferSync(job: ControllerJob, api: NativeAPI) {
  const context = await transferSyncContext(job, api);
  try {
    const unrelated = await captureUnrelated(context);
    if (job.action.startsWith('transfer:sync-fork-')) {
      const result = await transferSyncForks(job, api, context); await requireUnrelated(api, context, unrelated); return result;
    }
    if (['transfer:sync-baseline', 'transfer:sync-upload-partial', 'transfer:sync-pending',
      'transfer:sync-pending-restart', 'transfer:sync-upload-complete', 'transfer:sync-ready'].includes(job.action)) {
      const result = await transferSyncUpload(job, api, context); await requireUnrelated(api, context, unrelated); return result;
    }
    if (['transfer:sync-download-publish', 'transfer:sync-download-interrupt', 'transfer:sync-download-restart'].includes(job.action)) {
      const result = await transferSyncDownload(job, api, context); await requireUnrelated(api, context, unrelated); return result;
    }
    check(job.action === 'transfer:sync-inspect', 'Unknown signed transfer phase');
    const personal = await context.app.read('self'); await context.requireSync();
    const state = await context.repository.read();
    check(JSON.stringify(await context.app.read('self')) === JSON.stringify(personal), 'Group-only preflight changed personal authority');
    await requireUnrelated(api, context, unrelated);
    return { userID: context.userID, scope: context.scope, owner: context.identity.read(context.scope), state,
      nativeGroupOnlySync: true, personalAuthorityUnchanged: true, noPluginAuthorityWrites: true };
  } finally { context.close(); }
}
