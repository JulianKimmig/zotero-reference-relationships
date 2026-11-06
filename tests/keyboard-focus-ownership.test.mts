/** Native focus evidence may identify a GTK child of the marked client, but never a sibling, ancestor or unowned window. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateNativeKeyboardReport } from '../scripts/sync/x11-native-report.mts';

const target = { display: ':123', authority: '/tmp/xvfb-run.A1b2C3/Xauthority', windowMarker: '123e4567-e89b-42d3-a456-426614174000' };
const report = { backend: 'XTEST', version: [2, 2], window: 420, keycodes: [38], windowMarker: target.windowMarker,
  focusAssigned: false, focusPaths: [[421, 420]] };

test('native focus on the marked top-level or its observed GTK descendants is owned without reassignment', () => {
  for (const path of [[420], [421, 420], [422, 421, 420]]) {
    const evidence = { ...report, focusPaths: [path] };
    assert.deepEqual(validateNativeKeyboardReport(evidence, target, 1, 'require'), evidence);
  }
});

test('native focus evidence rejects sibling, ancestor, root, missing and cyclic ownership paths', () => {
  for (const focusPaths of [[], [[421]], [[421, 543]], [[543]], [[0]], [[1]], [[421, 421, 420]], [[421, 420, 543]],
    [[421, '420']], [Array.from({ length: 17 }, (_, index) => 436 - index)], null]) {
    assert.throws(() => validateNativeKeyboardReport({ ...report, focusPaths }, target, 1, 'require'), /focus/i);
  }
});

test('every delivered key requires bounded focus evidence and exact native report identity', () => {
  for (const changed of [{ focusPaths: [[420], [420]] }, { windowMarker: 'different' }, { focusAssigned: true },
    { keycodes: [] }, { version: [2] }, { backend: 'synthetic' }, { window: 0 }]) {
    assert.throws(() => validateNativeKeyboardReport({ ...report, ...changed }, target, 1, 'require'));
  }
  assert.doesNotThrow(() => validateNativeKeyboardReport({ ...report, focusAssigned: true }, target, 1, 'assign'));
});
