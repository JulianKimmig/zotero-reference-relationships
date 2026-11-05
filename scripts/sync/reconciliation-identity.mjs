/** Prepare or verify a genuine first-login profile containing actual production graph authority. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { buildProject, projectRoot } from '../build.mjs';
import { nativeJob, validateConfig } from './run.mjs';
import { freshUIClient } from './fresh-ui.mjs';

/** Seed a fresh native profile, or verify the exact artifact after user-controlled native authentication. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 4, 'Usage: node scripts/sync/reconciliation-identity.mjs seed config.json | verify /absolute/identity.json');
  const mode = process.argv[2]; assert.ok(['seed', 'verify'].includes(mode), 'Expected seed or verify');
  assert.ok(process.env.ZOTERO_BIN, 'Set ZOTERO_BIN');
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  let bundle;
  if (mode === 'seed') {
    const config = JSON.parse(await readFile(process.argv[3], 'utf8')); validateConfig(config);
    const root = await mkdtemp(join(tmpdir(), 'rr-reconciliation-identity-')), xpi = join(root, 'reference-relationships.xpi');
    await buildProject(projectRoot, xpi);
    const sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
    const client = await freshUIClient({ executable: process.env.ZOTERO_BIN, xpi, id: manifest.applications.zotero.id,
      version: manifest.version, updateURL: manifest.applications.zotero.update_url, groups: config.groups,
      controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) });
    bundle = { config, root, xpi, sha256, client, marker: `RR first login ${randomUUID()}` };
  } else {
    assert.ok(isAbsolute(process.argv[3]), 'Use the exact absolute identity bundle path');
    bundle = JSON.parse(await readFile(process.argv[3], 'utf8')); validateConfig(bundle.config);
    assert.equal(createHash('sha256').update(await readFile(bundle.xpi)).digest('hex'), bundle.sha256, 'Identity artifact changed');
  }
  const { config, root, xpi, sha256, client, marker } = bundle; config.clients.identity = client;
  const options = { config, root, executable: process.env.ZOTERO_BIN, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  const report = await nativeJob(options, 'identity', { ...bundle.seed, xpi, groups: config.groups, marker,
    action: mode === 'seed' ? 'reconcile:identity-seed' : 'reconcile:identity-verify' });
  if (mode === 'seed') {
    bundle.seed = report; await writeFile(join(root, 'identity.json'), JSON.stringify(bundle, null, 2));
    console.log(JSON.stringify({ seeded: true, root, profile: client.profile, data: client.data, sha256 }));
  } else {
    await writeFile(join(root, 'verified.json'), JSON.stringify({ ok: true, xpi, sha256, report }, null, 2));
    console.log(JSON.stringify({ ok: true, root, sha256 }));
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
