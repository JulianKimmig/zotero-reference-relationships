/** Verify native transfer files, private reviewed publication, restart and guarded races in fresh anonymous profiles. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { buildProject, projectRoot } from '../build.mts';
import { nativeJob } from './run.mts';
import { freshUIClient } from './fresh-ui.mts';
import type { NativeReport, SyncConfig } from '../contracts.mts';

/** Build one exact artifact and run each phase once, stopping on any native/report/process failure. @returns {Promise<void>} */
async function main(): Promise<void> {
  assert.ok(process.argv.length === 2 || (process.argv.length === 4 && process.argv[2] === '--xpi'
    && isAbsolute(process.argv[3])), 'Usage: node .build/scripts/sync/transfer-service.mjs [--xpi /absolute/existing.xpi]');
  const executable = process.env.ZOTERO_BIN; assert.ok(executable, 'Set ZOTERO_BIN');
  const root = await mkdtemp('/tmp/rr-transfer-service-'), xpi = process.argv.length === 4 ? process.argv[3] : join(root, 'reference-relationships.xpi');
  if (process.argv.length === 2) await buildProject(projectRoot, xpi);
  const sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  // These labels never cause synchronization; every fixture requires an unsigned-in profile.
  const config: SyncConfig = { groups: { writable: 9000991, restricted: 9000992 }, clients: {} };
  const options = { config, root, executable, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  const common = { xpi, groups: config.groups, marker: `RR native transfer ${randomUUID()}`, sync: false };
  const reports: Record<string, NativeReport> = {};
  await writeFile(join(root, 'artifact.json'), JSON.stringify({ xpi, sha256 }, null, 2));
  for (const role of ['files', 'service', 'service-edges', 'ui', 'mounted']) {
    config.clients[role] = await freshUIClient({ ...options, xpi, groups: config.groups,
      id: manifest.applications.zotero.id, version: manifest.version });
    await writeFile(join(root, `${role}-client.json`), JSON.stringify(config.clients[role], null, 2));
    reports[role] = await nativeJob(options, role, { ...common, action: `transfer:${role}` });
    if (role === 'service') reports.restart = await nativeJob(options, role,
      { ...common, ...reports[role], action: 'transfer:service-restart' });
  }
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, xpi, sha256, reports }, null, 2));
  console.log(JSON.stringify({ ok: true, root, sha256 }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
