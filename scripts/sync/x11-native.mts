/** Shared bounded XTEST C ABI bridge. Callers validate their separate probe/journey policies before execution. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { X11KeyboardTarget } from './x11-keyboard.mts';
import { validateNativeKeyboardReport } from './x11-native-report.mts';
import type { NativeKeyboardReport } from './x11-native-report.mts';
export type { NativeKeyboardReport } from './x11-native-report.mts';

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
profile, focus_policy = sys.argv[3:5]
if profile not in ('probe', 'journey') or focus_policy not in ('assign', 'require'):
    raise RuntimeError('Unknown keyboard delivery policy')
if not re.fullmatch(r'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}', marker):
    raise RuntimeError('Expected unique native window marker')
allowed = set('abcdefghijklmnopqrstuvwxyz0123456789') | {'minus', 'space', 'Tab', 'Return', 'Escape', 'BackSpace', 'Delete', 'Home', 'End', 'Up', 'Down', 'Left', 'Right'}
if not isinstance(strokes, list) or not 1 <= len(strokes) <= (3 if profile == 'probe' else 48):
    raise RuntimeError('Unallowlisted keyboard sequence')
for stroke in strokes:
    key, modifiers = stroke['key'], stroke['modifiers']
    if profile == 'probe':
        valid = key in ('a', 'Tab', 'space') and modifiers == [] and focus_policy == 'assign'
    else:
        valid = key in allowed and (modifiers == [] or key == 'Tab' and modifiers == ['Shift_L'] or key in ('a', 'w') and modifiers == ['Control_L'])
    if not valid:
        raise RuntimeError('Unallowlisted keyboard key or modifiers')
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
pressed = []

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
    codes, focus_paths = [], []
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
    # Only initial setup may assign focus; later packets must observe existing native ownership.
    if focus_policy == 'assign':
        x.XRaiseWindow(display, owner)
        x.XSetInputFocus(display, owner, 2, 0)
        x.XSync(display, 0)
        time.sleep(0.08)
    for stroke in strokes:
        window, revert = c.c_ulong(), c.c_int()
        x.XGetInputFocus(display, c.byref(window), c.byref(revert))
        ancestry = []
        current = window.value
        while current > 1 and len(ancestry) < 16:
            ancestry.append(current)
            if current == owner:
                break
            root, parent, count = c.c_ulong(), c.c_ulong(), c.c_uint()
            children = c.POINTER(c.c_ulong)()
            queried = x.XQueryTree(display, current, c.byref(root), c.byref(parent), c.byref(children), c.byref(count))
            if children:
                x.XFree(c.cast(children, c.c_void_p))
            if not queried or parent.value == current:
                break
            current = parent.value
        if not ancestry or ancestry[-1] != owner:
            raise RuntimeError('Owned keyboard probe window lost native focus: ' + json.dumps({'expected': owner, 'actual': window.value, 'ancestors': ancestry}))
        focus_paths.append(ancestry)
        symbol = x.XStringToKeysym(stroke['key'].encode('ascii'))
        code = x.XKeysymToKeycode(display, symbol) if symbol else 0
        if not code:
            raise RuntimeError('Keyboard probe keysym has no native keycode')
        for modifier in stroke['modifiers']:
            modifier_code = x.XKeysymToKeycode(display, x.XStringToKeysym(modifier.encode('ascii')))
            if not modifier_code or not t.XTestFakeKeyEvent(display, modifier_code, 1, 0):
                raise RuntimeError('XTEST modifier press failed')
            pressed.append(modifier_code)
        pressed.append(code)
        if not t.XTestFakeKeyEvent(display, code, 1, 0):
            raise RuntimeError('XTEST key press failed')
        x.XSync(display, 0)
        time.sleep(0.04)
        if not t.XTestFakeKeyEvent(display, code, 0, 0):
            raise RuntimeError('XTEST key release failed')
        pressed.pop()
        while pressed:
            modifier_code = pressed[-1]
            if not t.XTestFakeKeyEvent(display, modifier_code, 0, 0):
                raise RuntimeError('XTEST modifier release failed')
            pressed.pop()
        x.XSync(display, 0)
        codes.append(code)
        time.sleep(0.08)
    print(json.dumps({'backend': 'XTEST', 'version': [major.value, minor.value], 'window': owner,
        'keycodes': codes, 'windowMarker': marker, 'focusAssigned': focus_policy == 'assign', 'focusPaths': focus_paths}))
finally:
    for code in reversed(pressed):
        t.XTestFakeKeyEvent(display, code, 0, 0)
    x.XSync(display, 0)
    x.XCloseDisplay(display)
`;


/** Execute validated delivery on one private display. @param target Owned native window. @param strokes Validated keys. @param profile Explicit allowlist. @param focus Initial setup or require actual focus. @returns Native ABI evidence, rejecting process/focus/report failures. */
export async function deliverNativeKeys(target: X11KeyboardTarget, strokes: readonly { key: string; modifiers: readonly string[] }[], profile: 'probe' | 'journey', focus: 'assign' | 'require'): Promise<NativeKeyboardReport> {
  const { stdout } = await run('/usr/bin/python3', ['-I', '-c', source, JSON.stringify(strokes), target.windowMarker, profile, focus], {
    env: { DISPLAY: target.display, XAUTHORITY: target.authority }, timeout: 10000,
    killSignal: 'SIGKILL', maxBuffer: 32768, encoding: 'utf8',
  });
  return validateNativeKeyboardReport(JSON.parse(stdout), target, strokes.length, focus);
}
