/** Compare actual dense preview work on one preserved unsigned-in authority without replaying fixture publication. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { resources, preserved } from './reconciliation-fixtures.sys.mts';
import { commits } from './rules-fixtures.sys.mts';
import { present, readyState } from './evidence.sys.mts';
import { check } from './ui-helpers.sys.mts';
import { startNativeProfile } from './native-profile.sys.mts';
import { measureNativePhases } from './profiled-measure.sys.mts';

/** Measure the same three real no-write previews against an explicit unchanged head. @param job Preserved dedicated profile, exact artifact, expected head and unique pass label. @param api Actual native capabilities. @returns Exact workload, profiling and authority-preservation evidence; no new references or generations are created. */
export async function qualityReadonlyPreview(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api;
  check(!Zotero.Users.getCurrentUserID(), 'Read-only preview comparison requires unsigned-in client');
  check(!!job.currentHead && !!job.fixtures?.pass && /^[a-z][a-z0-9-]*$/.test(job.fixtures.pass), 'Explicit current head and unique comparison pass required');
  await resources(job, api);
  const app = present(Zotero.ReferenceRelationships).application, before = readyState(await app.read('self')), count = await commits(api);
  check(before.head === job.currentHead && before.snapshot.assertions.length === 1000 && before.snapshot.rules.length === 50,
    'Read-only preview comparison requires the exact preserved dense workload');
  const root = before.snapshot.assertions[0];
  const draft = await app.draftUpdate(root.id, { source: root.source, target: root.target, type: root.type,
    metadata: { note: 'Read-only profiled preview comparison Café 你好' } }, 'self');
  const profile = startNativeProfile(api, `${job.data}/quality-readonly-preview-${job.fixtures.pass}.json`);
  try {
    const preview = await measureNativePhases(api, profile, 'RR_PHASE:readonlyPreview', async () => {
      const review = await app.preview(draft.command, draft.expectedRevision);
      check(review.changeSet.assertions.updated.length === 1 && review.projection.after.state === 'ready'
        && review.projection.after.relationships.length === 2000 && review.projection.after.transitions === 100000,
      'Read-only comparison changed the reviewed original or bounded complete closure');
    }, 3);
    await preserved(api, before, count);
    return { pass: job.fixtures.pass, head: before.head, assertions: 1000, rules: 50, manifests: count,
      preview, profile: await profile.finish(), noAuthorityWrites: true, forcedGC: false };
  } finally { await profile.finish(); }
}
