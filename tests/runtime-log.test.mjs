/** Regression tests for plugin shutdown errors emitted by the real native runtime. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRuntimeLog } from '../scripts/session.mjs';

test('accepts native shutdown without the plugin runtime race', () => {
  assert.doesNotThrow(() => validateRuntimeLog('Database closed\n'));
});

test('rejects the actual late-unload TypeError observed after app shutdown', () => {
  const log = 'Error running bootstrap method onMainWindowUnload\n'
    + 'TypeError: can\'t access property "removeWindow", relationshipRuntime is undefined\n';
  assert.throws(() => validateRuntimeLog(log), /shutdown|late.*unload/i);
});

test('rejects the race even after other shutdown diagnostics', () => {
  const log = 'Database closed\nUnregistering notifier observer\n'
    + 'zotero(1): TypeError: relationshipRuntime is undefined\n';
  assert.throws(() => validateRuntimeLog(log), /shutdown|late.*unload/i);
});

test('does not reject unrelated platform messages', () => {
  assert.doesNotThrow(() => validateRuntimeLog('TypeError: unrelated platform diagnostic\n'));
});
