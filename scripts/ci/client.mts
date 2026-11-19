/** Owned anonymous CI clients reuse initialized profiles only after the previous native process closes. */
import assert from 'node:assert/strict';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../session.mts';
import { command, evidenceName, runProcess } from './platform.mts';
import { diagnosticsDirectory, withDiagnostics } from './diagnostics.mts';
import { validateEnvelope } from './envelope.mts';
import type { Artifact } from './artifacts.mts';
import type { ReleaseJob } from '../../tests/sync-controller/ci-release.sys.mts';

/** One exclusively created profile plus private controller and evidence directories. */
export interface CIClient { root: string; profile: string; data: string; preferences: string }
/** Create an anonymous profile with a CI-specific controller and its own compatibility declaration. @param input Actual archive metadata. @returns Exclusively owned profile without copying account state. */
export async function createClient(input: Artifact): Promise<CIClient> {
  const session = await createSession(input.xpi, 'reference-relationships@zotero-plugins.local', input.version, input.updateURL,
    fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)));
  const controller = join(session.root, 'controller');
  await cp(fileURLToPath(new URL('../../tests/ci-controller/bootstrap.js', import.meta.url)), join(controller, 'bootstrap.js'));
  const manifestPath = join(controller, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { applications: { zotero: { strict_min_version: string; strict_max_version: string } } };
  manifest.applications.zotero.strict_min_version = '10.0.7'; manifest.applications.zotero.strict_max_version = '10.*';
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { root: session.root, profile: session.profile, data: session.data, preferences: await readFile(join(session.profile, 'user.js'), 'utf8') };
}
/** Run one job serially in an owned profile. @param client Exclusively owned directories. @param executable Actual host. @param expected Resolved host version. @param job Native lifecycle payload. @returns Observed native version and typed report after zero native exit. */
export async function runJob<T extends object>(client: CIClient, executable: string, expected: string, job: ReleaseJob): Promise<{ version: string; report: T; evidence: string }> {
  const directory = await diagnosticsDirectory(process.env.ZOTERO_CI_DIAGNOSTICS);
  return withDiagnostics(directory, client, job.action, [executable, job.xpi ?? '', job.previousXPI ?? ''], async () => {
    const evidence = join(client.root, evidenceName('release', job.action)), jobFile = `${evidence}.job.json`;
    await writeFile(jobFile, JSON.stringify({ ...job, state: 'pending', profile: client.profile, data: client.data, result: evidence }), { flag: 'wx', mode: 0o600 });
    await writeFile(join(client.profile, 'user.js'), `${client.preferences}\nuser_pref("extensions.referenceRelationships.sync.job", ${JSON.stringify(jobFile)});\n`);
    await runProcess(command(executable, client), `${evidence}.log`);
    const result = validateEnvelope(JSON.parse(await readFile(evidence, 'utf8')), client, expected);
    assert.ok(result.report);
    return { ...result, report: result.report as T, evidence };
  });
}
