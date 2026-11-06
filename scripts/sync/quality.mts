/** Measure the exact supplied production XPI in unsigned-in native profiles without rebuilding or accessing signed accounts. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { nativeJob } from './run.mts';
import { freshUIClient } from './fresh-ui.mts';
import { graphFixture, assertion } from '../../tests/fixtures/graph-contract.mts';
import { qualityGraph } from '../../tests/fixtures/quality-workloads.mts';
import type { QualityWorkload } from '../../tests/sync-controller/quality-performance.sys.mts';
import type { SyncConfig } from '../contracts.mts';

/** Validate explicit CLI boundaries and retain actual timing/environment evidence from one immutable artifact. @returns {Promise<void>} */
async function main(): Promise<void> {
  assert.ok(process.argv.length === 4 && process.argv[2] === '--xpi' && isAbsolute(process.argv[3]),
    'Usage: node quality.mjs --xpi /absolute/existing.xpi');
  const executable = process.env.ZOTERO_BIN;
  assert.ok(executable && isAbsolute(executable), 'Set absolute ZOTERO_BIN');
  const xpi = process.argv[3], sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const root = await mkdtemp('/tmp/rr-quality-'), groups = { writable: 9000991, restricted: 9000992 };
  const config: SyncConfig = { groups, clients: {} };
  const options = { root, config, executable, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  const environment = { platform: platform(), architecture: arch(), kernel: release(), cpu: cpus()[0]?.model,
    logicalCPUs: cpus().length, totalMemoryBytes: totalmem(), node: process.version };
  const workloads = [10, 100, 1000].map(count => graphFixture({ assertions: Array.from({ length: count }, (_, index) => assertion({
    id: `root-${index}`, source: { library: 'self', key: `A${String(index).padStart(7, '0')}` },
  })) }));
  const qualityWorkloads: QualityWorkload[] = [];
  for (const shape of ['sparse', 'cycle'] as const) for (const count of [10, 100, 1000]) qualityWorkloads.push({ shape, graph: qualityGraph(shape, count) });
  for (const shape of ['dense', 'over-limit'] as const) qualityWorkloads.push({ shape, graph: qualityGraph(shape, 1000) });
  await writeFile(`${root}/artifact.json`, JSON.stringify({ xpi, sha256, environment }, null, 2));
  config.clients.pure = await freshUIClient({ ...options, xpi, groups, id: manifest.applications.zotero.id, version: manifest.version });
  await writeFile(`${root}/pure-client.json`, JSON.stringify(config.clients.pure, null, 2));
  const report = await nativeJob(options, 'pure', { xpi, groups, sync: false, action: 'quality:pure', marker: 'Native quality baseline', workloads, qualityWorkloads });
  assert.equal(createHash('sha256').update(await readFile(xpi)).digest('hex'), sha256, 'Measured artifact changed');
  await writeFile(`${root}/result.json`, JSON.stringify({ ok: true, xpi, sha256, environment, report }, null, 2));
  console.log(JSON.stringify({ ok: true, root, sha256 }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
