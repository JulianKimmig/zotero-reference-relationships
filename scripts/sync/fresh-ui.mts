/** Initialize an owned anonymous native GUI client without copying any existing profile or credentials. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import { createSession } from '../session.mts';
import { awaitExit } from './run.mts';
import type { TestGroups } from '../contracts.mts';

/**
 * Let actual Zotero initialize its own fresh database, then remove only this warm-up controller.
 * @param {object} options {executable,xpi,id,version,updateURL,controllerTemplate,groups}.
 * @returns {Promise<object>} Initialized private {profile,data,root}; no authentication is read/copied.
 */
export async function freshUIClient({ executable, xpi, id, version, updateURL, controllerTemplate, groups }: {
  executable: string; xpi: string; id: string; version: string; updateURL: string; controllerTemplate: string; groups: TestGroups;
}) {
  const session = await createSession(xpi, id, version, updateURL, controllerTemplate);
  const userFile = join(session.profile, 'user.js'), original = await readFile(userFile);
  const jobFile = join(session.root, 'warmup-job.json');
  const controller = join(session.root, 'controller');
  const manifest = JSON.parse(await readFile(join(controller, 'manifest.json'), 'utf8'));
  const job = { action: 'ui:prepare', state: 'pending', profile: session.profile,
    data: session.data, result: session.result, groups };
  await writeFile(jobFile, JSON.stringify(job));
  const preference = `\nuser_pref("extensions.referenceRelationships.sync.job", ${JSON.stringify(jobFile)});\n`;
  await writeFile(userFile, Buffer.concat([original, Buffer.from(preference)]));
  const log = createWriteStream(join(session.root, 'warmup.log'), { mode: 0o600 });
  const child = spawn('xvfb-run', ['-a', executable, '-no-remote', '-profile', session.profile, '-datadir', session.data],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TMPDIR: '/tmp', MOZ_NO_REMOTE: '1', MOZ_CRASHREPORTER_DISABLE: '1' } });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  try {
    await awaitExit(child);
    const result = JSON.parse(await readFile(session.result, 'utf8'));
    assert.equal(result.ok, true, `Native fresh UI warmup failed: ${JSON.stringify(result.error)}`);
    assert.equal(result.profile, session.profile); assert.equal(result.data, session.data);
    assert.equal(result.version, '10.0.7'); assert.equal(result.report.anonymous, true);
  } finally {
    log.end(); await finished(log);
    await unlink(join(session.profile, 'extensions', manifest.applications.zotero.id));
    await rm(controller, { recursive: true }); await writeFile(userFile, original);
  }
  return { profile: session.profile, data: session.data, root: session.root };
}
