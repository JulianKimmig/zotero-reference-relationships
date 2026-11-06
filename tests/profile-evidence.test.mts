/** Version31 profiler evidence is interpreted from observed native schemas, with invalid or ambiguous timestamps rejected. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readNativeMarkers, intervalOverlap } from '../scripts/sync/profile-evidence.mts';

/** Minimal external profile preserves the marker schema and UserTiming shape captured in actual Zotero140. @returns Detached native-format evidence. */
function profile() {
  return { meta: { version: 31, startTime: 1000000 }, threads: [{ name: 'GeckoMain', stringTable: ['UserTiming', 'GCSlice', 'Task'],
    markers: { schema: { name: 0, startTime: 1, endTime: 2, phase: 3, category: 4, data: 5 }, data: [
      [0, 10, 30, 1, 8, { type: 'UserTiming', name: 'RR_PHASE:preview:0', entryType: 'measure' }],
      [1, 20, 24, 1, 4, { type: 'GCSlice' }], [2, 40, 0, 2, 4, null], [2, 0, 50, 3, 4, null],
      [0, 10, 0, 0, 8, { type: 'UserTiming', name: 'RR_PHASE:preview:0:start', entryType: 'mark' }],
    ] } }] };
}

test('observed profiler marker columns preserve epoch alignment, typed timing names and interval overlap', () => {
  const evidence = readNativeMarkers(profile());
  assert.equal(evidence.version, 31); assert.equal(evidence.markers.length, 5);
  const [preview, gc] = evidence.markers;
  assert.deepEqual(preview, { name: 'UserTiming', type: 'UserTiming', detailName: 'RR_PHASE:preview:0', entryType: 'measure', phase: 1, startEpochMs: 1000010, endEpochMs: 1000030 });
  assert.equal(intervalOverlap(preview, gc), 4);
});

test('instant and split-boundary markers remain partial rather than becoming invented full pauses', () => {
  const markers = readNativeMarkers(profile()).markers;
  assert.equal(markers[2].endEpochMs, null); assert.equal(markers[3].startEpochMs, null);
  assert.equal(markers[4].endEpochMs, null);
  assert.throws(() => intervalOverlap(markers[0], markers[2]), /complete interval/i);
});

test('real native marker rows may omit only their optional trailing payload', () => {
  const value = profile(); value.threads[0].markers.data[2].pop();
  const marker = readNativeMarkers(value).markers[2];
  assert.equal(marker.name, 'Task'); assert.equal(marker.type, null); assert.equal(marker.phase, 2);
});

test('disjoint and touching real intervals have zero overlap', () => {
  const [first, second] = readNativeMarkers(profile()).markers;
  assert.equal(intervalOverlap(first, { ...second, startEpochMs: first.endEpochMs, endEpochMs: 1000050 }), 0);
  assert.equal(intervalOverlap(first, { ...second, startEpochMs: 1000040, endEpochMs: 1000050 }), 0);
});

test('unsupported versions and missing or ambiguous main threads fail explicitly', () => {
  const wrong = profile(); wrong.meta.version = 32;
  assert.throws(() => readNativeMarkers(wrong), /version/i);
  assert.throws(() => readNativeMarkers({ ...profile(), threads: [] }), /GeckoMain/i);
  const duplicated = profile(); duplicated.threads.push(duplicated.threads[0]);
  assert.throws(() => readNativeMarkers(duplicated), /GeckoMain/i);
});

test('malformed schema, string identities and backwards intervals are rejected separately', () => {
  const variants = [profile(), profile(), profile(), profile()];
  variants[0].threads[0].markers.schema.startTime = 0;
  variants[1].threads[0].markers.data[0][0] = 99;
  variants[2].threads[0].markers.data[0][2] = 9;
  variants[3].meta.startTime = Number.NaN;
  for (const value of variants) assert.throws(() => readNativeMarkers(value), /schema|name|interval|time/i);
});
