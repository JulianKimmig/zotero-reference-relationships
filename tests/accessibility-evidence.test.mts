/** Accessibility acceptance uses native names and alert events, including negative evidence that DOM markup alone cannot satisfy. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAccessiblePanel, validateAccessibleAlert } from './sync-controller/accessibility-evidence.sys.mts';

test('accessible panel preserves every expected control name and exposes roles for all visible controls', () => {
  assert.doesNotThrow(() => validateAccessiblePanel([{ key: 'note', name: 'Note (optional)', role: 'entry' },
    { key: 'save', name: 'Save relationship', role: 'pushbutton' }], { note: 'Note (optional)', save: 'Save relationship' }));
});

test('native accessible panels reject unnamed, missing, mislabeled and duplicate controls separately', () => {
  for (const controls of [[], [{ key: 'note', name: null, role: 'entry' }], [{ key: 'note', name: '', role: 'entry' }], [{ key: 'note', name: 'Wrong label', role: 'entry' }],
    [{ key: 'note', name: 'Note (optional)', role: '' }], [{ key: 'note', name: 'Note (optional)', role: 'entry' },
      { key: 'note', name: 'Note (optional)', role: 'entry' }]]) {
    assert.throws(() => validateAccessiblePanel(controls, { note: 'Note (optional)' }), /accessible/i);
  }
});

test('a native alert event carries the actual validation error, while text changes alone do not prove an alert', () => {
  const event = { type: 'alert', isNativeAlert: true, nativeRole: 'alert', alertText: 'Choose a target reference' };
  assert.doesNotThrow(() => validateAccessibleAlert([event], 'Choose a target reference'));
  for (const events of [[], [{ ...event, isNativeAlert: false }], [{ ...event, nativeRole: 'paragraph' }],
    [{ ...event, alertText: 'Different validation error' }]]) {
    assert.throws(() => validateAccessibleAlert(events, 'Choose a target reference'), /native accessible alert/i);
  }
});
