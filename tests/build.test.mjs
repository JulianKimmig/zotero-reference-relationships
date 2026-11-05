/** Behavioral tests for the native-zip release package and its input boundary. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildProject } from '../scripts/build.mjs';

/** Create an isolated package input; @returns {Promise<string>} fixture root. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rr-package-test-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'manifest.json'), JSON.stringify({
    manifest_version: 2, name: 'Package fixture', version: '0.1.0',
    applications: { zotero: {
      id: 'fixture@example.test', strict_min_version: '10.0.7', strict_max_version: '10.0.7',
      update_url: 'https://example.test/fixture-updates.json',
    } },
  }));
  await writeFile(join(root, 'bootstrap.js'), '/** Fixture bootstrap. */\n');
  await writeFile(join(root, 'src', 'runtime.js'), '/** Fixture runtime. */\n');
  return root;
}

test('packages actual bytes with only manifest, bootstrap and production src', async () => {
  const root = await fixture();
  await mkdir(join(root, 'tests'));
  await writeFile(join(root, 'tests', 'controller.js'), 'private controller');
  await writeFile(join(root, 'prefs.js'), 'private preference');
  const output = join(root, 'release.xpi');
  assert.equal(await buildProject(root, output), output);
  const entries = execFileSync('unzip', ['-Z1', output], { encoding: 'utf8' })
    .trim().split('\n').filter(name => !name.endsWith('/')).sort();
  assert.deepEqual(entries, ['bootstrap.js', 'manifest.json', 'src/runtime.js']);
  assert.equal(execFileSync('unzip', ['-p', output, 'src/runtime.js'], { encoding: 'utf8' }),
    await readFile(join(root, 'src', 'runtime.js'), 'utf8'));
});

test('missing manifest fails before producing an artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rr-missing-test-'));
  await assert.rejects(buildProject(root, join(root, 'release.xpi')), /manifest|ENOENT/);
});

test('missing bootstrap fails rather than shipping an incomplete plugin', async () => {
  const root = await fixture();
  const incomplete = await mkdtemp(join(tmpdir(), 'rr-incomplete-test-'));
  await writeFile(join(incomplete, 'manifest.json'), await readFile(join(root, 'manifest.json')));
  await mkdir(join(incomplete, 'src'));
  await assert.rejects(buildProject(incomplete, join(incomplete, 'release.xpi')), /bootstrap|ENOENT/);
});

test('rejects symlinks escaping the production source boundary', async () => {
  const root = await fixture();
  await symlink('/etc/hostname', join(root, 'src', 'external.js'));
  await assert.rejects(buildProject(root, join(root, 'release.xpi')), /symbolic|symlink/i);
});

test('refuses existing output so stale entries cannot survive a rebuild', async () => {
  const root = await fixture();
  const output = join(root, 'release.xpi');
  await writeFile(output, 'existing artifact');
  await assert.rejects(buildProject(root, output), /exist/i);
  assert.equal(await readFile(output, 'utf8'), 'existing artifact');
});

test('rejects a manifest missing the Zotero-required update URL', async () => {
  const root = await fixture();
  const manifestPath = join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  delete manifest.applications.zotero.update_url;
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(buildProject(root, join(root, 'release.xpi')), /update_url/);
});

test('rejects a data update URL which Zotero disables before startup', async () => {
  const root = await fixture();
  const manifestPath = join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.applications.zotero.update_url = 'data:application/json,%7B%7D';
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(buildProject(root, join(root, 'release.xpi')), /HTTPS/);
});
