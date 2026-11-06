/** Native window identity must be bound to the exact probe before assigning X-server focus or sending keys. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateKeyboardReady } from '../scripts/sync/keyboard-probe.mts';
import { validateX11KeyboardInput } from '../scripts/sync/x11-keyboard.mts';

const marker = '123e4567-e89b-42d3-a456-426614174000';
const target = { display: ':123', authority: '/tmp/xvfb-run.A1b2C3/Xauthority', windowMarker: marker };

test('ready receipt binds the OS window marker to the unique expected native job', () => {
  const expected = { data: '/tmp/rr-owned/data', marker };
  assert.deepEqual(validateKeyboardReady({ ...target, ...expected, action: 'quality:keyboard-probe', state: 'ready' }, expected), target);
});

for (const windowMarker of [undefined, '', 'another-window', `${marker}\n`, '123e4567-e89b-42d3-a456-42661417400g']) {
  test(`OS target rejects absent or malformed unique marker ${JSON.stringify(windowMarker)} before subprocess work`, () => {
    assert.throws(() => validateX11KeyboardInput({ ...target, windowMarker }, [{ key: 'a', modifiers: [] }]), /window marker/i);
  });
}

test('an extra receipt window marker cannot redirect the sender to another native window', () => {
  const expected = { data: '/tmp/rr-owned/data', marker };
  const result = validateKeyboardReady({ display: target.display, authority: target.authority,
    windowMarker: '00000000-0000-4000-8000-000000000001', ...expected, action: 'quality:keyboard-probe', state: 'ready' }, expected);
  assert.deepEqual(result, target);
});
