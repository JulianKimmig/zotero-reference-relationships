/** Bounded XTEST delivery to an owned anonymous client's private Xvfb display, without reading authentication contents. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Non-secret native environment paths obtained from this client's exact ready receipt. */
export interface X11KeyboardTarget { display: string; authority: string; windowMarker: string }
/** The delivery probe permits only three unmodified keys, never arbitrary shortcuts or text. */
export interface X11KeyStroke { key: 'a' | 'Tab' | 'space'; modifiers: readonly never[] }
/** Actual server extension, focused X11 window and resolved native keycodes. */
export interface X11KeyboardReport { backend: 'XTEST'; version: number[]; window: number; keycodes: number[]; windowMarker: string; focusAssigned: true }

const run = promisify(execFile);
const source = String.raw`
"""Deliver an allowlisted bounded key sequence through the actual XTEST C ABI."""
import ctypes as c
import json
import os
import re
import sys
import time

if not re.fullmatch(r':[1-9][0-9]{0,4}', os.environ['DISPLAY']):
    raise RuntimeError('Expected private DISPLAY')
if not re.fullmatch(r'/tmp/xvfb-run\.[A-Za-z0-9]+/Xauthority', os.environ['XAUTHORITY']):
    raise RuntimeError('Expected owned XAUTHORITY path')
strokes = json.loads(sys.argv[1])
marker = sys.argv[2]
if not re.fullmatch(r'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}', marker):
    raise RuntimeError('Expected unique native window marker')
if not 1 <= len(strokes) <= 3 or any(s['key'] not in ('a', 'Tab', 'space') or s['modifiers'] != [] for s in strokes):
    raise RuntimeError('Unallowlisted keyboard sequence')
x = c.CDLL('libX11.so.6')
t = c.CDLL('libXtst.so.6')
x.XOpenDisplay.argtypes = [c.c_char_p]
x.XOpenDisplay.restype = c.c_void_p
x.XStringToKeysym.argtypes = [c.c_char_p]
x.XStringToKeysym.restype = c.c_ulong
x.XKeysymToKeycode.argtypes = [c.c_void_p, c.c_ulong]
x.XKeysymToKeycode.restype = c.c_ubyte
x.XGetInputFocus.argtypes = [c.c_void_p, c.POINTER(c.c_ulong), c.POINTER(c.c_int)]
x.XGetInputFocus.restype = c.c_int
x.XDefaultRootWindow.argtypes = [c.c_void_p]
x.XDefaultRootWindow.restype = c.c_ulong
x.XQueryTree.argtypes = [c.c_void_p, c.c_ulong, c.POINTER(c.c_ulong), c.POINTER(c.c_ulong), c.POINTER(c.POINTER(c.c_ulong)), c.POINTER(c.c_uint)]
x.XQueryTree.restype = c.c_int
x.XFetchName.argtypes = [c.c_void_p, c.c_ulong, c.POINTER(c.c_char_p)]
x.XFetchName.restype = c.c_int
x.XFree.argtypes = [c.c_void_p]
x.XFree.restype = c.c_int
x.XRaiseWindow.argtypes = [c.c_void_p, c.c_ulong]
x.XRaiseWindow.restype = c.c_int
x.XSetInputFocus.argtypes = [c.c_void_p, c.c_ulong, c.c_int, c.c_ulong]
x.XSetInputFocus.restype = c.c_int
x.XSync.argtypes = [c.c_void_p, c.c_int]
x.XSync.restype = c.c_int
x.XCloseDisplay.argtypes = [c.c_void_p]
x.XCloseDisplay.restype = c.c_int
t.XTestQueryExtension.argtypes = [c.c_void_p] + [c.POINTER(c.c_int)] * 4
t.XTestQueryExtension.restype = c.c_int
t.XTestFakeKeyEvent.argtypes = [c.c_void_p, c.c_uint, c.c_int, c.c_ulong]
t.XTestFakeKeyEvent.restype = c.c_int
display = x.XOpenDisplay(os.environ['DISPLAY'].encode('ascii'))
if not display:
    raise RuntimeError('Owned keyboard probe display unavailable')
pressed = None

def probe_windows():
    """Return exact marker-owned X11 windows, traversing at most 10000 native nodes."""
    pending = [x.XDefaultRootWindow(display)]
    found = []
    visited = set()
    tag = ('RR keyboard probe ' + marker).encode('ascii')
    while pending:
        window = pending.pop()
        if window in visited:
            continue
        visited.add(window)
        if len(visited) > 10000:
            raise RuntimeError('Native keyboard window discovery exceeded its bound')
        name = c.c_char_p()
        x.XFetchName(display, window, c.byref(name))
        if name.value is not None:
            try:
                if tag in name.value:
                    found.append(window)
            finally:
                x.XFree(c.cast(name, c.c_void_p))
        root, parent, count = c.c_ulong(), c.c_ulong(), c.c_uint()
        children = c.POINTER(c.c_ulong)()
        if not x.XQueryTree(display, window, c.byref(root), c.byref(parent), c.byref(children), c.byref(count)):
            raise RuntimeError('Native keyboard window discovery failed')
        try:
            pending.extend(children[index] for index in range(count.value))
        finally:
            if children:
                x.XFree(c.cast(children, c.c_void_p))
    return found

try:
    event, error, major, minor = (c.c_int() for _ in range(4))
    if not t.XTestQueryExtension(display, c.byref(event), c.byref(error), c.byref(major), c.byref(minor)):
        raise RuntimeError('XTEST extension unavailable on owned display')
    codes = []
    deadline = time.monotonic() + 2
    while True:
        matches = probe_windows()
        if len(matches) == 1:
            break
        if len(matches) > 1:
            raise RuntimeError('Native keyboard window marker is ambiguous')
        if time.monotonic() >= deadline:
            raise RuntimeError('Native keyboard window marker was not found')
        time.sleep(0.05)
    owner = matches[0]
    # Explicit backend setup focuses only the uniquely bound probe window.
    x.XRaiseWindow(display, owner)
    x.XSetInputFocus(display, owner, 2, 0)
    x.XSync(display, 0)
    time.sleep(0.08)
    for stroke in strokes:
        window, revert = c.c_ulong(), c.c_int()
        x.XGetInputFocus(display, c.byref(window), c.byref(revert))
        if window.value <= 1 or window.value != owner:
            raise RuntimeError('Owned keyboard probe window lost native focus')
        symbol = x.XStringToKeysym(stroke['key'].encode('ascii'))
        code = x.XKeysymToKeycode(display, symbol) if symbol else 0
        if not code:
            raise RuntimeError('Keyboard probe keysym has no native keycode')
        pressed = code
        if not t.XTestFakeKeyEvent(display, code, 1, 0):
            raise RuntimeError('XTEST key press failed')
        x.XSync(display, 0)
        time.sleep(0.04)
        if not t.XTestFakeKeyEvent(display, code, 0, 0):
            raise RuntimeError('XTEST key release failed')
        pressed = None
        x.XSync(display, 0)
        codes.append(code)
        time.sleep(0.08)
    print(json.dumps({'backend': 'XTEST', 'version': [major.value, minor.value], 'window': owner,
        'keycodes': codes, 'windowMarker': marker, 'focusAssigned': True}))
finally:
    if pressed is not None:
        t.XTestFakeKeyEvent(display, pressed, 0, 0)
        x.XSync(display, 0)
    x.XCloseDisplay(display)
`;

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
  const { stdout } = await run('/usr/bin/python3', ['-I', '-c', source, JSON.stringify(strokes), target.windowMarker], {
    env: { DISPLAY: target.display, XAUTHORITY: target.authority }, timeout: 10000,
    killSignal: 'SIGKILL', maxBuffer: 32768, encoding: 'utf8',
  });
  const report: X11KeyboardReport = JSON.parse(stdout);
  assert.equal(report.backend, 'XTEST');
  assert.ok(Array.isArray(report.version) && report.version.length === 2 && report.version.every(Number.isInteger), 'Missing XTEST version');
  assert.ok(Number.isSafeInteger(report.window) && report.window > 1, 'Missing focused native window');
  assert.equal(report.windowMarker, target.windowMarker, 'Native keyboard window identity changed');
  assert.equal(report.focusAssigned, true, 'Native keyboard focus was not explicitly assigned');
  assert.ok(Array.isArray(report.keycodes) && report.keycodes.length === strokes.length
    && report.keycodes.every(code => Number.isInteger(code) && code > 0 && code <= 255), 'Missing native keycodes');
  return report;
}
