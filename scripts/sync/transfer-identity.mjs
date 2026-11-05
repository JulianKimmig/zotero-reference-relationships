/** Exercise transfer owner identity on one anonymous client/restart and the two real dedicated accounts. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { buildProject, projectRoot } from '../build.mjs';
import { nativeJob, validateConfig } from './run.mjs';
import { freshUIClient } from './fresh-ui.mjs';

/** Build/hash one production artifact and inspect only public account/group identities; never copy authentication. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/sync/transfer-identity.mjs config.json');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8')); validateConfig(config);
  assert.ok(process.env.ZOTERO_BIN, 'Set ZOTERO_BIN');
  const root = await mkdtemp(join(tmpdir(), 'rr-transfer-identity-')), xpi = join(root, 'reference-relationships.xpi');
  await buildProject(projectRoot, xpi); const sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const options = { config, root, executable: process.env.ZOTERO_BIN, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  config.clients.transfer = await freshUIClient({ ...options, groups: config.groups, xpi,
    id: manifest.applications.zotero.id, version: manifest.version });
  const common = { xpi, groups: config.groups, marker: `RR transfer identity ${randomUUID()}` };
  const anonymous = await nativeJob(options, 'transfer', { ...common, action: 'transfer:identity' });
  const restarted = await nativeJob(options, 'transfer', { ...common, ...anonymous, action: 'transfer:identity-restart' });
  const signedA = await nativeJob(options, 'a1', { ...common, action: 'transfer:identity-signed' });
  const signedB = await nativeJob(options, 'b1', { ...common, action: 'transfer:identity-signed' });
  assert.notDeepEqual(signedA.signedOwner, signedB.signedOwner, 'Dedicated accounts must have distinct export owners');
  assert.deepEqual(signedA.shared, signedB.shared, 'Shared group identity must agree across actual accounts');
  assert.deepEqual(signedA.restricted, signedB.restricted, 'Read-only group identity must agree across accounts');
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, xpi, sha256, anonymous, restarted, signedA, signedB }, null, 2));
  console.log(JSON.stringify({ ok: true, root, sha256 }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
