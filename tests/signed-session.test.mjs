/** Exercise signed-session provisioning and cleanup with real disposable filesystem fixtures. */
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';
import { prepareSignedSession } from '../scripts/sync/signed-session.mjs';

const controllerID = 'rr-sync-probe@example.test';
const updateURL = 'https://raw.githubusercontent.com/JulianKimmig/zotero-reference-relationships/main/updates.json';
const original = Buffer.concat([Buffer.from('\uFEFF// original\r\nuser_pref("untouched", true);'), Buffer.from([0xff])]);

/** Create complete external controller/profile fixtures. @param {object} t test context. @returns {Promise<object>} fixture paths and options. */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'rr-signed-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const client = { profile: join(root, 'profile'), data: join(root, 'data') };
  const controllerTemplate = join(root, 'template');
  for (const path of [client.profile, client.data, controllerTemplate]) await mkdir(path);
  await mkdir(join(client.profile, 'extensions'));
  await writeFile(join(client.profile, 'prefs.js'), 'private preferences; do not copy');
  await writeFile(join(client.data, 'zotero.sqlite'), 'existing opaque database');
  await writeFile(join(client.profile, 'user.js'), original);
  await writeFile(join(client.profile, 'login.json'), 'private login sentinel');
  await writeFile(join(client.profile, 'key4.db'), 'private key sentinel');
  await writeFile(join(client.profile, 'unknown'), 'unknown profile file');
  await writeFile(join(client.profile, 'extensions', 'other@example.test'), 'unknown extension');
  await writeFile(join(controllerTemplate, 'manifest.json'), JSON.stringify({
    manifest_version: 2, name: 'External sync probe', version: '0.1.0',
    applications: { zotero: { id: controllerID, strict_min_version: '10.0', strict_max_version: '10.*' } },
  }));
  await writeFile(join(controllerTemplate, 'bootstrap.js'), '/** External controller fixture. */\nfunction startup() {}\n');
  return { root, client, options: { controllerTemplate, updateURL }, proxy: join(client.profile, 'extensions', controllerID) };
}

/** Register bounded cleanup while retaining evidence until assertions finish. @param {object} t test context. @param {object} f fixture. @param {object} job payload. @returns {Promise<object>} prepared session. */
async function prepare(t, f, job = { operation: 'inspect', groups: [123, 456] }) {
  const session = await prepareSignedSession(f.client, job, f.options);
  t.after(async () => {
    try { await session.restore(); }
    finally { await rm(session.root, { recursive: true, force: true }); }
  });
  return session;
}

test('prepares a private controller and job, then restores exact bytes while retaining evidence', async t => {
  const f = await fixture(t);
  const templateManifest = await readFile(join(f.options.controllerTemplate, 'manifest.json'));
  const job = { operation: 'inspect', groups: [123, 456], profile: 'untrusted', data: 'untrusted', result: 'untrusted' };
  const session = await prepare(t, f, job);
  assert.deepEqual(Object.keys(session).sort(), ['data', 'jobFile', 'profile', 'restore', 'result', 'root']);
  assert.ok(isAbsolute(session.root));
  assert.equal((await lstat(session.root)).mode & 0o777, 0o700);
  assert.equal(session.profile, f.client.profile);
  assert.equal(session.data, f.client.data);
  assert.equal(session.jobFile, join(session.root, 'job.json'));
  assert.equal(session.result, join(session.root, 'result.json'));
  assert.deepEqual(JSON.parse(await readFile(session.jobFile)), { ...job, ...f.client, result: session.result });
  assert.equal(job.profile, 'untrusted');
  const controller = join(session.root, 'controller');
  assert.equal((await readFile(f.proxy, 'utf8')).trim(), controller);
  const manifest = JSON.parse(await readFile(join(controller, 'manifest.json')));
  assert.equal(manifest.applications.zotero.id, controllerID);
  assert.equal(manifest.applications.zotero.update_url, updateURL);
  assert.deepEqual(await readFile(join(controller, 'bootstrap.js')), await readFile(join(f.options.controllerTemplate, 'bootstrap.js')));
  assert.deepEqual(await readFile(join(f.options.controllerTemplate, 'manifest.json')), templateManifest);
  const prepared = await readFile(join(session.profile, 'user.js'));
  assert.deepEqual(prepared.subarray(0, original.length), original);
  const appended = prepared.subarray(original.length).toString();
  for (const [key, value] of Object.entries({
    'extensions.referenceRelationships.sync.job': session.jobFile,
    'extensions.startupScanScopes': 15, 'extensions.enabledScopes': 15, 'extensions.autoDisableScopes': 0,
  })) assert.ok(appended.includes(`user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`));
  assert.deepEqual(await readFile(join(session.root, 'user.js.original')), original);
  await writeFile(session.result, '{"ok":true}');
  await writeFile(join(session.root, 'runtime.log'), 'native evidence');
  await session.restore();
  assert.deepEqual(await readFile(join(session.profile, 'user.js')), original);
  await assert.rejects(lstat(f.proxy), { code: 'ENOENT' });
  await assert.rejects(lstat(controller), { code: 'ENOENT' });
  assert.equal(await readFile(session.result, 'utf8'), '{"ok":true}');
  assert.equal(await readFile(join(session.root, 'runtime.log'), 'utf8'), 'native evidence');
  assert.equal(JSON.parse(await readFile(session.jobFile)).operation, 'inspect');
  await writeFile(join(session.profile, 'user.js'), 'later user edit');
  await session.restore();
  assert.equal(await readFile(join(session.profile, 'user.js'), 'utf8'), 'later user edit');
});

