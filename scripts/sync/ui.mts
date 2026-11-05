/** Build and install the exact XPI, then drive real native relationship creation and restart/removal. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { buildProject, projectRoot } from '../build.mts';
import { nativeJob, validateConfig } from './run.mts';
import { freshUIClient } from './fresh-ui.mts';

/** Run actual installed-artifact GUI journeys on existing dedicated profiles. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/sync/ui.mjs config.json');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8')); validateConfig(config);
  assert.ok(process.env.ZOTERO_BIN, 'Set ZOTERO_BIN');
  const root = await mkdtemp(join(tmpdir(), 'rr-ui-journey-')), xpi = join(root, 'reference-relationships.xpi');
  await buildProject(projectRoot, xpi);
  const hash = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const options = { config, root, executable: process.env.ZOTERO_BIN,
    updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  config.clients.ui = await freshUIClient({ ...options, groups: config.groups, xpi,
    id: manifest.applications.zotero.id, version: manifest.version });
  const common = { groups: config.groups, xpi, sync: false, marker: `RR UI journey ${randomUUID()}` };
  const created = await nativeJob(options, 'ui', { ...common, action: 'ui:create' });
  await writeFile(join(root, 'created.json'), JSON.stringify(created, null, 2));
  const restarted = await nativeJob(options, 'ui', { ...common, ...created, action: 'ui:restart' });
  const permissionKeys = await nativeJob(options, 'a1', { ...common, action: 'ui:permission-fixtures' });
  const permissions = await nativeJob(options, 'b1', { ...common, ...permissionKeys, action: 'ui:permissions' });
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, xpi, sha256: hash, created, restarted, permissions }, null, 2));
  console.log(JSON.stringify({ ok: true, root, sha256: hash }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
