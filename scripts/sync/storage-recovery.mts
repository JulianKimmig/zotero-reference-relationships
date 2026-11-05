/** Verify marker-evasion diagnostics and actual native cache rollback on an existing test store. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { nativeJob, validateConfig } from './run.mts';
import type { NativeReport } from '../contracts.mts';

/** Run focused actual-store recovery checks; mutations are restored or rolled back. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/sync/storage-recovery.mjs config.json');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8')); validateConfig(config);
  assert.ok(process.env.ZOTERO_BIN, 'Set ZOTERO_BIN');
  const root = await mkdtemp(join(tmpdir(), 'rr-production-recovery-'));
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const options = { config, root, executable: process.env.ZOTERO_BIN,
    updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  const reports: Record<string, NativeReport> = {};
  for (const action of ['tamper', 'rollback-cache', 'transaction-guard']) {
    reports[action] = await nativeJob(options, 'a1', { action: `storage:${action}`, groups: config.groups,
      sourceURI: new URL('../../src/', import.meta.url).href });
  }
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, reports }, null, 2));
  console.log(JSON.stringify({ ok: true, root, reports }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
