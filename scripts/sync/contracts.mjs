/** Establish native contract-validation baselines on explicit portable graph workloads. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { nativeJob, validateConfig } from './run.mjs';
import { graphFixture, assertion } from '../../tests/fixtures/graph-contract.mjs';

/** Execute actual v1 validation in a native compartment and retain measurements. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/sync/contracts.mjs config.json');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
  validateConfig(config);
  assert.ok(process.env.ZOTERO_BIN, 'Set ZOTERO_BIN');
  const workloads = [10, 100, 1000].map(count => graphFixture({
    assertions: Array.from({ length: count }, (_, index) => assertion({ id: `root-${index}`,
      source: { library: 'self', key: `A${String(index).padStart(7, '0')}` } })),
  }));
  const root = await mkdtemp(join(tmpdir(), 'rr-contract-baseline-'));
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const report = await nativeJob({ config, root, executable: process.env.ZOTERO_BIN,
    updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) }, 'a1',
  { action: 'contracts:baseline', groups: config.groups,
    domainURI: new URL('../../src/domain/', import.meta.url).href, workloads });
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, report }, null, 2));
  console.log(JSON.stringify({ ok: true, root, results: report.results }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
