/** Verify complete transfer projections against real trashed, erased, unsupported and merged items, then restart. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { buildProject, projectRoot } from '../build.mjs';
import { nativeJob, validateConfig } from './run.mjs';
import { freshUIClient } from './fresh-ui.mjs';

/** Run owned anonymous native fixtures with sync disabled; inspect original saved authority after an independent restart. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/sync/transfer-review.mjs config.json');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8')); validateConfig(config);
  assert.ok(process.env.ZOTERO_BIN, 'Set ZOTERO_BIN');
  const root = await mkdtemp(join(tmpdir(), 'rr-transfer-review-')), xpi = join(root, 'reference-relationships.xpi');
  await buildProject(projectRoot, xpi); const sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const options = { config, root, executable: process.env.ZOTERO_BIN, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  config.clients.transfer = await freshUIClient({ ...options, groups: config.groups, xpi,
    id: manifest.applications.zotero.id, version: manifest.version });
  const common = { xpi, groups: config.groups, marker: `RR native transfer review ${randomUUID()}` };
  const reviewed = await nativeJob(options, 'transfer', { ...common, action: 'transfer:review' });
  const restarted = await nativeJob(options, 'transfer', { ...common, ...reviewed, action: 'transfer:review-restart' });
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, xpi, sha256, reviewed, restarted }, null, 2));
  console.log(JSON.stringify({ ok: true, root, sha256 }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
