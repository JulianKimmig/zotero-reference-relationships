/** Verify a genuinely pre-login fixture after the user performs first account sync. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { nativeJob, validateConfig } from './run.mts';

/** Validate account assignment, immutable metadata and actual second-client transfer. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 5, 'Usage: node scripts/sync/identity.mjs config.json prelogin-result.json sync-gate-result.json');
  const executable = process.env.ZOTERO_BIN;
  assert.ok(executable, 'Set ZOTERO_BIN');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
  validateConfig(config);
  assert.ok(config.clients.prelogin, 'Prepared prelogin fixture profile is required');
  const seeded = JSON.parse(await readFile(process.argv[3], 'utf8'));
  assert.equal(seeded.ok, true);
  assert.equal(seeded.report.beforeUserID, null, 'Fixture was not created before sign-in');
  const baseline = JSON.parse(await readFile(process.argv[4], 'utf8'));
  assert.equal(baseline.ok, true);
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const root = await mkdtemp(join(tmpdir(), 'rr-identity-feasibility-'));
  const options = { config, root, executable, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  const job = { ...seeded.report, groups: config.groups, action: 'feasibility:identity-verify',
    expectedUserID: baseline.reports.a1.userID };
  const firstSync = await nativeJob(options, 'prelogin', job);
  const secondClient = await nativeJob(options, 'a2', job);
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, firstSync, secondClient }, null, 2));
  console.log(JSON.stringify({ ok: true, root, noteKey: seeded.report.noteKey }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
