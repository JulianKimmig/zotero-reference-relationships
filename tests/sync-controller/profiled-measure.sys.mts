/** Add observed per-operation native phases to the existing heartbeat measurement without replacing application work. */
import type { NativeAPI } from './native-api.mts';
import type { NativePhaseTrace } from './native-profile.sys.mts';
import { measureNative } from './quality-measure.sys.mts';

/** Measure the same actual callbacks, optionally recording one unique marker for every sample. @param api Native host. @param trace Owned active profiler, absent for existing unprofiled journeys. @param label Stable synthetic phase prefix. @param action Real operation. @param count Existing measurement sample count. @returns Original timing distribution and actual heartbeat observations. */
export function measureNativePhases(api: NativeAPI, trace: NativePhaseTrace | undefined, label: string, action: () => unknown | Promise<unknown>, count = 7) {
  let ordinal = 0;
  return measureNative(api, trace ? () => trace.phase(`${label}:${ordinal++}`, action) : action, count);
}
