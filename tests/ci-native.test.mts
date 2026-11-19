/** CI admission and proof validation exercise public behavior without launching native processes. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNativeArguments, requireBaseline, validatePhase, requireUpgrade } from '../scripts/ci/contract.mts';

test('accepts dynamic artifact paths and optional predecessor', () => {
  assert.deepEqual(parseNativeArguments(['--xpi', '/new.xpi'], { ZOTERO_BIN: '/zotero' }),
    { xpi: '/new.xpi', executable: '/zotero' });
  assert.equal(parseNativeArguments(['--xpi', '/new.xpi', '--previous', '/old.xpi'], { ZOTERO_BIN: '/zotero' }).previousXPI, '/old.xpi');
});

test('rejects ambiguous paths, options and runtime selection', () => {
  for (const args of [[], ['--xpi', 'relative'], ['--xpi', '/same', '--previous', '/a/../same'],
    ['--xpi', '/x', '--other', '/y'], ['--previous', '/y', '--xpi', '/x']]) {
    assert.throws(() => parseNativeArguments(args, { ZOTERO_BIN: '/zotero' }));
  }
  for (const bin of [undefined, '', 'zotero']) assert.throws(() => parseNativeArguments(['--xpi', '/x'], { ZOTERO_BIN: bin }));
});

test('only a plugin without a historical baseline may omit upgrade', () => {
  assert.throws(() => requireBaseline(undefined, '0.1.0'), /baseline/);
  assert.doesNotThrow(() => requireBaseline('/old', '0.1.0'));
  assert.doesNotThrow(() => requireBaseline(undefined, null));
});

test('native upgrade admission requires a strictly older stable predecessor', () => {
  assert.doesNotThrow(() => requireUpgrade('0.2.9', '0.10.0'));
  assert.doesNotThrow(() => requireUpgrade('0.1.0', '0.1.1'));
  for (const [previous, current] of [['0.1.1', '0.1.1'], ['1.0.0', '0.9.9'], ['0.01.0', '0.2.0'], ['0.1.0-beta', '0.1.0']]) {
    assert.throws(() => requireUpgrade(previous, current));
  }
});

test('phase validation binds native version and every lifecycle flag', () => {
  const report = { currentVersion: '0.2.4', preferenceRegistrationCount: 1, permanentInstall: true, nativeRestart: true };
  assert.doesNotThrow(() => validatePhase(report, '0.2.4', ['permanentInstall', 'nativeRestart']));
  assert.throws(() => validatePhase(report, '0.1.0', ['nativeRestart']));
  assert.throws(() => validatePhase({ ...report, nativeRestart: false }, '0.2.4', ['nativeRestart']));
  assert.throws(() => validatePhase({ ...report, preferenceRegistrationCount: 2 }, '0.2.4', []));
});

test('CI controller rejects missing versions before accessing native resources', async () => {
  const { ciRelease } = await import('./sync-controller/ci-release.sys.mts');
  const job = { action: 'ci-release:roundtrip', groups: { writable: 1, restricted: 2 }, marker: 'CI', currentVersion: '' };
  // External platform is deliberately absent: invalid jobs must fail before any API access.
  await assert.rejects(ciRelease(job, {} as import('./sync-controller/native-api.mts').NativeAPI), /current artifact version/);
});
