/** Verify native indexed-read publication and actual second-client retention after a queued write. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { nativeJob, validateConfig } from './run.mjs';

/** Execute production index and restart checks on the existing dedicated store. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/sync/storage-index.mjs config.json');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8')); validateConfig(config);
  assert.ok(process.env.ZOTERO_BIN, 'Set ZOTERO_BIN');
  const root = await mkdtemp(join(tmpdir(), 'rr-production-index-'));
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const options = { config, root, executable: process.env.ZOTERO_BIN,
    updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  const common = { groups: config.groups, sourceURI: new URL('../../src/', import.meta.url).href };
  const indexed = await nativeJob(options, 'a1', { ...common, action: 'storage:index' });
  const received = await nativeJob(options, 'a2', { ...common, ...indexed, action: 'storage:receive' });
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, indexed, received }, null, 2));
  console.log(JSON.stringify({ ok: true, root, head: indexed.currentHead }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
