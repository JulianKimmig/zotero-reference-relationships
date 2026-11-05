/** Real application projection, complete repair previews and native-state-bound publication. */
import { check, until } from './ui-helpers.sys.mjs';
import { rejects } from './ui-permissions.sys.mjs';
import { ref, commits } from './rules-fixtures.sys.mjs';
import { resources, fixtures, preserved, setEnabled } from './reconciliation-fixtures.sys.mjs';
import { reconciliationStop } from './reconciliation-stop.sys.mjs';

const page = { offset: 0, limit: 25 };

/** Reject a real operation without publishing any graph generation. @param {object} api Native resources. @param {Function} operation Actual public call. @param {string} code Error category. @returns {Promise<void>} */
async function unchanged(api, operation, code) {
  const app = api.Zotero.ReferenceRelationships.application, before = await app.read('self'), count = await commits(api);
  await rejects(operation, code); await preserved(api, before, count);
}

/** Exercise a merge-affecting change after preflight while the writer waits for its own transaction. @param {object} api Actual native resources. @param {object} app Application. @param {object} receipt Actual issued review. @param {object} target Referenced native item. @returns {Promise<void>} */
async function changedUnderLock(api, app, receipt, target) {
  const { Zotero } = api, entered = Zotero.Promise.defer(), change = Zotero.Promise.defer(), changed = Zotero.Promise.defer(), release = Zotero.Promise.defer();
  const before = await app.read('self'), count = await commits(api);
  const outer = Zotero.DB.executeTransaction(async function heldNativeItemChange() {
    entered.resolve(); await change.promise; target.deleted = true; await target.save(); changed.resolve(); await release.promise;
  });
  let settled = false;
  let operation;
  try {
    await entered.promise;
    operation = app.applyReviewed(receipt).then(value => { settled = true; return value; }, error => { settled = true; throw error; });
    operation.catch(error => { check(error.code === 'conflict', `Unexpected queued writer error: ${error.message}`); });
    await Zotero.Promise.delay(100);
    check(!settled, 'Reviewed event publication did not wait for its own native transaction');
    change.resolve(); await changed.promise;
  } finally { change.resolve(); release.resolve(); await outer; }
  await rejects(() => operation, 'conflict');
  await preserved(api, before, count);
  target.deleted = false; await target.saveTx();
}

