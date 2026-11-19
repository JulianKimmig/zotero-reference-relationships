/** Exercise opt-in diagnostics on real owned files without copying profile or controller contents. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { diagnosticsDirectory, exportDiagnostics, withDiagnostics } from '../scripts/ci/diagnostics.mts';

/** Create real owned job files and a distinct export directory. @returns Exclusive client and output directories plus fixed evidence paths. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rr-diagnostics-'));
  const client = { root: join(root, 'client-root'), profile: join(root, 'client-root', 'profile'), data: join(root, 'client-root', 'data') };
  const directory = join(root, 'safe output');
  await mkdir(client.root); await mkdir(client.profile); await mkdir(client.data); await mkdir(directory);
  const evidence = join(client.root, 'release-ci-release-roundtrip.json');
  return { client, directory, evidence };
}

test('diagnostics are opt-in and reject relative, missing and symlink directories', async () => {
  assert.equal(await diagnosticsDirectory(undefined), undefined);
  await assert.rejects(diagnosticsDirectory('relative'), /absolute/);
  const f = await fixture();
  await assert.rejects(diagnosticsDirectory(join(f.directory, 'missing')), /ENOENT/);
  const link = join(f.client.root, 'link'); await symlink(f.directory, link, 'junction');
  await assert.rejects(diagnosticsDirectory(link), /directory|symlink/);
  assert.equal(await diagnosticsDirectory(f.directory), await realpath(f.directory));
});

test('exports only explicit regular log/result files with sanitized paths and portable flat names', async () => {
  const f = await fixture();
  await writeFile(`${f.evidence}.log`, `Failure in ${f.client.profile}; data ${f.client.data}; root ${f.client.root}`);
  await writeFile(f.evidence, JSON.stringify({ ok: false, profile: f.client.profile, data: f.client.data, report: { reason: 'native failure' } }));
  await writeFile(join(f.client.profile, 'private-file'), 'must never upload');
  await writeFile(join(f.client.root, 'controller.js'), 'must never upload');
  await exportDiagnostics(f.directory, f.client, 'ci-release:roundtrip');
  const names = (await readdir(f.directory)).sort();
  assert.deepEqual(names, ['client-root-release-ci-release-roundtrip.json.process.log', 'client-root-release-ci-release-roundtrip.json.result.log']);
  assert.ok(names.every(name => name.endsWith('.log')));
  const result = JSON.parse(await readFile(join(f.directory, names[1]), 'utf8')) as { profile: string; data: string; report: { reason: string } };
  assert.equal(result.profile, '<profile>'); assert.equal(result.data, '<data>');
  assert.equal(result.report.reason, 'native failure');
  assert.equal(await readFile(join(f.directory, names[0]), 'utf8'), 'Failure in <profile>; data <data>; root <client-root>');
});

test('missing native JSON still exports the failed process log', async () => {
  const f = await fixture(); await writeFile(`${f.evidence}.log`, 'native process failed before result');
  await exportDiagnostics(f.directory, f.client, 'ci-release:roundtrip');
  assert.deepEqual(await readdir(f.directory), ['client-root-release-ci-release-roundtrip.json.process.log']);
});

test('never overwrites existing evidence or follows a source symlink', async () => {
  const f = await fixture(); await writeFile(`${f.evidence}.log`, 'first');
  await exportDiagnostics(f.directory, f.client, 'ci-release:roundtrip');
  await assert.rejects(exportDiagnostics(f.directory, f.client, 'ci-release:roundtrip'), /EEXIST/);
  const other = await fixture();
  await symlink(`${f.evidence}.log`, `${other.evidence}.log`);
  await assert.rejects(exportDiagnostics(other.directory, other.client, 'ci-release:roundtrip'), /regular|symlink/);
  assert.deepEqual(await readdir(other.directory), []);
});

test('rejects invalid actions and exports nothing when diagnostics are disabled', async () => {
  const f = await fixture();
  await exportDiagnostics(undefined, f.client, '../escape');
  await assert.rejects(exportDiagnostics(f.directory, f.client, '../escape'));
  assert.deepEqual(await readdir(f.directory), []);
});

test('exports after a failed operation while preserving its original exception', async () => {
  const f = await fixture(), original = new Error('native failed');
  await assert.rejects(withDiagnostics(f.directory, f.client, 'ci-release:roundtrip', [], async () => {
    await writeFile(`${f.evidence}.log`, 'actual failed process'); throw original;
  }), error => error === original);
  assert.equal((await readdir(f.directory)).length, 1);
});

test('export failure preserves an original native failure and fails otherwise successful operations', async () => {
  const f = await fixture(), original = new Error('native failed');
  await writeFile(`${f.evidence}.log`, 'failure log');
  await writeFile(join(f.directory, `${basename(f.client.root)}-release-ci-release-roundtrip.json.process.log`), 'prior evidence');
  await assert.rejects(withDiagnostics(f.directory, f.client, 'ci-release:roundtrip', [], async () => { throw original; }), error => error === original);
  await assert.rejects(withDiagnostics(f.directory, f.client, 'ci-release:roundtrip', [], async () => 'success'), /EEXIST/);
});

test('redacts explicit input paths including Windows escaped JSON representations', async () => {
  const f = await fixture(), input = 'C:\\private path\\artifact.xpi';
  await writeFile(`${f.evidence}.log`, `Install ${input}; serialized ${JSON.stringify(input)}`);
  await exportDiagnostics(f.directory, f.client, 'ci-release:roundtrip', [input]);
  const text = await readFile(join(f.directory, 'client-root-release-ci-release-roundtrip.json.process.log'), 'utf8');
  assert.equal(text, 'Install <input>; serialized "<input>"');
});

test('rejects upload directories inside the owned profile tree', async () => {
  const f = await fixture(); await writeFile(`${f.evidence}.log`, 'owned diagnostic');
  await assert.rejects(exportDiagnostics(f.client.profile, f.client, 'ci-release:roundtrip'), /outside/);
  assert.deepEqual(await readdir(f.client.profile), []);
});

test('does not follow an existing target symlink or overwrite its external target', async () => {
  const f = await fixture(), external = join(f.client.root, 'untouched');
  await writeFile(external, 'untouched'); await writeFile(`${f.evidence}.log`, 'new diagnostic');
  await symlink(external, join(f.directory, 'client-root-release-ci-release-roundtrip.json.process.log'));
  await assert.rejects(exportDiagnostics(f.directory, f.client, 'ci-release:roundtrip'), /EEXIST/);
  assert.equal(await readFile(external, 'utf8'), 'untouched');
});

test('runJob rejects invalid diagnostics configuration before writing or launching', async () => {
  const { runJob } = await import('../scripts/ci/client.mts');
  const f = await fixture(), previous = process.env.ZOTERO_CI_DIAGNOSTICS;
  process.env.ZOTERO_CI_DIAGNOSTICS = 'relative';
  try {
    await assert.rejects(runJob({ ...f.client, preferences: '' }, '/must-not-launch', '10.0.8', {
      action: 'ci-release:roundtrip', currentVersion: '0.1.1', groups: { writable: 1, restricted: 2 }, marker: 'CI',
    }), /absolute/);
    assert.deepEqual((await readdir(f.client.root)).sort(), ['data', 'profile']);
  } finally {
    if (previous === undefined) delete process.env.ZOTERO_CI_DIAGNOSTICS;
    else process.env.ZOTERO_CI_DIAGNOSTICS = previous;
  }
});
