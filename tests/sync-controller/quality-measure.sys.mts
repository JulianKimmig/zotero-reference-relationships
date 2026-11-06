/** Native timings include genuine event-loop heartbeat delays rather than inferring responsiveness from total duration. */
import type { NativeAPI } from './native-api.mts';
import { check } from './ui-helpers.sys.mts';

/** One actual completed operation and the native event-loop opportunities observed around it. */
export interface QualitySample { durationMs: number; maximumHeartbeatGapMs: number; heartbeatTicks: number }

/** Measure real operations without replacing their code, recording native 10ms heartbeat delays after synchronous work drains. @param {object} api Actual Zotero/native window resources. @param {Function} action Actual operation; its result is checked by the caller. @param {number} count Number of independent samples. @returns {Promise<object>} Full samples and empirical median/p95; no fabricated latency target. */
export async function measureNative(api: NativeAPI, action: () => unknown | Promise<unknown>, count = 7) {
  const window = api.Zotero.getMainWindow(), samples: QualitySample[] = [];
  for (let sample = 0; sample < count; sample++) {
    await api.Zotero.Promise.delay(25);
    let last = Date.now(), maximumHeartbeatGapMs = 0, heartbeatTicks = 0;
    const timer = window.setInterval(() => {
      const current = Date.now(); maximumHeartbeatGapMs = Math.max(maximumHeartbeatGapMs, current - last);
      last = current; heartbeatTicks++;
    }, 10);
    try {
      const start = Date.now(); await action(); const durationMs = Date.now() - start;
      await api.Zotero.Promise.delay(25);
      check(heartbeatTicks > 0, 'Native responsiveness monitor never received an event-loop turn');
      samples.push({ durationMs, maximumHeartbeatGapMs, heartbeatTicks });
    } finally { window.clearInterval(timer); }
  }
  const times = samples.map(sample => sample.durationMs).sort((a, b) => a - b);
  return { samples, medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.ceil(times.length * .95) - 1],
    maximumHeartbeatGapMs: Math.max(...samples.map(sample => sample.maximumHeartbeatGapMs)) };
}
