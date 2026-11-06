/** Bounded form-navigation OS keys, preserving native focus after the first journey packet. */
import assert from 'node:assert/strict';
import { validateX11KeyboardInput } from './x11-keyboard.mts';
import { deliverNativeKeys } from './x11-native.mts';
import type { X11KeyboardTarget } from './x11-keyboard.mts';
import type { NativeKeyboardReport } from './x11-native.mts';
import type { JourneyStroke, JourneyFocus } from '../../tests/sync-controller/keyboard-contracts.mts';
export type { JourneyStroke, JourneyFocus } from '../../tests/sync-controller/keyboard-contracts.mts';
const keys = new Set(['minus', 'space', 'Tab', 'Return', 'Escape', 'BackSpace', 'Delete', 'Home', 'End', 'Up', 'Down', 'Left', 'Right']);

/** Validate untrusted keys and native ownership before starting any subprocess. @param target Private owned window. @param strokes One to48 allowlisted form keys. @param focus Explicit focus policy. @returns Narrows strokes or throws. */
export function validateJourneyKeyboardInput(target: unknown, strokes: unknown, focus: unknown): asserts strokes is JourneyStroke[] {
  validateX11KeyboardInput(target, [{ key: 'a', modifiers: [] }]);
  assert.ok(focus === 'assign' || focus === 'require', 'Unknown journey focus policy');
  assert.ok(Array.isArray(strokes) && strokes.length > 0 && strokes.length <= 48, 'Journey key sequence must contain one to48 keys');
  for (const stroke of strokes as unknown[]) {
    assert.ok(stroke && typeof stroke === 'object' && 'key' in stroke && typeof stroke.key === 'string'
      && (/^[a-z0-9]$/.test(stroke.key) || keys.has(stroke.key)), 'Unallowlisted journey key');
    assert.ok('modifiers' in stroke && Array.isArray(stroke.modifiers), 'Missing journey modifiers');
    assert.ok(stroke.modifiers.length === 0 || stroke.modifiers.length === 1
      && (stroke.key === 'Tab' && stroke.modifiers[0] === 'Shift_L' || ['a', 'w'].includes(stroke.key) && stroke.modifiers[0] === 'Control_L'),
    'Unallowlisted journey key modifiers');
  }
}

/** Deliver actual XTEST key transitions to the marked window without repairing focus during a journey. @param target Owned window and display. @param strokes Validated form keys. @param focus Explicit initial/continuation policy. @returns Real extension/window/keycode evidence. */
export async function sendX11JourneyKeys(target: X11KeyboardTarget, strokes: readonly JourneyStroke[], focus: JourneyFocus): Promise<NativeKeyboardReport> {
  validateJourneyKeyboardInput(target, strokes, focus);
  return deliverNativeKeys(target, strokes, 'journey', focus);
}