test('removes only the user.js it created when the original was absent', async t => {
  const f = await fixture(t);
  await rm(join(f.client.profile, 'user.js'));
  const session = await prepare(t, f);
  assert.ok((await lstat(join(f.client.profile, 'user.js'))).isFile());
  await session.restore();
  await assert.rejects(lstat(join(f.client.profile, 'user.js')), { code: 'ENOENT' });
  assert.equal(await readFile(join(f.client.profile, 'unknown'), 'utf8'), 'unknown profile file');
});

for (const missing of ['profile', 'prefs.js', 'data', 'zotero.sqlite']) {
  test(`rejects missing existing ${missing} without provisioning an empty client`, async t => {
    const f = await fixture(t);
    const path = missing === 'profile' || missing === 'data' ? f.client[missing]
      : join(missing === 'prefs.js' ? f.client.profile : f.client.data, missing);
    await rm(path, { recursive: true });
    await assert.rejects(prepareSignedSession(f.client, {}, f.options), /profile|prefs\.js|data|zotero\.sqlite|ENOENT/);
    await assert.rejects(lstat(path), { code: 'ENOENT' });
    await assert.rejects(lstat(f.proxy), { code: 'ENOENT' });
  });
}

for (const url of [undefined, 'http://example.test/updates.json', 'data:application/json,{}', 'invalid']) {
  test(`requires an explicit HTTPS update URL: ${url}`, async t => {
    const f = await fixture(t);
    await assert.rejects(prepareSignedSession(f.client, {}, { ...f.options, updateURL: url }), /HTTPS/);
    assert.deepEqual(await readFile(join(f.client.profile, 'user.js')), original);
    await assert.rejects(lstat(f.proxy), { code: 'ENOENT' });
  });
}

for (const type of ['file', 'directory', 'dangling symlink']) {
  test(`refuses an existing controller ${type} without overwriting it or user.js`, async t => {
    const f = await fixture(t);
    if (type === 'file') await writeFile(f.proxy, 'preexisting proxy');
    else if (type === 'directory') await mkdir(f.proxy);
    else await symlink(join(f.root, 'missing-target'), f.proxy);
    const before = await lstat(f.proxy);
    await assert.rejects(prepareSignedSession(f.client, {}, f.options), /EEXIST|exist/i);
    assert.equal((await lstat(f.proxy)).ino, before.ino);
    if (type === 'file') assert.equal(await readFile(f.proxy, 'utf8'), 'preexisting proxy');
    assert.deepEqual(await readFile(join(f.client.profile, 'user.js')), original);
  });
}

