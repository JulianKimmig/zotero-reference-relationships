/** Linux CPU, memory and pressure input parsing keeps actual units and rejects missing or corrupted evidence. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCPU, parseMemory, parsePressure } from '../scripts/sync/host-pressure.mts';

const pressure = 'some avg10=1.00 avg60=2.50 avg300=0.10 total=57926396\nfull avg10=0.00 avg60=0.20 avg300=0.01 total=12\n';
const memory = 'MemTotal: 1000 kB\nMemAvailable: 400 kB\nSwapTotal: 200 kB\nSwapFree: 150 kB\n';

test('pressure samples preserve kernel percentages and accumulated microseconds', () => {
  assert.deepEqual(parsePressure(pressure), { some: { avg10: 1, avg60: 2.5, avg300: .1, totalMicroseconds: 57926396 }, full: { avg10: 0, avg60: .2, avg300: .01, totalMicroseconds: 12 } });
});

test('CPU snapshots count guest time only within its existing user/nice totals', () => {
  const value = parseCPU('cpu  100 2 30 400 5 6 7 8 10 1\ncpu0 1 0 1 1 0 0 0 0 0 0\n');
  assert.deepEqual(value, { totalTicks: 558, idleTicks: 400, ioWaitTicks: 5, stealTicks: 8 });
});

test('memory snapshots convert actual kernel kibibytes to bytes without rounding loss', () => {
  assert.deepEqual(parseMemory(memory), { totalBytes: 1024000, availableBytes: 409600, swapTotalBytes: 204800, swapFreeBytes: 153600 });
});

test('missing, duplicate and malformed pressure rows fail instead of becoming zero pressure', () => {
  for (const text of ['', pressure.replace('some ', 'other '), pressure + pressure,
    pressure.replace('avg10=1.00', 'avg10=NaN'), pressure.replace('total=12', 'total=-1')]) {
    assert.throws(() => parsePressure(text), /pressure/i);
  }
});

test('CPU parsing rejects missing, unsafe, negative and truncated counters', () => {
  for (const text of ['cpu0 1 2 3 4 5 6 7 8', 'cpu 1 2', 'cpu 1 2 3 4 5 6 7 -1 0 0', 'cpu 9007199254740992 0 0 0 0 0 0 0 0 0']) {
    assert.throws(() => parseCPU(text), /CPU/i);
  }
});

test('missing fields, wrong units and impossible available memory remain failures', () => {
  for (const text of [memory.replace('SwapFree: 150 kB\n', ''), memory.replace('400 kB', '400 MB'), memory.replace('400 kB', '1001 kB'), memory + 'MemTotal: 1000 kB\n']) {
    assert.throws(() => parseMemory(text), /memory/i);
  }
});
