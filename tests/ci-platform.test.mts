/** Exercise portable native command selection, observed envelopes and owned process termination. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, evidenceName, runProcess } from '../scripts/ci/platform.mts';
import { validateEnvelope } from '../scripts/ci/envelope.mts';

test('selects native platform launchers with literal space-containing paths', () => {
  const client = { profile: '/my profile', data: '/my data' };
  for (const platform of ['win32', 'darwin'] as const) {
    assert.deepEqual(command('/my host/zotero', client, platform), {
      executable: '/my host/zotero', args: ['-no-remote', '-profile', client.profile, '-datadir', client.data],
    });
  }
  assert.equal(command('/host', client, 'linux').executable, 'xvfb-run');
  assert.throws(() => command('/host', client, 'freebsd'));
  assert.equal(evidenceName('release', 'ci-release:roundtrip'), 'release-ci-release-roundtrip.json');
});
test('binds observed host version and profile; accepts two component normalization only', () => {
  const client = { profile: '/p', data: '/d' };
  const result = { ok: true, ...client, version: '10.1', report: { native: true } };
  assert.equal(validateEnvelope(result, client, '10.1.0').version, '10.1');
  for (const patch of [{ version: '10.0.7' }, { profile: '/other' }, { ok: false }, { report: null }]) {
    assert.throws(() => validateEnvelope({ ...result, ...patch }, client, '10.1.0'));
  }
});
test('captures real child output, rejects nonzero exit and terminates owned timeout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rr process '));
  await runProcess({ executable: process.execPath, args: ['-e', 'console.log("real child")'] }, join(root, 'ok.log'), 2000);
  await assert.rejects(runProcess({ executable: process.execPath, args: ['-e', 'process.exit(3)'] }, join(root, 'fail.log'), 2000), /exited 3/);
  await assert.rejects(runProcess({ executable: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }, join(root, 'timeout.log'), 100), /timed out/);
});

test('Linux native children receive a short IPC temporary directory', async () => {
  if (process.platform !== 'linux') return;
  const root = await mkdtemp(join(tmpdir(), 'rr-ipc-'));
  const log = join(root, 'tmp.log');
  await runProcess({ executable: process.execPath, args: ['-e', 'console.log(process.env.TMPDIR)'] }, log, 2000);
  assert.equal((await readFile(log, 'utf8')).trim(), '/tmp');
});
