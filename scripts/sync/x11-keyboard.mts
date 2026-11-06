/** Bounded XTEST delivery to an owned anonymous client's private Xvfb display, without reading authentication contents. */
import assert from 'node:assert/strict';
import { deliverNativeKeys } from './x11-native.mts';

/** Non-secret native environment paths obtained from this client's exact ready receipt. */
export interface X11KeyboardTarget { display: string; authority: string; windowMarker: string }
/** The delivery probe permits only three unmodified keys, never arbitrary shortcuts or text. */
export interface X11KeyStroke { key: 'a' | 'Tab' | 'space'; modifiers: readonly never[] }
/** Actual server extension, focused X11 window and resolved native keycodes. */
export interface X11KeyboardReport { backend: 'XTEST'; version: number[]; window: number; keycodes: number[]; windowMarker: string; focusAssigned: true }


/** Validate all untrusted receipt/key data before starting any subprocess. @param target Exact owned receipt paths. @param strokes Untrusted caller sequence. @returns Narrows strokes to the fixed unmodified allowlist or throws. */
export function validateX11KeyboardInput(target: unknown, strokes: unknown): asserts strokes is X11KeyStroke[] {
  assert.ok(target && typeof target === 'object', 'Expected owned X11 keyboard target');
  assert.ok('display' in target && typeof target.display === 'string' && /^:[1-9][0-9]{0,4}$/.test(target.display)
    && target.display.trim() === target.display, 'Expected private numeric DISPLAY');
  assert.ok('authority' in target && typeof target.authority === 'string' && /^\/tmp\/xvfb-run\.[A-Za-z0-9]+\/Xauthority$/.test(target.authority)
    && target.authority.trim() === target.authority, 'Expected owned xvfb-run XAUTHORITY path');
  assert.ok('windowMarker' in target && typeof target.windowMarker === 'string'
    && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(target.windowMarker), 'Expected unique native window marker');
  assert.ok(Array.isArray(strokes) && strokes.length > 0 && strokes.length <= 3, 'Keyboard sequence must contain one to three keys');
  for (const stroke of strokes as unknown[]) {
    assert.ok(stroke && typeof stroke === 'object' && 'key' in stroke && typeof stroke.key === 'string'
      && ['a', 'Tab', 'space'].includes(stroke.key), 'Unallowlisted keyboard key');
    assert.ok('modifiers' in stroke && Array.isArray(stroke.modifiers) && stroke.modifiers.length === 0, 'Keyboard probe permits no modifiers');
  }
}

/** Send real OS key transitions with bounded Python execution and only two explicit environment paths. @param target Validated private display/authority path, never authority contents. @param strokes Fixed key sequence. @returns Actual XTEST server evidence; rejects on missing libraries, focus, process or ABI failures. */
export async function sendX11Keys(target: X11KeyboardTarget, strokes: readonly X11KeyStroke[]): Promise<X11KeyboardReport> {
  validateX11KeyboardInput(target, strokes);
  const report = await deliverNativeKeys(target, strokes, 'probe', 'assign');
  assert.equal(report.focusAssigned, true);
  return { ...report, focusAssigned: true };
}
