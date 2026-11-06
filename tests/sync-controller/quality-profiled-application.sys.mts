/** Profile the unchanged real application workload with owned native phases and raw capture, retaining failures and avoiding forced GC. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { startNativeProfile } from './native-profile.sys.mts';
import { qualityApplication } from './quality-application.sys.mts';

/** Collect actual application measurements and native sample/GC markers in the same run. @param job Fresh anonymous exact-XPI workload. @param api Real host resources. @returns Unmodified workload report plus raw profile identity; failures still capture/stop the owned profiler before propagating. */
export async function qualityProfiledApplication(job: ControllerJob, api: NativeAPI) {
  const profile = startNativeProfile(api, `${job.data}/quality-application-profile.json`);
  try {
    const application = await qualityApplication(job, api, profile);
    return { application, profile: await profile.finish(), forcedGC: false };
  } finally { await profile.finish(); }
}
