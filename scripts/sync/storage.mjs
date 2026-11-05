/** Exercise actual production note persistence, stale writers, rollback and backup/restart. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { nativeJob, validateConfig } from './run.mjs';

/** Run explicit native conformance steps, retaining actual backup bytes between processes. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/sync/storage.mjs config.json');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8')); validateConfig(config);
  assert.ok(process.env.ZOTERO_BIN, 'Set ZOTERO_BIN');
  const root = await mkdtemp(join(tmpdir(), 'rr-production-storage-'));
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const options = { config, root, executable: process.env.ZOTERO_BIN,
    updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  const common = { groups: config.groups, marker: `RR storage conformance ${randomUUID()}`,
    sourceURI: new URL('../../src/', import.meta.url).href };
  const exercised = await nativeJob(options, 'a1', { ...common, action: 'storage:exercise' });
  await writeFile(join(root, 'snapshot-backup.json'), JSON.stringify(exercised.original));
  const received = await nativeJob(options, 'a2', { ...common, ...exercised, action: 'storage:receive' });
  const backup = JSON.parse(await readFile(join(root, 'snapshot-backup.json'), 'utf8'));
  const restored = await nativeJob(options, 'a1', { ...common, ...exercised, original: backup, action: 'storage:restore' });
  const restarted = await nativeJob(options, 'a2', { ...common, ...restored, action: 'storage:receive' });
  const permission = await nativeJob(options, 'b1', { ...common, ...exercised, action: 'storage:permission' });
  const unknown = await nativeJob(options, 'a1', { ...common, ...exercised, action: 'storage:unknown' });
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, exercised, received, restored, restarted, permission, unknown }, null, 2));
  console.log(JSON.stringify({ ok: true, root, head: restored.currentHead }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
