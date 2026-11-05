/** Tests of real disposable-profile provisioning and integration result validation. */
import assert from 'node:assert/strict';
import { readFile, realpath, stat, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';
import { createSession, launchArguments, validateResult } from '../scripts/session.mts';

test('provisions distinct absolute profile/data directories and a controller proxy', async () => {
  const session = await createSession('/tmp/local scaffold.xpi', 'fixture@example.test', '0.1.0', 'https://example.test/updates.json');
  assert.ok(isAbsolute(session.root));
  assert.notEqual(await realpath(session.profile), await realpath(session.data));
  assert.ok((await stat(session.profile)).isDirectory());
  assert.ok((await stat(session.data)).isDirectory());
  const prefs = await readFile(join(session.profile, 'user.js'), 'utf8');
  assert.ok(prefs.includes(JSON.stringify(session.result)));
  assert.ok(prefs.includes(JSON.stringify(session.data)));
  assert.ok(prefs.includes(JSON.stringify('/tmp/local scaffold.xpi')));
  const proxy = await readFile(join(session.profile, 'extensions', 'rr-test-controller@example.test'), 'utf8');
  assert.ok((await stat(join(proxy.trim(), 'manifest.json'))).isFile());
  assert.ok((await stat(join(proxy.trim(), 'bootstrap.js'))).isFile());
  const controller = JSON.parse(await readFile(join(proxy.trim(), 'manifest.json'), 'utf8'));
  assert.equal(controller.applications.zotero.update_url, 'https://example.test/updates.json');
  const other = await createSession('/tmp/local scaffold.xpi', 'fixture@example.test', '0.1.0', 'https://example.test/updates.json');
  assert.notEqual(other.root, session.root);
});

test('launches native Zotero under Xvfb with explicit profile AND datadir', async () => {
  const session = await createSession('/tmp/plugin.xpi', 'fixture@example.test', '0.1.0', 'https://example.test/updates.json');
  const args = launchArguments('/tmp/Zotero Linux/zotero', session);
  assert.equal(args[0], '-a');
  assert.ok(args.includes('/tmp/Zotero Linux/zotero'));
  assert.equal(args[args.indexOf('-profile') + 1], session.profile);
  assert.equal(args[args.indexOf('-datadir') + 1], session.data);
  assert.ok(args.includes('-no-remote'));
});

test('provisions the explicitly supplied controller and its actual addon identity', async () => {
  const template = await mkdtemp(join(tmpdir(), 'rr-controller-input-'));
  await writeFile(join(template, 'manifest.json'), JSON.stringify({ applications: { zotero: { id: 'custom-controller@example.test' } } }));
  await writeFile(join(template, 'bootstrap.js'), '/** Controlled fixture bytes. */\n');
  const session = await createSession('/tmp/plugin.xpi', 'fixture@example.test', '0.1.0', 'https://example.test/updates.json', template);
  const installed = await readFile(join(session.profile, 'extensions', 'custom-controller@example.test'), 'utf8');
  assert.equal(await readFile(join(installed, 'bootstrap.js'), 'utf8'), '/** Controlled fixture bytes. */\n');
});

test('a missing explicit controller fails instead of selecting the default controller', async () => {
  await assert.rejects(createSession('/tmp/plugin.xpi', 'fixture@example.test', '0.1.0',
    'https://example.test/updates.json', '/tmp/rr-controller-does-not-exist'), /ENOENT/);
});

test('requires an explicit HTTPS update manifest before provisioning a session', async () => {
  // @ts-expect-error Deliberately malformed runtime input must still fail validation.
  await assert.rejects(createSession('/tmp/plugin.xpi', 'fixture@example.test', '0.1.0'), /HTTPS/);
});

test('rejects the data URI the native runtime disables', async () => {
  await assert.rejects(createSession('/tmp/plugin.xpi', 'fixture@example.test', '0.1.0',
    'data:application/json,%7B%7D'), /HTTPS/);
});

test('rejects success missing required lifecycle checks', () => {
  assert.throws(() => validateResult({ ok: true, checks: [] }, {}), /checks|startup/);
});

test('reports a driver failure with its runtime diagnostic', () => {
  assert.throws(() => validateResult({ ok: false, error: 'startup did not register' }, {}),
    /startup did not register/);
});

test('rejects a runtime result pointing outside the dedicated fixture', () => {
  const checks = ['isolation', 'updates-empty', 'startup', 'disable', 'reenable', 'window-open', 'window-close', 'uninstall', 'shutdown-enabled'];
  assert.throws(() => validateResult({ ok: true, checks, profile: '/personal', data: '/personal' },
    { profile: '/dedicated/profile', data: '/dedicated/data' }), /isolation|profile/);
});

test('rejects a runtime version other than the verified Zotero 10.0.7', () => {
  const session = { profile: '/dedicated/profile', data: '/dedicated/data' };
  const checks = ['isolation', 'updates-empty', 'startup', 'disable', 'reenable', 'window-open', 'window-close', 'uninstall', 'shutdown-enabled'];
  assert.throws(() => validateResult({ ok: true, checks, ...session, zoteroVersion: '10.0.8' }, session),
    /Expected Zotero 10.0.7/);
});

test('accepts all lifecycle checks only for the dedicated fixture and verified runtime', () => {
  const session = { profile: '/dedicated/profile', data: '/dedicated/data' };
  const checks = ['isolation', 'updates-empty', 'startup', 'disable', 'reenable', 'window-open', 'window-close', 'uninstall', 'shutdown-enabled'];
  const result = { ok: true, checks, ...session, zoteroVersion: '10.0.7' };
  assert.equal(validateResult(result, session), result);
});
