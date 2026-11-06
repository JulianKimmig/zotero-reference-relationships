/** Node-side native acceptance requires a real object report as well as exact process/profile/runtime identity. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateNativeJobResult } from '../scripts/sync/native-result.mts';

const client = { profile: '/test/profile', data: '/test/data' };

test('returns the actual object report after checking native identity and explicit success', () => {
  const report = { cycles: 3 };
  assert.equal(validateNativeJobResult({ ...client, ok: true, version: '10.0.7', report }, client), report);
});

for (const report of [null, undefined, false, 0, '', 'report']) test(`rejects success without an object report: ${String(report)}`, () => {
  assert.throws(() => validateNativeJobResult({ ...client, ok: true, version: '10.0.7', report }, client), /report/i);
});

for (const patch of [{ profile: '/wrong' }, { data: '/wrong' }, { version: '11' }, { ok: false, error: null }, { ok: 1 }]) {
  test(`rejects invalid native result identity or status: ${JSON.stringify(patch)}`, () => {
    assert.throws(() => validateNativeJobResult({ ...client, ok: true, version: '10.0.7', report: {}, ...patch }, client));
  });
}
