/** Run the packaged scaffold in real Zotero under Xvfb, retaining logs and results. */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildProject, projectRoot } from './build.mjs';
import { createSession, launchArguments, validateResult } from './session.mjs';

/** Await process exit with a bounded timeout and group cleanup. @param {import('node:child_process').ChildProcess} child @returns {Promise<object>} exit status. */
function waitForExit(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') console.error(error); }
      reject(new Error('Zotero integration timed out after 120 seconds'));
    }, 120000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

/** Build a fresh XPI, create a dedicated session and run the real driver. @returns {Promise<void>} */
async function main() {
  const executable = process.env.ZOTERO_BIN;
  if (!executable) throw new Error('Set ZOTERO_BIN to the verified Zotero 10.0.7 Linux executable');
  await access(executable);
  const manifest = JSON.parse(await readFile(join(projectRoot, 'manifest.json'), 'utf8'));
  const artifactRoot = await mkdtemp(join(tmpdir(), 'reference-relationships-build-'));
  const xpi = await buildProject(projectRoot, join(artifactRoot, 'reference-relationships.xpi'));
  const { id, update_url: updateURL } = manifest.applications.zotero;
  const session = await createSession(xpi, id, manifest.version, updateURL);
  const logPath = join(session.root, 'zotero.log');
  console.log(JSON.stringify({ session: session.root, xpi, log: logPath, result: session.result }));
  const log = createWriteStream(logPath);
  const child = spawn('xvfb-run', launchArguments(executable, session), {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MOZ_NO_REMOTE: '1', MOZ_CRASHREPORTER_DISABLE: '1' },
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let status;
  try {
    status = await waitForExit(child);
  } finally {
    log.end();
    await finished(log);
  }
  let result;
  try { result = JSON.parse(await readFile(session.result, 'utf8')); }
  catch (error) { throw new Error(`No valid driver result (${error.message}); exit=${JSON.stringify(status)}; log=${logPath}`); }
  validateResult(result, session);
  if (status.code !== 0) throw new Error(`Zotero exited unsuccessfully: ${JSON.stringify(status)}; log=${logPath}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
