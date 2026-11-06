/** Exact file-exchange identity and ordinal guards for one fresh native keyboard journey. */
import assert from 'node:assert/strict';
import type { X11KeyboardTarget } from './x11-keyboard.mts';
import { validateJourneyKeyboardInput } from './x11-journey.mts';
import type { JourneyStroke, JourneyFocus } from './x11-journey.mts';

/** The next request belongs to exactly one job and data directory. */
export interface JourneyIdentity { marker: string; data: string; step: number }

/** Validate a parsed untrusted request before delivering keys. @param packet Own-file JSON. @param expected Current job/data/ordinal. @returns Validated window, keys and initial/continuation policy; rejects stale or cross-client packets. */
export function validateJourneyRequest(packet: unknown, expected: JourneyIdentity): { target: X11KeyboardTarget; strokes: JourneyStroke[]; focus: JourneyFocus } {
  assert.ok(packet && typeof packet === 'object' && !Array.isArray(packet), 'Missing journey ready packet');
  assert.ok('data' in packet && packet.data === expected.data, 'Journey data isolation mismatch');
  assert.ok('marker' in packet && packet.marker === expected.marker, 'Journey job marker mismatch');
  assert.ok('step' in packet && packet.step === expected.step, 'Journey request ordinal mismatch');
  assert.ok('action' in packet && packet.action === 'quality:keyboard-journey', 'Journey action mismatch');
  assert.ok('state' in packet && packet.state === 'ready', 'Journey request is not ready');
  assert.ok('focus' in packet && packet.focus === (expected.step === 0 ? 'assign' : 'require'), 'Journey focus policy mismatch');
  assert.ok('display' in packet && typeof packet.display === 'string' && 'authority' in packet && typeof packet.authority === 'string'
    && 'windowMarker' in packet && typeof packet.windowMarker === 'string', 'Missing journey native window identity');
  const target = { display: packet.display, authority: packet.authority, windowMarker: packet.windowMarker };
  assert.ok('strokes' in packet, 'Missing journey key sequence');
  validateJourneyKeyboardInput(target, packet.strokes, packet.focus);
  return { target, strokes: packet.strokes, focus: expected.step === 0 ? 'assign' : 'require' };
}
