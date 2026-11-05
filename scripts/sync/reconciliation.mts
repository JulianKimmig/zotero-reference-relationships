/** Install the exact XPI and verify native endpoint resolution/projection before application integration. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { buildProject, projectRoot } from '../build.mts';
import { nativeJob, validateConfig } from './run.mts';
import { freshUIClient } from './fresh-ui.mts';

/** Run actual merge/delete/Undo APIs on an anonymous profile and actual permission reads on signed B. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/sync/reconciliation.mjs config.json');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8')); validateConfig(config);
  assert.ok(process.env.ZOTERO_BIN, 'Set ZOTERO_BIN');
  const root = await mkdtemp(join(tmpdir(), 'rr-reconciliation-')), xpi = join(root, 'reference-relationships.xpi');
  await buildProject(projectRoot, xpi);
  const sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const options = { config, root, executable: process.env.ZOTERO_BIN, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  config.clients.reconciliation = await freshUIClient({ ...options, groups: config.groups, xpi,
    id: manifest.applications.zotero.id, version: manifest.version });
  const common = { xpi, groups: config.groups, marker: `RR lifecycle ${randomUUID()}` };
  const resolved = await nativeJob(options, 'reconciliation', { ...common, action: 'reconcile:resolve' });
  const restarted = await nativeJob(options, 'reconciliation', { ...common, ...resolved, action: 'reconcile:restart' });
  const readonly = await nativeJob(options, 'b1', { ...common, action: 'reconcile:readonly' });
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, xpi, sha256, resolved, restarted, readonly }, null, 2));
  console.log(JSON.stringify({ ok: true, root, sha256 }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
