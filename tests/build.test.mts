/** Behavioral tests for the native-zip release package and its input boundary. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { buildProject } from '../scripts/build.mts';

/** Create an isolated package input. @param {boolean} withLocale Include required Fluent resources. @returns {Promise<string>} Fixture root. */
async function fixture(withLocale: boolean = true) {
  const root = await mkdtemp(join(tmpdir(), 'rr-package-test-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      strict: true, noEmitOnError: true, types: [], rootDir: '.', outDir: '.build' },
    include: ['src/**/*.mts'],
  }));
  await writeFile(join(root, 'manifest.json'), JSON.stringify({
    manifest_version: 2, name: 'Package fixture', version: '0.1.0',
    applications: { zotero: {
      id: 'fixture@example.test', strict_min_version: '10.0.7', strict_max_version: '10.0.7',
      update_url: 'https://example.test/fixture-updates.json',
    } },
  }));
  await writeFile(join(root, 'bootstrap.ts'), '/** Fixture bootstrap. */\nfunction startup(): number { return 1; }\n');
  await writeFile(join(root, 'LICENSE'), 'MIT fixture license and copyright notice.\n');
  await writeFile(join(root, 'THIRD-PARTY-NOTICES.md'), '# Fixture dependency notices\n');
  await writeFile(join(root, 'src', 'runtime.mts'), '/** Fixture runtime. */\nexport const value: number = 7;\n');
  await writeFile(join(root, 'src', 'preferences.xhtml'), '<html xmlns="http://www.w3.org/1999/xhtml"/>');
  if (withLocale) {
    await mkdir(join(root, 'locale', 'en-US'), { recursive: true });
    await writeFile(join(root, 'locale', 'en-US', 'reference-relationships.ftl'), '# Fixture strings.\nfixture-label = Relationships\n');
  }
  return root;
}

test('packages executable compiled code with only production files and unchanged native assets', async () => {
  const root = await fixture();
  await mkdir(join(root, 'tests'));
  await writeFile(join(root, 'tests', 'controller.js'), 'private controller');
  await writeFile(join(root, 'prefs.js'), 'private preference');
  const output = join(root, 'release.xpi');
  assert.equal(await buildProject(root, output), output);
  const allEntries = execFileSync('unzip', ['-Z1', output], { encoding: 'utf8' }).trim().split('\n');
  const entries = allEntries.filter(name => !name.endsWith('/')).sort();
  assert.deepEqual(entries, ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'bootstrap.js', 'locale/en-US/reference-relationships.ftl', 'manifest.json', 'src/preferences.xhtml', 'src/runtime.mjs']);
  for (const name of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) {
    assert.deepEqual(execFileSync('unzip', ['-p', output, name]), await readFile(join(root, name)));
  }
  assert.ok(allEntries.includes('locale/') && allEntries.includes('locale/en-US/'), 'Native locale discovery requires directory entries');
  const runtime = execFileSync('unzip', ['-p', output, 'src/runtime.mjs'], { encoding: 'utf8' });
  assert.equal((await import(`data:text/javascript;base64,${Buffer.from(runtime).toString('base64')}`)).value, 7);
  const scope: { startup?: () => number } = {};
  runInNewContext(execFileSync('unzip', ['-p', output, 'bootstrap.js'], { encoding: 'utf8' }), scope);
  assert.ok(scope.startup);
  assert.equal(scope.startup(), 1);
  assert.equal(execFileSync('unzip', ['-p', output, 'src/preferences.xhtml'], { encoding: 'utf8' }),
    await readFile(join(root, 'src', 'preferences.xhtml'), 'utf8'));
  assert.deepEqual(execFileSync('unzip', ['-p', output, 'locale/en-US/reference-relationships.ftl']),
    await readFile(join(root, 'locale', 'en-US', 'reference-relationships.ftl')));
});

test('invalid TypeScript rejects the release without producing an archive', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src', 'runtime.mts'), '/** Invalid runtime. */\nexport const value: number = "bad";\n');
  const output = join(root, 'release.xpi');
  await assert.rejects(buildProject(root, output), /not assignable|TS2322/);
  await assert.rejects(readFile(output), /ENOENT/);
});

test('missing project license refuses an incomplete release', async () => {
  const root = await fixture(), output = join(root, 'release.xpi');
  await unlink(join(root, 'LICENSE'));
  await assert.rejects(buildProject(root, output), /LICENSE|ENOENT/);
  await assert.rejects(readFile(output), /ENOENT/);
});

test('missing dependency notices refuses an incomplete release', async () => {
  const root = await fixture(), output = join(root, 'release.xpi');
  await unlink(join(root, 'THIRD-PARTY-NOTICES.md'));
  await assert.rejects(buildProject(root, output), /THIRD-PARTY-NOTICES|ENOENT/);
  await assert.rejects(readFile(output), /ENOENT/);
});

test('license symlinks cannot add files outside the production package', async () => {
  const root = await fixture();
  await unlink(join(root, 'LICENSE')); await symlink('/etc/hostname', join(root, 'LICENSE'));
  await assert.rejects(buildProject(root, join(root, 'release.xpi')), /symbolic|symlink/i);
});

test('missing localization resources fails instead of shipping an unlabeled native section', async () => {
  const root = await fixture(false);
  await assert.rejects(buildProject(root, join(root, 'release.xpi')), /locale|ENOENT/);
});

test('rejects a localization directory symlink outside the production boundary', async () => {
  const root = await fixture(false);
  await symlink('/etc', join(root, 'locale'));
  await assert.rejects(buildProject(root, join(root, 'release.xpi')), /symbolic|symlink/i);
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
