/** Native quality actions share one resource namespace while independently owning measurement, lifetime and shutdown fixtures. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { qualityPerformance } from './quality-performance.sys.mts';
import { qualityLifetimes } from './quality-lifetimes.sys.mts';
import { qualityPostcommit } from './quality-postcommit.sys.mts';
import { qualityApplication } from './quality-application.sys.mts';
import { qualityShutdown } from './quality-shutdown.sys.mts';
import { qualityPhases, qualityReadback } from './quality-phases.sys.mts';
import { qualityKeyboardProbe } from './quality-keyboard-probe.sys.mts';
import { qualityFocus } from './quality-focus.sys.mts';
import { qualityKeyboardJourney } from './quality-keyboard-journey.sys.mts';
import { qualityErrorFocus } from './quality-error-focus.sys.mts';
import { qualityPresentation } from './quality-presentation.sys.mts';
import { qualityProfilerProbe } from './quality-profiler.sys.mts';
import { qualityProfiledApplication } from './quality-profiled-application.sys.mts';
import { check } from './ui-helpers.sys.mts';

/** Dispatch an exact explicitly selected quality case without silently substituting another test. @param {object} job Artifact-bound fresh anonymous native job. @param {object} api Real native host. @returns {Promise<object>} Actual case report; final process status is validated by the runner. */
export async function quality(job: ControllerJob, api: NativeAPI) {
  if (job.action === 'quality:pure') {
    check(job.qualityWorkloads, 'Explicit quality workloads required');
    return qualityPerformance({ ...job, qualityWorkloads: job.qualityWorkloads }, api);
  }
  if (job.action === 'quality:lifetimes') return qualityLifetimes(job, api);
  if (job.action === 'quality:postcommit') return qualityPostcommit(job, api);
  if (job.action === 'quality:application') return qualityApplication(job, api);
  if (job.action === 'quality:phases') return qualityPhases(job, api);
  if (job.action === 'quality:readback') return qualityReadback(job, api);
  if (job.action === 'quality:keyboard-probe') return qualityKeyboardProbe(job, api);
  if (job.action === 'quality:focus') return qualityFocus(job, api);
  if (job.action === 'quality:keyboard-journey') return qualityKeyboardJourney(job, api);
  if (job.action === 'quality:error-focus') return qualityErrorFocus(job, api);
  if (job.action === 'quality:presentation' || job.action === 'quality:presentation-read') return qualityPresentation(job, api);
  if (job.action === 'quality:profiler-probe') return qualityProfilerProbe(job, api);
  if (job.action === 'quality:profiled-application') return qualityProfiledApplication(job, api);
  check(job.action === 'quality:shutdown-plugin' || job.action === 'quality:shutdown-baseline', 'Unknown native quality action');
  return qualityShutdown(job, api);
}
