/** Verify native cross-library copying and local-only group removal on a single production artifact. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { buildProject, projectRoot } from '../build.mts';
import { nativeJob, validateConfig } from './run.mts';
import { freshUIClient } from './fresh-ui.mts';

/** Create one unsigned native client and test local groups only, without syncing or modifying server membership. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/sync/reconciliation-libraries.mjs config.json');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8')); validateConfig(config);
  assert.ok(process.env.ZOTERO_BIN, 'Set ZOTERO_BIN');
  const root = await mkdtemp(join(tmpdir(), 'rr-reconciliation-libraries-')), xpi = join(root, 'reference-relationships.xpi');
  await buildProject(projectRoot, xpi); const sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const options = { config, root, executable: process.env.ZOTERO_BIN, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  config.clients.libraries = await freshUIClient({ ...options, groups: config.groups, xpi,
    id: manifest.applications.zotero.id, version: manifest.version });
  const common = { xpi, groups: config.groups, marker: `RR library lifecycle ${randomUUID()}` };
  const copied = await nativeJob(options, 'libraries', { ...common, action: 'reconcile:libraries-copy' });
  const removed = await nativeJob(options, 'libraries', { ...common, ...copied, action: 'reconcile:libraries-remove' });
  const disabled = await nativeJob(options, 'libraries', { ...common, ...copied, action: 'reconcile:libraries-disabled' });
  const pending = await nativeJob(options, 'libraries', { ...common, ...copied, action: 'reconcile:libraries-pending' });
  const restarted = await nativeJob(options, 'libraries', { ...common, ...copied, action: 'reconcile:libraries-restart' });
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, xpi, sha256, copied, removed, disabled, pending, restarted }, null, 2));
  console.log(JSON.stringify({ ok: true, root, sha256 }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
