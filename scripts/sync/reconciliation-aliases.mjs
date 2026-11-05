/** Verify unknown native alias inspection and explicit repair using a single hashed production XPI. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { buildProject, projectRoot } from '../build.mjs';
import { nativeJob, validateConfig } from './run.mjs';
import { freshUIClient } from './fresh-ui.mjs';

/** Drive actual native aliases, repair controls and restart in an isolated anonymous profile. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/sync/reconciliation-aliases.mjs config.json');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8')); validateConfig(config);
  assert.ok(process.env.ZOTERO_BIN, 'Set ZOTERO_BIN');
  const root = await mkdtemp(join(tmpdir(), 'rr-reconciliation-aliases-')), xpi = join(root, 'reference-relationships.xpi');
  await buildProject(projectRoot, xpi);
  const sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const options = { config, root, executable: process.env.ZOTERO_BIN, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  config.clients.alias = await freshUIClient({ ...options, groups: config.groups, xpi,
    id: manifest.applications.zotero.id, version: manifest.version });
  const common = { xpi, groups: config.groups, marker: `RR alias repair ${randomUUID()}` };
  const repaired = await nativeJob(options, 'alias', { ...common, action: 'reconcile:alias-ui' });
  const restarted = await nativeJob(options, 'alias', { ...common, ...repaired, action: 'reconcile:alias-ui-restart' });
  const bulk = await nativeJob(options, 'alias', { ...common, action: 'reconcile:bulk-ui' });
  const edges = await nativeJob(options, 'alias', { ...common, action: 'reconcile:bulk-edges' });
  const final = await nativeJob(options, 'alias', { ...common, ...repaired, ...edges, action: 'reconcile:alias-ui-final' });
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, xpi, sha256, repaired, restarted, bulk, edges, final }, null, 2));
  console.log(JSON.stringify({ ok: true, root, sha256 }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
