/** Actual signed baseline, selective native upload interruption, restart and complete-generation readback assertions. */
import { found, present } from './evidence.sys.mts';
import { check } from './ui-helpers.sys.mts';
import { createBaseline, createGeneration, fixtureJSON, requireNotes, requireReady,
  captureUnrelated, requireUnrelated } from './transfer-sync-fixtures.sys.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { TestItem } from './platform-contracts.mts';
import type { GenerationFixture, TransferSyncContext, TransferSyncFixture } from './transfer-sync-contracts.mts';

/** Native sync metadata operation changes only the actual saved item's flag and cache. */
type SyncStatusItem = TestItem & {
  /** Persist only the native sync flag without a note save. @param value Upload suppression or release state. @returns Flag/database update completion. */
  updateSynced(value: boolean): Promise<void>;
};

/** Require a complete generation payload before accessing physical record identities. @param fixture Actual previous phase result. @returns Narrowed generation. */
function generation(fixture: TransferSyncFixture | undefined): GenerationFixture {
  check(fixture?.kind === 'generation', 'This phase requires the captured actual generation fixture'); return fixture;
}

/** Load only the exact owned new record whose upload eligibility may be changed. @param api Actual native platform. @param context Actual group resources. @param fixture Captured production publication. @returns Saved record with the native sync metadata API. */
async function withheldItem(api: NativeAPI, context: TransferSyncContext, fixture: GenerationFixture): Promise<SyncStatusItem> {
  check(fixture.records.includes(fixture.withheld), 'Withheld key is not a new production record');
  const item = found(await api.Zotero.Items.getByLibraryAndKeyAsync(context.group.libraryID, fixture.withheld)) as SyncStatusItem;
  check(item.libraryID === context.group.libraryID && item.isNote() && item.isTopLevelItem() && !item.deleted
    && item.version === 0 && typeof item.updateSynced === 'function', 'Withholding requires the exact new unsynchronized native note');
  await item.loadDataType('note'); return item;
}

/** Check actual full projection pages and exact original/support provenance without assuming the rest of the group is empty. @param api Native codec resources. @param context Real application. @param fixture Baseline or completed generation. @returns Recomputed fixture roots and supports are all present. */
async function requireProjection(api: NativeAPI, context: TransferSyncContext, fixture: TransferSyncFixture): Promise<void> {
  const baseline = fixture.kind === 'baseline' ? fixture : fixture.baseline;
  const expected = fixture.kind === 'baseline' ? fixture.state : fixture.after;
  const roots = expected.snapshot.assertions.filter(root => root.type === baseline.type && root.source.key === baseline.sourceKey);
  check(roots.length >= (fixture.kind === 'generation' ? fixture.assertionIDs.length + 1 : 1), 'Fixture original roots were lost');
  const originals = new Set<string>(), supports = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await context.app.listRelationships({ library: context.scope, key: baseline.sourceKey }, 'both', null, { offset, limit: 25 });
    check(page.revision === expected.head && page.total >= roots.length * 2, 'Actual relationship pages omitted complete inverse effects');
    for (const edge of page.relationships) {
      for (const root of roots) {
        if (edge.assertions.includes(root.id)) {
          check(edge.type === baseline.type && edge.source.key === baseline.sourceKey && edge.target.key === root.target.key
            && fixtureJSON(api, edge.metadata) === fixtureJSON(api, root.metadata), 'Original Unicode metadata changed after synchronization');
          originals.add(root.id);
        }
        for (const support of edge.supports.filter(value => value.root === root.id)) {
          check(support.rule === baseline.rule && support.version === 9 && edge.type === baseline.inverseType
            && edge.source.key === root.target.key && edge.target.key === baseline.sourceKey
            && fixtureJSON(api, support.metadata) === fixtureJSON(api, root.metadata), 'Native recomputation lost inverse provenance or foreign rule version');
          supports.add(root.id);
        }
      }
    }
    if (page.nextOffset === null) break;
    check(page.nextOffset > offset, 'Relationship pagination stopped advancing'); offset = page.nextOffset;
  }
  check(roots.every(root => originals.has(root.id) && supports.has(root.id)), 'Complete paged fixture provenance is missing');
}

/** Require the precise persisted incomplete generation without presenting a partial snapshot as current. @param api Actual native platform. @param context Real repository/application. @param fixture Exact sender generation. @returns Observed pending state. */
async function requirePending(api: NativeAPI, context: TransferSyncContext, fixture: GenerationFixture) {
  await requireNotes(api, context, [...fixture.records.filter(key => key !== fixture.withheld), fixture.after.head], 'published');
  check(await api.Zotero.Items.getByLibraryAndKeyAsync(context.group.libraryID, fixture.withheld) === false,
    'Withheld production record unexpectedly arrived');
  context.repository.invalidate(); context.app.invalidate(context.scope);
  const expected = { state: 'pending', missing: [fixture.withheld], previousHeads: [fixture.before.head] };
  const state = await context.repository.read();
  check(fixtureJSON(api, state) === fixtureJSON(api, expected) && !Object.hasOwn(state, 'snapshot'), 'Native repository accepted or misidentified an incomplete generation');
  check(fixtureJSON(api, await context.app.read(context.scope)) === fixtureJSON(api, expected), 'Application exposed a partial generation');
  const previous = await context.repository.readHead(fixture.before.head);
  check(fixtureJSON(api, previous) === fixtureJSON(api, { head: fixture.before.head, snapshot: fixture.before.snapshot }), 'Pending receipt damaged the previous complete authority');
  return state;
}

