/** Verify actual account/group synchronization using explicitly configured test profiles. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { finished } from 'node:stream/promises';
import { validateEnvironment, validateTransfer } from './protocol.mjs';

/** Reject invalid configuration before any profile mutation. @param {object} config Input. @returns {void} */
function validateConfig(config) {
  for (const key of ['writable', 'restricted']) {
    assert.ok(Number.isSafeInteger(config.groups?.[key]) && config.groups[key] > 0, 'Positive group IDs are required');
  }
  assert.notEqual(config.groups.writable, config.groups.restricted, 'Test groups must differ');
  const paths = [];
  for (const role of ['a1', 'a2', 'b1']) {
    const client = config.clients?.[role];
    assert.ok(client && isAbsolute(client.profile) && isAbsolute(client.data), `Absolute profile/data paths required for ${role}`);
    paths.push(client.profile, client.data);
  }
  assert.equal(new Set(paths).size, paths.length, 'Each profile and data directory must be distinct');
}

/** Check live command lines rather than stale lock files. @param {string} profile Exact dedicated profile. @returns {Promise<void>} */
async function requireClosed(profile) {
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    let args;
    try { args = (await readFile(`/proc/${entry}/cmdline`, 'utf8')).split('\0'); }
    catch (error) {
      if (['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) continue;
      throw error;
    }
    for (const flag of ['-profile', '--profile']) {
      const index = args.indexOf(flag);
      assert.ok(index < 0 || args[index + 1] !== profile, `Close the test client using ${profile} before running this probe`);
    }
  }
}

/** Wait for the controlled process and all output to close. @param {object} child Owned process. @returns {Promise<void>} */
function awaitExit(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') console.error(error.code); }
      reject(new Error('Native sync probe timed out after 240 seconds'));
    }, 240000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Native sync client exited ${code}`));
    });
  });
}

/** Run one real client job without exposing authentication files. @param {object} options Shared environment. @param {string} role Client alias. @param {object} job Action. @returns {Promise<object>} Native result. */
async function nativeJob(options, role, job) {
  const { prepareSignedSession } = await import('./signed-session.mjs');
  const client = options.config.clients[role];
  await requireClosed(client.profile);
  const session = await prepareSignedSession(client, { ...job, state: 'pending' }, {
    controllerTemplate: options.controllerTemplate, updateURL: options.updateURL,
  });
  const log = createWriteStream(join(session.root, 'process.log'), { mode: 0o600 });
  console.log(JSON.stringify({ action: job.action, role, session: session.root }));
  const child = spawn('xvfb-run', ['-a', options.executable, '-no-remote', '-profile', client.profile,
    '-datadir', client.data], { detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MOZ_NO_REMOTE: '1', MOZ_CRASHREPORTER_DISABLE: '1' } });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  try {
    await awaitExit(child);
    const result = JSON.parse(await readFile(session.result, 'utf8'));
    assert.equal(result.profile, client.profile, 'Profile isolation mismatch');
    assert.equal(result.data, client.data, 'Data isolation mismatch');
    assert.equal(result.version, '10.0.7', 'Unverified native version');
    assert.equal(result.ok, true, `Native job failed: ${JSON.stringify(result.error)}`);
    await writeFile(join(options.root, `${role}-${job.action}.json`), JSON.stringify(result, null, 2));
    return result.report;
  } finally {
    log.end();
    await finished(log);
    await session.restore();
  }
}

/** Execute identity checks then explicit cross-client fixture transfers. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/sync/run.mjs /absolute/sync-config.json');
  const executable = process.env.ZOTERO_BIN;
  assert.ok(executable, 'Set ZOTERO_BIN to the verified native executable');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
  validateConfig(config);
  await access(executable);
  for (const client of Object.values(config.clients)) await requireClosed(client.profile);
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const root = await mkdtemp(join(tmpdir(), 'rr-sync-gate-'));
  const options = { config, root, executable, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  const reports = {};
  for (const role of ['a1', 'a2', 'b1']) reports[role] = await nativeJob(options, role, { action: 'inspect', groups: config.groups });
  validateEnvironment(reports, config.groups);
  const marker = `Reference Relationships sync gate ${randomUUID()}`;
  const common = { marker, groups: config.groups };
  const created = await nativeJob(options, 'a1', { ...common, action: 'create' });
  common.keys = created.keys;
  await nativeJob(options, 'a2', { ...common, action: 'a2-edit' });
  const b1 = await nativeJob(options, 'b1', { ...common, action: 'b1-edit' });
  const final = await nativeJob(options, 'a1', { ...common, action: 'verify' });
  const result = { ...final, denied: b1.denied };
  validateTransfer(result);
  await writeFile(join(root, 'gate-result.json'), JSON.stringify({ ok: true, reports, result, keys: created.keys }, null, 2));
  console.log(JSON.stringify({ ok: true, root, marker, keys: created.keys }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
