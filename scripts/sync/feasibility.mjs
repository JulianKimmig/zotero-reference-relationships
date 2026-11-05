/** Run real editor preservation and cross-client retrieval after sync prerequisites pass. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { nativeJob, validateConfig } from './run.mjs';

/** Build explicit experiment options and run native assertions. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/sync/feasibility.mjs /absolute/sync-config.json');
  const executable = process.env.ZOTERO_BIN;
  assert.ok(executable, 'Set ZOTERO_BIN');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
  validateConfig(config);
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const root = await mkdtemp(join(tmpdir(), 'rr-storage-feasibility-'));
  const options = { config, root, executable, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  const common = { groups: config.groups, marker: `RR storage feasibility ${randomUUID()}` };
  const editor = await nativeJob(options, 'a1', { ...common, action: 'feasibility:editor' });
  const received = await nativeJob(options, 'a2', { ...common, ...editor, action: 'feasibility:verify-editor' });
  const lifecycle = await nativeJob(options, 'a1', { ...common, action: 'feasibility:lifecycle' });
  const restarted = await nativeJob(options, 'a2', { ...common, ...lifecycle, action: 'feasibility:verify-lifecycle' });
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, editor, received, lifecycle, restarted }, null, 2));
  console.log(JSON.stringify({ ok: true, root, noteKey: editor.noteKey }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