for (const initiallyAbsent of [false, true]) {
  test(`preserves and reports external user.js edits, including originally absent=${initiallyAbsent}`, async t => {
    const f = await fixture(t);
    const userFile = join(f.client.profile, 'user.js');
    if (initiallyAbsent) await rm(userFile);
    const session = await prepareSignedSession(f.client, {}, f.options);
    t.after(() => rm(session.root, { recursive: true, force: true }));
    await writeFile(userFile, 'external changes must survive');
    await assert.rejects(session.restore(), /user\.js.*(changed|modified)/i);
    assert.equal(await readFile(userFile, 'utf8'), 'external changes must survive');
    await assert.rejects(lstat(f.proxy), { code: 'ENOENT' });
    await assert.rejects(lstat(join(session.root, 'controller')), { code: 'ENOENT' });
    assert.ok((await lstat(session.jobFile)).isFile());
  });
}

test('preserves an externally replaced user.js even when bytes match the prepared file', async t => {
  const f = await fixture(t);
  const session = await prepareSignedSession(f.client, {}, f.options);
  t.after(() => rm(session.root, { recursive: true, force: true }));
  const userFile = join(f.client.profile, 'user.js');
  const replacement = join(f.root, 'replacement');
  const contents = await readFile(userFile);
  await writeFile(replacement, contents);
  await rename(replacement, userFile);
  await assert.rejects(session.restore(), /user\.js.*(changed|modified)/i);
  assert.deepEqual(await readFile(userFile), contents);
  await assert.rejects(lstat(f.proxy), { code: 'ENOENT' });
});

test('never deletes a proxy replaced by another owner', async t => {
  const f = await fixture(t);
  const session = await prepareSignedSession(f.client, {}, f.options);
  t.after(() => rm(session.root, { recursive: true, force: true }));
  const replacement = join(f.root, 'replacement');
  await writeFile(replacement, 'external controller');
  await rename(replacement, f.proxy);
  await assert.rejects(session.restore(), /proxy.*(changed|modified)/i);
  assert.equal(await readFile(f.proxy, 'utf8'), 'external controller');
  assert.deepEqual(await readFile(join(f.client.profile, 'user.js')), original);
  await assert.rejects(lstat(join(session.root, 'controller')), { code: 'ENOENT' });
});

test('preserves credentials, database, preferences and unknown files without copying them', async t => {
  const f = await fixture(t);
  const files = [join(f.client.profile, 'prefs.js'), join(f.client.data, 'zotero.sqlite'),
    ...['login.json', 'key4.db', 'unknown', 'extensions/other@example.test'].map(name => join(f.client.profile, name))];
  const before = await Promise.all(files.map(path => readFile(path)));
  await chmod(files[0], 0);
  await chmod(files[1], 0);
  const session = await prepare(t, f);
  const entries = await readdir(session.root);
  assert.deepEqual(entries.sort(), ['controller', 'job.json', 'user.js.original']);
  assert.deepEqual((await readdir(join(session.root, 'controller'))).sort(), ['bootstrap.js', 'manifest.json']);
  await session.restore();
  await chmod(files[0], 0o600);
  await chmod(files[1], 0o600);
  assert.deepEqual(await Promise.all(files.map(path => readFile(path))), before);
});

test('rejects a symlink user.js without touching its target', async t => {
  const f = await fixture(t);
  const target = join(f.root, 'unowned.js');
  await writeFile(target, original);
  await rm(join(f.client.profile, 'user.js'));
  await symlink(target, join(f.client.profile, 'user.js'));
  await assert.rejects(prepareSignedSession(f.client, {}, f.options), /user\.js|regular|symlink/i);
  assert.deepEqual(await readFile(target), original);
  await assert.rejects(lstat(f.proxy), { code: 'ENOENT' });
});

test('rejects an incomplete template before modifying the profile', async t => {
  const f = await fixture(t);
  await rm(join(f.options.controllerTemplate, 'bootstrap.js'));
  await assert.rejects(prepareSignedSession(f.client, {}, f.options), /bootstrap|ENOENT/);
  assert.deepEqual(await readFile(join(f.client.profile, 'user.js')), original);
  await assert.rejects(lstat(f.proxy), { code: 'ENOENT' });
});

test('rejects a template with an unexpected controller identity', async t => {
  const f = await fixture(t);
  const path = join(f.options.controllerTemplate, 'manifest.json');
  const manifest = JSON.parse(await readFile(path));
  manifest.applications.zotero.id = '../unowned';
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(prepareSignedSession(f.client, {}, f.options), /controller|identity|id/i);
  assert.deepEqual(await readFile(join(f.client.profile, 'user.js')), original);
  await assert.rejects(lstat(f.proxy), { code: 'ENOENT' });
});
