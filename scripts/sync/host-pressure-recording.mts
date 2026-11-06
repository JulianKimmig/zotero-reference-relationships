/** Own one exclusive host-pressure JSONL recording and its timer/file lifetime around a native profiling run. */
import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { readHostPressure } from './host-pressure.mts';

/** Completed recording identity and the number of fully written observations. */
interface RecordingResult { path: string; samples: number }

/** Start a private, create-only recording with serialized external reads; stop always closes its owned resources. @param path Absolute new JSONL path. @param options Explicit kernel-resource root and sampling interval. @returns Idempotent stop handle; failed reads retain partial evidence and reject stop rather than reporting zero pressure. */
export async function startHostPressureRecording(path: string, options: { procRoot: string; intervalMs: number }): Promise<{ stop(): Promise<RecordingResult> }> {
  assert.ok(isAbsolute(path) && isAbsolute(options.procRoot), 'Recording and host-resource paths must be absolute');
  assert.ok(Number.isSafeInteger(options.intervalMs) && options.intervalMs > 0, 'Positive integer sampling interval required');
  const file = await open(path, 'wx', 0o600);
  let samples = 0, stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined, stopping: Promise<RecordingResult> | undefined;
  let failure: { error: unknown } | null = null;
  /** Read and completely append one observed external snapshot. @returns Completion after the whole JSONL record is written. */
  async function sample(): Promise<void> {
    await file.writeFile(`${JSON.stringify(await readHostPressure(options.procRoot))}\n`); samples++;
  }
  try { await sample(); }
  catch (error) { await file.close(); throw error; }
  /** Schedule the next read only after its predecessor ends; retain actual I/O failures until terminal cleanup. @returns No overlapping reads or discarded failure. */
  function tick(): void {
    pending = sample().catch(error => { failure = { error }; }).finally(() => {
      if (!stopped && !failure) timer = setTimeout(tick, options.intervalMs);
    });
  }
  timer = setTimeout(tick, options.intervalMs);
  return {
    /** Cancel future reads, await the in-flight read and flush/close once, retaining any failure. @returns Exact recording identity/count, or the original external-resource failure. */
    stop(): Promise<RecordingResult> {
      if (!stopping) stopping = (async () => {
        stopped = true; if (timer) clearTimeout(timer);
        try {
          if (pending) await pending;
          if (failure) throw failure.error;
          await sample(); await file.sync(); return { path, samples };
        } finally { await file.close(); }
      })();
      return stopping;
    },
  };
}
