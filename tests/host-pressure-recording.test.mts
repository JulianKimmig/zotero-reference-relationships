/** Real filesystem tests exercise host-recorder ownership, periodic evidence, error propagation and terminal cleanup. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { startHostPressureRecording } from '../scripts/sync/host-pressure-recording.mts';

/** Materialize external kernel-style files rather than mocking any source function. @param root Test-owned directory. @returns Absolute external-resource root. */
async function procFixture(root: string): Promise<string> {
  const proc = join(root, 'proc'); await mkdir(join(proc, 'pressure'), { recursive: true });
  await writeFile(join(proc, 'stat'), 'cpu 100 2 30 400 5 6 7 8 10 1\n');
  await writeFile(join(proc, 'meminfo'), 'MemTotal: 1000 kB\nMemAvailable: 400 kB\nSwapTotal: 200 kB\nSwapFree: 150 kB\n');
  const pressure = 'some avg10=1.00 avg60=0.00 avg300=0.00 total=12\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n';
  for (const resource of ['cpu', 'memory', 'io']) await writeFile(join(proc, 'pressure', resource), pressure);
  return proc;
}

test('recording writes initial, periodic and final observations, then stops once without further writes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rr-host-recorder-')); t.after(() => rm(root, { recursive: true }));
  const path = join(root, 'samples.jsonl'), procRoot = await procFixture(root);
  const recorder = await startHostPressureRecording(path, { procRoot, intervalMs: 10 });
  await delay(40); const result = await recorder.stop(); assert.deepEqual(await recorder.stop(), result);
  const text = await readFile(path, 'utf8'), rows = text.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.length, result.samples); assert.ok(result.samples >= 3);
  assert.equal(rows[0].cpu.totalTicks, 558); assert.equal(rows[0].memory.availableBytes, 409600);
  await delay(30); assert.equal(await readFile(path, 'utf8'), text);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('an existing evidence path is preserved without overwrite', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rr-host-recorder-')); t.after(() => rm(root, { recursive: true }));
  const path = join(root, 'samples.jsonl'); await writeFile(path, 'existing');
  await assert.rejects(startHostPressureRecording(path, { procRoot: await procFixture(root), intervalMs: 10 }), { code: 'EEXIST' });
  assert.equal(await readFile(path, 'utf8'), 'existing');
});

test('loss of an external pressure resource rejects stop and preserves the partial recording', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rr-host-recorder-')); t.after(() => rm(root, { recursive: true }));
  const path = join(root, 'samples.jsonl'), procRoot = await procFixture(root);
  const recorder = await startHostPressureRecording(path, { procRoot, intervalMs: 10 });
  await rename(join(procRoot, 'pressure', 'cpu'), join(procRoot, 'pressure', 'cpu-unavailable'));
  await delay(35); await assert.rejects(recorder.stop(), { code: 'ENOENT' });
  const partial = await readFile(path, 'utf8'); assert.ok(partial.includes('totalTicks'));
  await delay(25); assert.equal(await readFile(path, 'utf8'), partial);
});

test('invalid sampling intervals fail before creating evidence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rr-host-recorder-')); t.after(() => rm(root, { recursive: true }));
  const path = join(root, 'samples.jsonl');
  for (const intervalMs of [0, -1, Number.NaN]) await assert.rejects(startHostPressureRecording(path, { procRoot: '/proc', intervalMs }), /interval/i);
  await assert.rejects(stat(path), { code: 'ENOENT' });
});