/** Execute only actual baseline/upload phases; dispatcher owns context lifecycle and all download/fork actions. @param job Exact phase and prior typed fixture. @param api Actual signed platform. @param context Scoped real service/store/sync resources. @returns Verified fixture and bounded native evidence flags. */
export async function transferSyncUpload(job: ControllerJob, api: NativeAPI, context: TransferSyncContext) {
  const unrelated = await captureUnrelated(context);
  if (job.action === 'transfer:sync-baseline') {
    check(job.transferFixture === undefined, 'Do not replay baseline creation with an existing fixture');
    await context.requireSync(); const fixture = await createBaseline(job, api, context);
    await requireProjection(api, context, fixture); await requireUnrelated(api, context, unrelated);
    return { fixture, actualAdditiveBaseline: true, foreignVersions: true, nativeGroupOnlySync: true, unrelatedAuthorityPreserved: true };
  }
  if (job.action === 'transfer:sync-upload-partial') {
    check(job.transferFixture?.kind === 'baseline', 'Upload interruption requires the captured baseline');
    await context.requireSync();
    const fixture = await createGeneration(job, api, context, job.transferFixture, 'upload');
    let item: SyncStatusItem | undefined, changed = false;
    try {
      item = await withheldItem(api, context, fixture); check(!item.synced, 'New record was already synchronized');
      const note = item.getNote(); changed = true; await item.updateSynced(true);
      await context.requireSync();
      item = await withheldItem(api, context, fixture);
      check(item.synced && item.getNote() === note, 'Full-sync reset released suppression or changed the immutable withheld record');
      await requireNotes(api, context, [...fixture.records.filter(key => key !== fixture.withheld), fixture.after.head], 'published');
      await requireReady(api, context, fixture.after); await requireUnrelated(api, context, unrelated);
      return { fixture, actualProductionImport: true, checkpointBeforeSuppression: true, nativeUploadWithheld: true,
        withheldVersionZero: true, otherRecordsAndManifestUploaded: true, unrelatedAuthorityPreserved: true };
    } catch (error) {
      if (changed && item && item.version === 0 && item.synced) {
        try { await item.updateSynced(false); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'Upload phase failed and native flag restoration also failed', { cause: error }); }
      }
      throw error;
    }
  }
  if (job.action === 'transfer:sync-pending' || job.action === 'transfer:sync-pending-restart') {
    const fixture = generation(job.transferFixture);
    if (job.action === 'transfer:sync-pending') await context.requireSync();
    const state = await requirePending(api, context, fixture); await requireUnrelated(api, context, unrelated);
    return { fixture, state, nativePartialArrival: true, exactMissingRecord: true, previousCompleteHeadPreserved: true,
      restartedWithoutSync: job.action === 'transfer:sync-pending-restart', noPartialSnapshot: true, unrelatedAuthorityPreserved: true };
  }
  if (job.action === 'transfer:sync-upload-complete') {
    const fixture = generation(job.transferFixture), item = await withheldItem(api, context, fixture);
    check(item.synced, 'Captured upload suppression was lost before release');
    await item.updateSynced(false); await context.requireSync();
    await requireNotes(api, context, [...fixture.records, fixture.after.head], 'published');
    await requireReady(api, context, fixture.after); await requireProjection(api, context, fixture);
    await requireUnrelated(api, context, unrelated);
    return { fixture, nativeUploadReleased: true, exactGenerationReady: true, derivedSupportsRecomputed: true, unrelatedAuthorityPreserved: true };
  }
  check(job.action === 'transfer:sync-ready', 'Unknown baseline/upload transfer phase');
  const fixture = present(job.transferFixture); check(fixture.kind === 'baseline' || fixture.kind === 'generation', 'Unknown transfer fixture kind');
  await context.requireSync();
  const expected = fixture.kind === 'baseline' ? fixture.state : fixture.after;
  await requireReady(api, context, expected);
  if (fixture.kind === 'generation') await requireNotes(api, context, [...fixture.records, fixture.after.head], 'published');
  else await requireNotes(api, context, [fixture.state.head], 'published');
  await requireProjection(api, context, fixture); await requireUnrelated(api, context, unrelated);
  return { fixture, exactGenerationReady: true, foreignVersions: true, derivedSupportsRecomputed: true, unrelatedAuthorityPreserved: true };
}
