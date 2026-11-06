/** Validate untrusted XTEST evidence, including actual native focus ancestry for every delivered key. */
import assert from 'node:assert/strict';
import type { X11KeyboardTarget } from './x11-keyboard.mts';

/** The marked native window owns each actual focus window directly or through an observed descendant chain. */
export interface NativeKeyboardReport {
  backend: 'XTEST'; version: number[]; window: number; keycodes: number[]; windowMarker: string; focusAssigned: boolean; focusPaths: number[][];
}

/** Require identity, bounded physical keycodes and complete per-key ownership evidence. @param report Untrusted subprocess JSON. @param target Exact marked native client. @param count Requested keys. @param focus Explicit assignment/continuation policy. @returns Validated report or throws on unowned, incomplete or malformed native observations. */
export function validateNativeKeyboardReport(report: unknown, target: X11KeyboardTarget, count: number, focus: 'assign' | 'require'): NativeKeyboardReport {
  assert.ok(report && typeof report === 'object', 'Missing native keyboard report');
  assert.ok('backend' in report && report.backend === 'XTEST', 'Missing XTEST backend');
  assert.ok('version' in report && Array.isArray(report.version) && report.version.length === 2
    && report.version.every(Number.isInteger), 'Missing XTEST version');
  assert.ok('window' in report && typeof report.window === 'number' && Number.isSafeInteger(report.window) && report.window > 1, 'Missing focused native window');
  assert.ok('windowMarker' in report && report.windowMarker === target.windowMarker, 'Native keyboard window identity changed');
  assert.ok('focusAssigned' in report && report.focusAssigned === (focus === 'assign'), 'Native keyboard focus policy changed');
  assert.ok('keycodes' in report && Array.isArray(report.keycodes) && report.keycodes.length === count
    && report.keycodes.every(code => Number.isInteger(code) && code > 0 && code <= 255), 'Missing native keycodes');
  assert.ok('focusPaths' in report && Array.isArray(report.focusPaths) && report.focusPaths.length === count, 'Missing per-key native focus paths');
  for (const path of report.focusPaths as unknown[]) {
    assert.ok(Array.isArray(path) && path.length > 0 && path.length <= 16 && new Set(path).size === path.length
      && path.every(id => Number.isSafeInteger(id) && id > 1) && path.at(-1) === report.window, 'Native focus path is not owned by the marked window');
  }
  return report as NativeKeyboardReport;
}
