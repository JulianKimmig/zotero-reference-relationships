/** Own one actual Gecko recording and explicit UserTiming phases, with terminal capture and native cleanup. */
import type { NativeAPI } from './native-api.mts';
import { present } from './evidence.sys.mts';
import { check } from './ui-helpers.sys.mts';

/** Verified raw evidence identity and clock alignment, without interpreting GC markers or claiming performance acceptance. */
export interface NativeProfileCapture {
  profilePath: string; profileBytes: number; availableFeatures: string[]; selectedFeatures: string[]; selectedThreads: string[];
  clock: { epochMs: number; monotonicMs: number; timeOriginMs: number }; labels: string[];
}

/** Scoped generic phase tracing preserves the actual operation's result or failure. */
export interface NativePhaseTrace {
  /** Trace one real operation without changing its outcome. @param label Unique synthetic phase name. @param action Native/application callback. @returns The original result or rejection. */
  phase<T>(label: string, action: () => T | Promise<T>): Promise<T>;
}

/** Start a recording only in an idle profiler, using installed-runtime APIs rather than stale documentation signatures. @param api Actual anonymous native service/IO capabilities. @param path Absolute new raw-profile destination. @returns Owned phase/capture operations; finish is idempotent and always stops/cleans owned resources. */
export function startNativeProfile(api: NativeAPI, path: string): NativePhaseTrace & { finish(): Promise<NativeProfileCapture> } {
  check(path.startsWith('/'), 'Native profile path must be absolute');
  const profiler = present(api.Services.profiler), io = present(api.IOUtils), performance = api.Zotero.getMainWindow().performance;
  for (const key of ['IsActive', 'GetFeatures', 'StartProfiler', 'StopProfiler', 'getProfileDataAsync'] as const) {
    check(typeof profiler[key] === 'function', `Native profiler capability missing: ${key}`);
  }
  check(!profiler.IsActive(), 'Refusing to replace an already-active native profiler');
  const availableFeatures = profiler.GetFeatures(); check(availableFeatures.includes('js'), 'Native JavaScript profiler unavailable');
  const selectedFeatures = ['js'], selectedThreads = ['GeckoMain'];
  const clock = { epochMs: Date.now(), monotonicMs: performance.now(), timeOriginMs: performance.timeOrigin };
  const labels = new Set<string>(); let active = 0, ending: Promise<NativeProfileCapture> | undefined;
  try { profiler.StartProfiler(2097152, 1, selectedFeatures, selectedThreads, 0, 0); }
  catch (error) { if (profiler.IsActive()) profiler.StopProfiler(); throw error; }
  check(profiler.IsActive(), 'Native profiler did not start');
  return {
    /** Trace exactly one actual operation, recording its boundary even when it fails. @param label Unique synthetic phase identity. @param action Real native/application work. @returns The operation's original result; failures are propagated unchanged. */
    async phase<T>(label: string, action: () => T | Promise<T>): Promise<T> {
      check(!ending && profiler.IsActive(), 'Native profile is no longer recording');
      check(/^RR_[A-Za-z0-9_:.-]+$/.test(label) && !labels.has(label), 'Invalid or duplicate native phase label');
      labels.add(label); active++; performance.mark(`${label}:start`);
      try { return await action(); }
      finally {
        active--; performance.mark(`${label}:end`); performance.measure(label, `${label}:start`, `${label}:end`);
      }
    },
    /** Capture once and stop in every terminal path, clearing only this owner's timing entries. @returns Raw evidence identity and clock metadata; capture/write failures remain explicit. */
    finish(): Promise<NativeProfileCapture> {
      check(active === 0, 'Cannot capture while native phases are still active');
      if (!ending) ending = (async () => {
        try {
          check(profiler.IsActive(), 'Native profiler stopped before capture');
          const profile = await profiler.getProfileDataAsync();
          check(!!profile && typeof profile === 'object' && 'meta' in profile && 'threads' in profile, 'Invalid structured native profile');
          const profileBytes = await io.writeUTF8(path, JSON.stringify(profile), { mode: 'create', flush: true });
          return { profilePath: path, profileBytes, availableFeatures, selectedFeatures, selectedThreads, clock, labels: [...labels] };
        } finally {
          profiler.StopProfiler();
          for (const label of labels) {
            performance.clearMarks(`${label}:start`); performance.clearMarks(`${label}:end`); performance.clearMeasures(label);
          }
        }
      })();
      return ending;
    },
  };
}
