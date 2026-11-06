/** Behavioral boundaries for real OS keyboard journeys; invalid packets must fail before any subprocess starts. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateJourneyKeyboardInput } from '../scripts/sync/x11-journey.mts';
import { validateJourneyRequest } from '../scripts/sync/keyboard-exchange.mts';

const marker = '123e4567-e89b-42d3-a456-426614174000';
const target = { display: ':123', authority: '/tmp/xvfb-run.A1b2C3/Xauthority', windowMarker: marker };
const expected = { marker, data: '/tmp/owned/data', step: 1 };
const packet = { ...target, ...expected, action: 'quality:keyboard-journey', state: 'ready', focus: 'require',
  strokes: [{ key: 'Tab', modifiers: ['Shift_L'] }, { key: 'a', modifiers: ['Control_L'] }, { key: 'Return', modifiers: [] }] };

test('journey permits bounded form navigation, lowercase text and explicit initial focus assignment', () => {
  for (const focus of ['assign', 'require']) {
    assert.doesNotThrow(() => validateJourneyKeyboardInput(target, packet.strokes, focus));
    for (const key of ['z', '0', 'minus', 'space', 'Escape', 'BackSpace', 'Home', 'End', 'Down', 'Up', 'Left', 'Right', 'Delete']) {
      assert.doesNotThrow(() => validateJourneyKeyboardInput(target, [{ key, modifiers: [] }], focus));
    }
  }
});

test('journey rejects arbitrary shortcuts, repeated modifiers, unsupported keys and unbounded delivery', () => {
  for (const strokes of [[], Array.from({ length: 49 }, () => ({ key: 'a', modifiers: [] })),
    [{ key: 'F4', modifiers: ['Alt_L'] }], [{ key: 'q', modifiers: ['Control_L'] }],
    [{ key: 'a', modifiers: ['Shift_L'] }], [{ key: 'Tab', modifiers: ['Shift_L', 'Shift_L'] }],
    [{ key: 'a', modifiers: ['Control_L', 'Shift_L'] }], [{ key: 'A', modifiers: [] }],
    [{ key: 'Return', modifiers: ['Control_L'] }], [{ key: 'a' }], null]) {
    assert.throws(() => validateJourneyKeyboardInput(target, strokes, 'require'), /key|modifier|sequence/i);
  }
  for (const focus of [undefined, '', 'auto', true]) assert.throws(() => validateJourneyKeyboardInput(target, packet.strokes, focus), /focus/i);
});

test('journey retains private display, authority and native window identity validation', () => {
  for (const changed of [{ display: ':0' }, { authority: '/home/user/.Xauthority' }, { windowMarker: 'unowned' }]) {
    assert.throws(() => validateJourneyKeyboardInput({ ...target, ...changed }, packet.strokes, 'require'));
  }
});

test('exchange binds every delivery to the current job, data directory and next ordinal', () => {
  assert.deepEqual(validateJourneyRequest(packet, expected), { target, focus: 'require', strokes: packet.strokes });
  for (const changed of [{ data: '/tmp/other/data' }, { marker: 'stale' }, { step: 0 }, { step: 2 },
    { step: '1' }, { action: 'quality:keyboard-probe' }, { state: 'done' }, { focus: 'assign' }]) {
    assert.throws(() => validateJourneyRequest({ ...packet, ...changed }, expected), /isolation|marker|ordinal|action|ready|focus/i);
  }
});

test('only the first journey packet can assign native focus; later window transitions must already own focus', () => {
  const first = { ...packet, step: 0, focus: 'assign' };
  assert.equal(validateJourneyRequest(first, { ...expected, step: 0 }).focus, 'assign');
  assert.throws(() => validateJourneyRequest({ ...first, focus: 'require' }, { ...expected, step: 0 }), /focus/i);
  const dialog = { ...packet, windowMarker: '00000000-0000-4000-8000-000000000001' };
  assert.equal(validateJourneyRequest(dialog, expected).target.windowMarker, dialog.windowMarker);
});

test('journey permits the native close-window shortcut for returning from official preferences', () => {
  assert.doesNotThrow(() => validateJourneyKeyboardInput(target, [{ key: 'w', modifiers: ['Control_L'] }], 'require'));
});
