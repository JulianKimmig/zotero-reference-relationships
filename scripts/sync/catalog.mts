/** Build/hash a production XPI and verify custom catalog forms, migration and restart on actual Zotero. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { buildProject, projectRoot } from '../build.mts';
import { nativeJob, validateConfig } from './run.mts';
import { freshUIClient } from './fresh-ui.mts';

/** Run pure/native-backed catalog acceptance without reading authentication. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/sync/catalog.mjs config.json');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8')); validateConfig(config);
  assert.ok(process.env.ZOTERO_BIN, 'Set ZOTERO_BIN');
  const root = await mkdtemp(join(tmpdir(), 'rr-catalog-journey-')), xpi = join(root, 'reference-relationships.xpi');
  await buildProject(projectRoot, xpi);
  const sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const options = { config, root, executable: process.env.ZOTERO_BIN,
    updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  config.clients.catalog = await freshUIClient({ ...options, groups: config.groups, xpi,
    id: manifest.applications.zotero.id, version: manifest.version });
  const common = { xpi, groups: config.groups, marker: `RR catalog ${randomUUID()}` };
  const created = await nativeJob(options, 'catalog', { ...common, action: 'catalog:create' });
  await writeFile(join(root, 'created.json'), JSON.stringify(created, null, 2));
  const restarted = await nativeJob(options, 'catalog', { ...common, ...created, action: 'catalog:restart' });
  const permissions = await nativeJob(options, 'b1', { ...common, action: 'catalog:permissions' });
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, sha256, xpi, created, restarted, permissions }, null, 2));
  console.log(JSON.stringify({ ok: true, root, sha256 }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
