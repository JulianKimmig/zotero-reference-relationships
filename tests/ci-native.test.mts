/** CI admission and proof validation exercise public behavior without launching native processes. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNativeArguments, requireBaseline, validatePhase, requireUpgrade } from '../scripts/ci/contract.mts';

test('accepts dynamic artifact paths and optional predecessor', () => {
  assert.deepEqual(parseNativeArguments(['--xpi', '/new.xpi'], { ZOTERO_BIN: '/zotero', ZOTERO_VERSION: '10.0.8' }),
    { xpi: '/new.xpi', executable: '/zotero', expectedVersion: '10.0.8' });
  assert.equal(parseNativeArguments(['--xpi', '/new.xpi', '--previous', '/old.xpi'], { ZOTERO_BIN: '/zotero', ZOTERO_VERSION: '10.0.8' }).previousXPI, '/old.xpi');
});

test('rejects ambiguous paths, options and runtime selection', () => {
  for (const args of [[], ['--xpi', 'relative'], ['--xpi', '/same', '--previous', '/a/../same'],
    ['--xpi', '/x', '--other', '/y'], ['--previous', '/y', '--xpi', '/x']]) {
    assert.throws(() => parseNativeArguments(args, { ZOTERO_BIN: '/zotero', ZOTERO_VERSION: '10.0.8' }));
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

test('accepts deterministic receipt and predecessor host paths with spaces', () => {
  const result = parseNativeArguments(['--xpi', '/new build/a.xpi', '--previous', '/old/a.xpi',
    '--previous-runtime', '/old host/zotero', '--result', '/evidence/result.json'],
  { ZOTERO_BIN: '/new host/zotero', ZOTERO_VERSION: '10.0.8', ZOTERO_PREVIOUS_VERSION: '10.0.7' });
  assert.equal(result.result, '/evidence/result.json');
  assert.equal(result.previousRuntime, '/old host/zotero');
  assert.equal(result.previousExpectedVersion, '10.0.7');
});
test('rejects unpaired predecessor host, duplicate flags and absent expected version', () => {
  for (const args of [['--xpi', '/x', '--previous-runtime', '/old'],
    ['--xpi', '/x', '--result', '/r', '--result', '/r2']]) {
    assert.throws(() => parseNativeArguments(args, { ZOTERO_BIN: '/z', ZOTERO_VERSION: '10.0.8' }));
  }
  assert.throws(() => parseNativeArguments(['--xpi', '/x'], { ZOTERO_BIN: '/z' }), /ZOTERO_VERSION/);
});

test('split-host migration and seed reject incomplete fixture inputs before native access', async () => {
  const { ciRelease } = await import('./sync-controller/ci-release.sys.mts');
  const api = {} as import('./sync-controller/native-api.mts').NativeAPI;
  const job = { groups: { writable: 1, restricted: 2 }, marker: 'CI', currentVersion: '0.2.0' };
  await assert.rejects(ciRelease({ ...job, action: 'ci-release:seed' }, api), /seed.*predecessor/);
  await assert.rejects(ciRelease({ ...job, action: 'ci-release:migrate' }, api), /migration.*fixture/);
});

test('installed phase admission rejects missing or substituted native installed digests', async () => {
  const { validateInstalledHash } = await import('../scripts/ci/contract.mts');
  const expected = 'a'.repeat(64);
  assert.doesNotThrow(() => validateInstalledHash({ installedSHA256: expected }, expected));
  for (const report of [{}, { installedSHA256: 'b'.repeat(64) }, { installedSHA256: true }]) {
    assert.throws(() => validateInstalledHash(report, expected), /installed/);
  }
});
