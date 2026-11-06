/** Send real test keystrokes only to the private X11 display reported by an owned anonymous Zotero fixture. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const keys = `
import ctypes as c
import sys
x = c.CDLL('libX11.so.6')
t = c.CDLL('libXtst.so.6')
x.XOpenDisplay.argtypes = [c.c_char_p]
x.XOpenDisplay.restype = c.c_void_p
x.XStringToKeysym.argtypes = [c.c_char_p]
x.XStringToKeysym.restype = c.c_ulong
x.XKeysymToKeycode.argtypes = [c.c_void_p, c.c_ulong]
x.XKeysymToKeycode.restype = c.c_ubyte
x.XFlush.argtypes = [c.c_void_p]
x.XCloseDisplay.argtypes = [c.c_void_p]
t.XTestFakeKeyEvent.argtypes = [c.c_void_p, c.c_uint, c.c_int, c.c_ulong]
display = x.XOpenDisplay(sys.argv[1].encode())
if not display:
    raise RuntimeError('Owned fixture X11 display is unavailable')
def key(name, down):
    """Send one actual key transition to the owned display; name is a fixed keysym."""
    code = x.XKeysymToKeycode(display, x.XStringToKeysym(name.encode()))
    if not code or not t.XTestFakeKeyEvent(display, code, int(down), 0):
        raise RuntimeError('Native test key injection failed')
def press(name):
    """Send one complete key press and release on the private fixture display."""
    key(name, True)
    key(name, False)
try:
    if sys.argv[2] == 'cancel':
        press('Escape')
    elif sys.argv[2] == 'location':
        key('Control_L', True)
        press('l')
        key('Control_L', False)
    elif sys.argv[2] == 'path':
        names = {'/': 'slash', '.': 'period', '-': 'minus'}
        for character in sys.argv[3]:
            press(names.get(character, character))
        press('Return')
    elif sys.argv[2] == 'accept':
        press('Return')
    else:
        raise RuntimeError('Unknown native test key sequence')
    x.XFlush(display)
finally:
    x.XCloseDisplay(display)
`;

/** Require the client's actual import dialog to be present before sending cancellation or path-selection keystrokes. @param {string} display Private xvfb display from this job's ready receipt. @returns {Promise<boolean>} Whether the actual named native window is visible in its X11 tree. */
export async function pickerVisible(display: string, authority: string): Promise<boolean> {
  assert.match(display, /^:\d+(?:\.\d+)?$/);
  assert.match(authority, /^\/tmp\/xvfb-run\.[A-Za-z0-9]+\/Xauthority$/);
  const { stdout } = await run('xwininfo', ['-display', display, '-root', '-tree'], { env: { ...process.env, XAUTHORITY: authority } });
  return stdout.includes('Import Reference Relationships');
}

/** Inject only fixed test actions and a validated synthetic ASCII path through the existing X11 test library. @param {string} display Owned private display. @param {string} action cancel/location/path/accept. @param {string} path Synthetic lowercase temporary path for selection. @returns {Promise<void>} Actual X11 call completion. */
export async function pickerKeys(display: string, authority: string, action: 'cancel' | 'location' | 'path' | 'accept', path = ''): Promise<void> {
  assert.match(display, /^:\d+(?:\.\d+)?$/);
  assert.match(authority, /^\/tmp\/xvfb-run\.[A-Za-z0-9]+\/Xauthority$/);
  if (action === 'path') assert.match(path, /^\/tmp\/rr-native-picker-[a-z0-9-]+\.json$/);
  await run('python3', ['-c', keys, display, action, path], { env: { ...process.env, XAUTHORITY: authority } });
}
