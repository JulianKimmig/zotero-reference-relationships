/** Validate observed Gecko31 marker tables and align their real timestamps without inventing durations for partial events. */
import assert from 'node:assert/strict';

/** One detached main-thread marker; null boundaries retain instant or split-event semantics. */
export interface NativeMarker {
  name: string; type: string | null; detailName: string | null; entryType: string | null;
  phase: 0 | 1 | 2 | 3; startEpochMs: number | null; endEpochMs: number | null;
}

/** Require an external JSON object. @param value Untrusted native JSON field. @param label Diagnostic identity. @returns Object whose fields still require validation. */
function object(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `Invalid profile ${label}`);
  return value as Record<string, unknown>;
}

/** Require finite nonnegative native milliseconds. @param value External timestamp. @returns Validated milliseconds. */
function time(value: unknown): number {
  assert.ok(typeof value === 'number' && Number.isFinite(value) && value >= 0, 'Invalid profile time'); return value;
}

/** Parse only the actual verified version31 parent main-thread format, preserving boundary semantics. @param value External native profile JSON. @returns Epoch-aligned markers and version, failing explicitly for unsupported or ambiguous evidence. */
export function readNativeMarkers(value: unknown): { version: 31; markers: NativeMarker[] } {
  const root = object(value, 'root'), meta = object(root.meta, 'metadata');
  assert.equal(meta.version, 31, 'Unsupported native profile version');
  const origin = time(meta.startTime); assert.ok(origin > 0, 'Invalid profile epoch time');
  assert.ok(Array.isArray(root.threads), 'Missing profile threads');
  const main = root.threads.map(thread => object(thread, 'thread')).filter(thread => thread.name === 'GeckoMain');
  assert.equal(main.length, 1, 'Expected exactly one parent GeckoMain thread');
  const table = object(main[0].markers, 'marker table'), schema = object(table.schema, 'marker schema'), strings = main[0].stringTable;
  assert.ok(Array.isArray(strings) && strings.every(value => typeof value === 'string'), 'Invalid profile marker name table');
  const keys = ['name', 'startTime', 'endTime', 'phase', 'category', 'data'] as const;
  const columns = keys.map(key => schema[key]);
  assert.ok(columns.every(index => typeof index === 'number' && Number.isSafeInteger(index) && index >= 0)
    && new Set(columns).size === columns.length, 'Invalid profile marker schema');
  const indexes = Object.fromEntries(keys.map((key, index) => [key, columns[index]])) as Record<typeof keys[number], number>;
  assert.ok(Array.isArray(table.data), 'Invalid profile marker rows');
  const markers = table.data.map((row): NativeMarker => {
    const required = keys.filter(key => key !== 'data').map(key => indexes[key]);
    assert.ok(Array.isArray(row) && row.length > Math.max(...required), 'Truncated profile marker schema row');
    const nameIndex = row[indexes.name], phase = row[indexes.phase], payload = row[indexes.data];
    assert.ok(Number.isSafeInteger(nameIndex) && nameIndex >= 0 && nameIndex < strings.length, 'Invalid profile marker name');
    assert.ok(phase === 0 || phase === 1 || phase === 2 || phase === 3, 'Invalid profile marker phase');
    const start = time(row[indexes.startTime]), end = time(row[indexes.endTime]);
    if (phase === 1) assert.ok(end >= start, 'Backwards profile marker interval');
    const data = payload === null || payload === undefined ? null : object(payload, 'marker payload');
    if (data?.type !== undefined) assert.equal(typeof data.type, 'string', 'Invalid profile marker type');
    const timing = data?.type === 'UserTiming';
    if (timing) {
      assert.equal(typeof data.name, 'string', 'Missing UserTiming name');
      assert.ok(data.entryType === 'mark' || data.entryType === 'measure', 'Invalid UserTiming entry type');
    }
    return { name: strings[nameIndex], type: data?.type === undefined ? null : data.type as string,
      detailName: timing ? data.name as string : null, entryType: timing ? data.entryType as string : null, phase,
      startEpochMs: phase === 3 ? null : origin + start, endEpochMs: phase === 1 || phase === 3 ? origin + end : null };
  });
  return { version: 31, markers };
}

/** Measure intersection of two complete observed intervals, never completing partial GC/CC events implicitly. @param first Epoch-aligned observed interval. @param second Other observed interval. @returns Overlap milliseconds, including zero for touching/disjoint intervals. */
export function intervalOverlap(first: NativeMarker, second: NativeMarker): number {
  assert.ok(first.phase === 1 && second.phase === 1 && first.startEpochMs !== null && first.endEpochMs !== null
    && second.startEpochMs !== null && second.endEpochMs !== null, 'Overlap requires a complete interval');
  assert.ok(first.endEpochMs >= first.startEpochMs && second.endEpochMs >= second.startEpochMs, 'Backwards interval');
  return Math.max(0, Math.min(first.endEpochMs, second.endEpochMs) - Math.max(first.startEpochMs, second.startEpochMs));
}
