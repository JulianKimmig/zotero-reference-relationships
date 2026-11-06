/** Strict Linux host-pressure snapshots retain actual CPU counters, memory gauges and PSI totals for native-run correlation. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

/** Actual kernel percentages and accumulated stall microseconds for one pressure class. */
interface PressureAverage { avg10: number; avg60: number; avg300: number; totalMicroseconds: number }

/** Require a safe nonnegative kernel counter. @param value Decimal external field. @param label Resource diagnostic. @returns Exact integer value. */
function counter(value: string, label: string): number {
  assert.match(value, /^\d+$/, `Invalid ${label} counter`); const parsed = Number(value);
  assert.ok(Number.isSafeInteger(parsed), `Unsafe ${label} counter`); return parsed;
}

/** Parse the two pressure classes present on the measured Linux host, never substituting zeros. @param text Actual /proc/pressure resource text. @returns Percent averages and cumulative microseconds for both classes. */
export function parsePressure(text: string): { some: PressureAverage; full: PressureAverage } {
  const rows = new Map<string, PressureAverage>();
  for (const line of text.trim().split('\n')) {
    const match = /^(some|full) avg10=(\d+(?:\.\d+)?) avg60=(\d+(?:\.\d+)?) avg300=(\d+(?:\.\d+)?) total=(\d+)$/.exec(line);
    assert.ok(match && !rows.has(match[1]), 'Missing, duplicate or malformed pressure row');
    const values = match.slice(2, 5).map(Number);
    assert.ok(values.every(value => Number.isFinite(value) && value >= 0 && value <= 100), 'Invalid pressure percentage');
    rows.set(match[1], { avg10: values[0], avg60: values[1], avg300: values[2], totalMicroseconds: counter(match[5], 'pressure') });
  }
  assert.ok(rows.has('some') && rows.has('full') && rows.size === 2, 'Missing pressure classes');
  return { some: rows.get('some')!, full: rows.get('full')! };
}

/** Parse aggregate CPU counters while avoiding double-counted guest ticks. @param text Actual /proc/stat text. @returns Total, idle, I/O-wait and stolen ticks; differences require consecutive snapshots. */
export function parseCPU(text: string): { totalTicks: number; idleTicks: number; ioWaitTicks: number; stealTicks: number } {
  const rows = text.trim().split('\n').filter(line => /^cpu\s/.test(line)); assert.equal(rows.length, 1, 'Missing or duplicate aggregate CPU row');
  const fields = rows[0].trim().split(/\s+/).slice(1); assert.equal(fields.length, 10, 'Unsupported CPU counter columns');
  const values = fields.map(value => counter(value, 'CPU')), totalTicks = values.slice(0, 8).reduce((sum, value) => sum + value, 0);
  assert.ok(Number.isSafeInteger(totalTicks), 'Unsafe CPU total');
  return { totalTicks, idleTicks: values[3], ioWaitTicks: values[4], stealTicks: values[7] };
}

/** Parse required memory gauges using the kernel's kibibyte unit. @param text Actual /proc/meminfo text. @returns Exact byte gauges, rejecting impossible or missing values. */
export function parseMemory(text: string): { totalBytes: number; availableBytes: number; swapTotalBytes: number; swapFreeBytes: number } {
  const fields = ['MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree'] as const, values = new Map<string, number>();
  for (const line of text.trim().split('\n')) {
    if (!fields.some(field => line.startsWith(`${field}:`))) continue;
    const match = /^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+) kB$/.exec(line);
    assert.ok(match && !values.has(match[1]), 'Invalid or duplicate memory field');
    const bytes = counter(match[2], 'memory') * 1024; assert.ok(Number.isSafeInteger(bytes), 'Unsafe memory gauge'); values.set(match[1], bytes);
  }
  assert.ok(fields.every(field => values.has(field)), 'Missing memory gauge');
  const [totalBytes, availableBytes, swapTotalBytes, swapFreeBytes] = fields.map(field => values.get(field)!);
  assert.ok(totalBytes > 0 && availableBytes <= totalBytes && swapFreeBytes <= swapTotalBytes, 'Impossible memory gauges');
  return { totalBytes, availableBytes, swapTotalBytes, swapFreeBytes };
}

/** Read genuine host resources concurrently, preserving the wall-clock observation interval. @param procRoot Absolute external resource root, normally /proc. @returns CPU/memory/PSI snapshot; unavailable resources fail explicitly. */
export async function readHostPressure(procRoot: string) {
  assert.ok(isAbsolute(procRoot), 'Host resource root must be absolute');
  const startedEpochMs = Date.now();
  const [cpu, memory, cpuPressure, memoryPressure, ioPressure] = await Promise.all([
    readFile(join(procRoot, 'stat'), 'utf8'), readFile(join(procRoot, 'meminfo'), 'utf8'), readFile(join(procRoot, 'pressure/cpu'), 'utf8'),
    readFile(join(procRoot, 'pressure/memory'), 'utf8'), readFile(join(procRoot, 'pressure/io'), 'utf8'),
  ]);
  return { startedEpochMs, endedEpochMs: Date.now(), cpu: parseCPU(cpu), memory: parseMemory(memory),
    pressure: { cpu: parsePressure(cpuPressure), memory: parsePressure(memoryPressure), io: parsePressure(ioPressure) } };
}
