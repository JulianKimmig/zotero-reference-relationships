/** Initialize durable dedicated Zotero clients and authenticate via native APIs without persisting or logging supplied passwords. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDevelopmentCredentials } from './account-credentials.mts';
import { authorizeBrowserAccount, BrowserAuthorizationError } from './account-browser-session.mts';
import { openLoginBrowser } from './account-browser.mts';
import { freshUIClient } from './fresh-ui.mts';
import { prepareSignedSession } from './signed-session.mts';
import { awaitExit, validateConfig, requireClosed } from './run.mts';
import { validateNativeJobResult } from './native-result.mts';
import type { ClientProfile, SyncConfig } from '../contracts.mts';
import type { authenticateDevelopmentAccount, inspectDevelopmentAccount } from '../../tests/sync-controller/account-auth.mts';

/** Run a visible native setup process with discarded console streams and sanitized output, allowing genuine key-manager prompts to reach the user. @param options Owned runtime setup with the real Zotero executable. @param client Explicit dedicated client. @param userID Expected accepted account. @param action Status, browser-key storage or stored-login verification. @param apiKey Optional transient browser-issued key. @returns Public native receipt after exit0 and profile/version validation. */
async function accountJob(options: { executable: string; controllerTemplate: string; updateURL: string; groups: SyncConfig['groups'] },
  client: ClientProfile, userID: number, action: 'account:status' | 'account:browser-login' | 'account:verify', apiKey = '') {
  await requireClosed(client.profile);
  const session = await prepareSignedSession(client, { action, state: 'pending',
    expectedUserID: userID, groups: options.groups, marker: 'Dedicated native account setup' }, options);
  console.log(JSON.stringify({ action, userID, session: session.root }));
  const environment = { ...process.env, TMPDIR: '/tmp', MOZ_NO_REMOTE: '1', MOZ_CRASHREPORTER_DISABLE: '1',
    RR_ACCOUNT_USERNAME: '', RR_ACCOUNT_PASSWORD: '', RR_ACCOUNT_API_KEY: apiKey };
  const child = spawn(options.executable, ['-no-remote', '-profile', client.profile, '-datadir', client.data],
    { detached: true, stdio: 'ignore', env: environment });
  try {
    await awaitExit(child);
    const report = validateNativeJobResult<Awaited<ReturnType<typeof authenticateDevelopmentAccount>> | Awaited<ReturnType<typeof inspectDevelopmentAccount>>>(
      JSON.parse(await readFile(session.result, 'utf8')), client);
    if (action === 'account:status') assert.ok(report.userID === null || report.userID === userID);
    else assert.equal(report.userID, userID);
    if (action === 'account:verify') assert.ok('reusedStoredLogin' in report && report.reusedStoredLogin);
    return report;
  } finally { await session.restore(); }
}

/** Validate explicit locations, retain durable client configuration, then verify all three logins across real restarts. @returns Complete public setup result; top-level failure output never prints external exceptions. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  assert.ok(args.length === 6 && args[0] === '--credentials' && args[2] === '--runtime-root' && args[4] === '--xpi'
    && [args[1], args[3], args[5]].every(isAbsolute), 'Use --credentials ABS --runtime-root ABS --xpi ABS');
  const [credentialPath, root, xpi] = [args[1], args[3], args[5]], executable = process.env.ZOTERO_BIN;
  assert.ok(executable && isAbsolute(executable), 'Set absolute ZOTERO_BIN');
  const browser = process.env.ZOTERO_BROWSER_BIN, driver = process.env.ZOTERO_WEBDRIVER_BIN;
  assert.ok(browser && driver && isAbsolute(browser) && isAbsolute(driver), 'Set explicit installed browser and WebDriver executables');
  assert.equal(resolve(process.env.TMPDIR ?? ''), root, 'Node TMPDIR must be the explicit durable runtime root');
  await access(executable); await access(xpi);
  const credentials = await readDevelopmentCredentials(credentialPath);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const groups = { writable: 6749379, restricted: 6749388 };
  const options = { executable, groups, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  const configPath = join(root, 'sync-config.json');
  let config: SyncConfig;
  try { config = JSON.parse(await readFile(configPath, 'utf8')); }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('Cannot read durable sync configuration');
    config = { groups, clients: {} };
    for (const role of ['a1', 'a2', 'b1']) {
      config.clients[role] = await freshUIClient({ ...options, xpi, id: manifest.applications.zotero.id, version: manifest.version });
      await writeFile(join(root, 'prepared-clients.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
    }
    await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
  }
  validateConfig(config); assert.deepEqual(config.groups, groups);
  for (const client of Object.values(config.clients)) for (const path of [client.profile, client.data]) {
    const suffix = relative(root, path); assert.ok(suffix && !suffix.startsWith('..') && !isAbsolute(suffix), 'Dedicated client must remain inside its durable root');
  }
  const completed = [];
  for (const role of ['a1', 'a2', 'b1']) {
    const expected = role === 'b1' ? 22463893 : 22463862;
    const status = await accountJob(options, config.clients[role], expected, 'account:status');
    assert.ok('keyPresent' in status, 'Native setup status omitted key presence');
    let loggedIn;
    if (status.keyPresent) loggedIn = await accountJob(options, config.clients[role], expected, 'account:verify');
    else {
      const apiKey = await authorizeBrowserAccount(expected, url => openLoginBrowser(url, role === 'b1' ? credentials.b : credentials.a,
        { browser, driver, profile: join(root, role === 'b1' ? 'browser-account-b' : 'browser-account-a') }));
      loggedIn = await accountJob(options, config.clients[role], expected, 'account:browser-login', apiKey);
    }
    const restarted = await accountJob(options, config.clients[role], expected, 'account:verify');
    completed.push({ role, loggedIn, restarted });
    await writeFile(join(root, 'account-setup-progress.json'), JSON.stringify({ completed }, null, 2), { mode: 0o600 });
  }
  await writeFile(join(root, 'account-setup-result.json'), JSON.stringify({ ok: true, configPath, completed }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ok: true, configPath, clients: completed.length }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof BrowserAuthorizationError ? error.message
      : 'Dedicated account setup failed; inspect only the sanitized native result and setup progress.'); process.exitCode = 1;
  });
}