/** Run native application journeys after the separate resolver foundation. @param {object} job Artifact/phase/expected snapshot. @param {object} api Native API. @returns {Promise<object>} Evidence. */
export async function applicationReconciliation(job, api) {
  const { Zotero } = api, production = await resources(job, api);
  let app = Zotero.ReferenceRelationships.application;
  check(typeof app.applyReviewed === 'function' && typeof app.reconcile === 'function', 'Application reconciliation/review binding is unavailable');
  if (job.action === 'reconcile:application-restart') {
    check(JSON.stringify(await app.read('self')) === JSON.stringify(job.before), 'Restart changed original authority');
    const report = await app.reconcile('self', page);
    check(report.state === 'ready' && report.diagnostics.some(value => value.details.status === 'missing'), 'Restart lost retained orphan diagnostics');
    check((await app.listRelationships({ library: 'self', key: job.a }, 'both', null, page)).total === 0, 'Restart resurrected inactive derived edges');
    await preserved(api, job.before, job.count);
    return { restarted: true, originalAuthorityPreserved: true, idempotentReadRepair: true };
  }
  check(job.action === 'reconcile:application', 'Unknown application reconciliation phase');
  const { a, b, c, d, before, count } = await fixtures(job, api);
  const { mergeItems } = api.ChromeUtils.importESModule('chrome://zotero/content/mergeItems.mjs');
  const pending = await app.draftCreate({ source: ref(a), target: ref(d), type: 'similar', metadata: { note: 'Native stale preview' } });
  const cancellation = await reconciliationStop(api, production.gateway, pending);
  const stale = await app.preview(pending.command, pending.expectedRevision);
  await mergeItems(a, [b]);
  await unchanged(api, () => app.applyReviewed(stale), 'conflict');
  let rows = await app.listRelationships(ref(a), 'both', null, page);
  check(rows.total === 2 && rows.relationships.find(edge => edge.type === 'referencing').assertions.length === 2,
    'Application index did not coalesce surviving native endpoints');
  check((await app.listRelationships(ref(b), 'both', null, page)).total === 2, 'Original merged-key query did not follow the survivor');
  check((await app.describe(ref(b))).status === 'active', 'Application description did not follow an unambiguous merge');
  let report = await app.reconcile('self', { offset: 0, limit: 1 });
  check(report.state === 'ready' && report.total === 2 && report.clusters.length === 1 && report.nextOffset === 1
    && report.diagnostics.some(value => value.code === 'self-edge'), 'Reconciliation inspection is not explicit or paginated');
  await rejects(() => app.reconcile('self', { offset: -1, limit: 1 }), 'validation');
  const detached = await app.reconcile('self', page), manual = detached.clusters.find(cluster => cluster.assertions.length);
  manual.assertions[0].metadata.note = 'caller mutation'; manual.source.key = 'AAAAAAAA';
  check((await app.reconcile('self', page)).clusters.find(cluster => cluster.assertions.length).assertions[0].metadata.note === 'Shared Café 你好', 'Inspection caller mutated the cached projection');
  await preserved(api, before, count);
  await Zotero.UndoHistory.undo();
  check((await app.reconcile('self', page)).total === 5, 'Undo left stale application projection');
  await Zotero.UndoHistory.redo();
  check((await app.reconcile('self', page)).total === 2, 'Redo left stale application projection');
  const hidden = (await app.read('self')).snapshot.assertions.find(root => root.type === 'similar');
  const hiddenEdit = await app.draftUpdate(hidden.id, { source: hidden.source, target: hidden.target, type: hidden.type,
    metadata: { note: 'Explicit edit of retained hidden metadata' } }, 'self');
  await app.applyReviewed(await app.preview(hiddenEdit.command, hiddenEdit.expectedRevision));
  check((await app.read('self')).snapshot.assertions.find(root => root.id === hidden.id).target.key === b.key, 'Hidden metadata edit rewrote original ownership');
  const movedHidden = await app.draftUpdate(hidden.id, { source: ref(b), target: ref(a), type: hidden.type,
    metadata: { note: 'Unreviewable moved self-link' } }, 'self');
  await unchanged(api, () => app.preview(movedHidden.command, movedHidden.expectedRevision), 'validation');
  const lockDraft = await app.draftCreate({ source: ref(a), target: ref(d), type: 'similar', metadata: {} });
  const lockReview = await app.preview(lockDraft.command, lockDraft.expectedRevision);
  await changedUnderLock(api, app, lockReview, c);
  const unknown = await app.preview(lockDraft.command, lockDraft.expectedRevision);
  await unchanged(api, () => app.applyReviewed(structuredClone(unknown)), 'conflict');
  unknown.snapshot.assertions.at(-1).metadata.note = 'unreviewed mutation';
  await unchanged(api, () => app.applyReviewed(unknown), 'conflict');
  await Zotero.UndoHistory.undo();
  const second = (await app.read('self')).snapshot.assertions.find(root => root.source.key === b.key && root.type === 'referencing');
  const divergent = await app.draftUpdate(second.id, { source: ref(b), target: ref(c), type: 'referencing', metadata: { note: 'Independent original value' } }, 'self');
  await app.applyReviewed(await app.preview(divergent.command, divergent.expectedRevision));
  await mergeItems(a, [b]);
  await rejects(() => app.listRelationships(ref(a), 'both', null, page), 'conflict');
  report = await app.reconcile('self', page);
  check(report.state === 'conflict' && report.clusters.some(cluster => cluster.conflicts[0]?.contributors.length === 2), 'Complete conflict contributors are not inspectable');
  const checkpoint = await app.read('self'), checkpointCount = await commits(api);
  const repair = await app.draftUpdate(second.id, { source: ref(b), target: ref(c), type: 'referencing', metadata: { note: 'Shared Café 你好' } }, 'self');
  const review = await app.preview(repair.command, repair.expectedRevision);
  check(review.changeSet.derived === null && review.projection.before.state === 'conflict' && review.projection.after.state === 'ready'
    && review.projection.after.relationships.length === 2, 'Repair invented an empty before graph or omitted complete after effects');
  await preserved(api, checkpoint, checkpointCount);
  await app.applyReviewed(review);
  const repaired = await app.read('self');
  check(repaired.snapshot.assertions.find(root => root.id === second.id).source.key === b.key, 'Repair destructively rewrote original endpoint ownership');
  check((await app.listRelationships(ref(a), 'both', null, page)).total === 2 && await commits(api) === checkpointCount + 1, 'Repair did not publish exactly one valid generation');
  const duplicate = await app.draftCreate({ source: ref(a), target: ref(c), type: 'referencing', metadata: {} }).then(value => value, error => error);
  if (duplicate.command) await unchanged(api, () => app.preview(duplicate.command, duplicate.expectedRevision), 'validation');
  else check(duplicate.code === 'validation', 'Duplicate manual authority failed for another reason');
  const self = await app.draftCreate({ source: ref(a), target: ref(b), type: 'referenced-by', metadata: {} });
  await unchanged(api, () => app.preview(self.command, self.expectedRevision), 'validation');
  const survivor = (await app.describe(ref(b))).ref;
  await production.gateway.navigate(Zotero.getMainWindow(), survivor);
  await until(Zotero, () => Zotero.getMainWindow().ZoteroPane.getSelectedItems()[0]?.key === a.key, 'navigation to native survivor');
  const finalBefore = await app.read('self'), finalCount = await commits(api);
  await setEnabled(Zotero, production.addon, false); await c.eraseTx(); await setEnabled(Zotero, production.addon, true);
  app = Zotero.ReferenceRelationships.application;
  report = await app.reconcile('self', page); rows = await app.listRelationships(ref(a), 'both', null, page);
  check(rows.total === 0 && report.diagnostics.some(value => value.details.status === 'missing' && value.details.ref.key === c.key), 'Disabled erase did not leave an explicit recoverable orphan');
  await preserved(api, finalBefore, finalCount);
  return { before: finalBefore, count: finalCount, a: a.key, nativeApplicationProjection: true, mergeUndoRedo: true,
    completeConflictRepair: true, nativePreviewAndInsideLockGuards: true, opaqueReceiptGuard: true,
    originalOwnership: true, projectedSelfAndDuplicateRejected: true, disabledEraseDiagnostics: true, cancellation };
}
