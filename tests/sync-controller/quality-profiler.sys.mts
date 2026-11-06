/** Verify the actual installed profiler and captured native UserTiming markers before interpreting heavy-work or GC evidence. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { resources, preserved } from './reconciliation-fixtures.sys.mts';
import { commits } from './rules-fixtures.sys.mts';
import { present } from './evidence.sys.mts';
import { check } from './ui-helpers.sys.mts';
import { startNativeProfile } from './native-profile.sys.mts';
import { measureNativePhases } from './profiled-measure.sys.mts';

/** Capture a genuine short anonymous native profile without replacing an existing profiler, forcing GC or publishing data. @param job Fresh unsigned-in client with an immutable production XPI. @param api Actual native services and IO. @returns Verified runtime capabilities, clock alignment and raw profile location, preserving exact authority. */
export async function qualityProfilerProbe(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api;
  check(!Zotero.Users.getCurrentUserID(), 'Profiler probe requires an unsigned-in client');
  await resources(job, api);
  const app = present(Zotero.ReferenceRelationships).application, before = await app.read('self'), count = await commits(api);
  check(before.state === 'uninitialized' && count === 0, 'Profiler probe requires empty authority');
  const session = startNativeProfile(api, `${job.data}/quality-profiler-probe.json`);
  const marker = 'RR_NATIVE_PROFILER_CAPABILITY_PROBE';
  const sentinel = new Error('Expected native profiler phase failure');
  let callbackCount = 0, failurePreserved = false;
  try {
    const value = await session.phase(marker, async () => { callbackCount++; await Zotero.Promise.delay(75); return 42; });
    check(value === 42 && callbackCount === 1, 'Profiling changed callback result or replayed its work');
    const measured = await measureNativePhases(api, session, 'RR_NATIVE_PROFILER_MEASURED', async () => {
      callbackCount++; await Zotero.Promise.delay(35);
    }, 2);
    check(measured.samples.length === 2 && Number(callbackCount) === 3 && measured.samples.every(value => value.heartbeatTicks > 0),
      'Profiled native measurement changed sample/callback counts or lost actual heartbeat turns');
    try { await session.phase('RR_NATIVE_PROFILER_FAILURE_PROBE', () => { throw sentinel; }); }
    catch (error) { check(error === sentinel, 'Profiling replaced the actual action failure'); failurePreserved = true; }
    check(failurePreserved, 'Profiling hid the actual action failure');
    await Zotero.Promise.delay(50);
  } finally { await session.finish(); }
  const capture = await session.finish();
  const text = await present(api.IOUtils).readUTF8(capture.profilePath);
  check([marker, 'RR_NATIVE_PROFILER_FAILURE_PROBE', 'RR_NATIVE_PROFILER_MEASURED:0', 'RR_NATIVE_PROFILER_MEASURED:1']
    .every(label => text.includes(label)), 'Native profiler missed actual success/failure/measurement timing markers');
  check(!present(api.Services.profiler).IsActive(), 'Native profiler remained active after cleanup');
  await preserved(api, before, count);
  return { ...capture, nativeVersion: Zotero.version, marker, callbackCount, failurePreserved,
    stopped: true, noAuthorityWrites: true, before, manifests: count, forcedGC: false };
}
