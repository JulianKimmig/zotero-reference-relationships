/** Extend a verified shared-library upload fixture with a complete-server download interruption and restart recovery. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeJob, validateConfig } from './run.mts';
import type { NativeOptions, SyncConfig } from '../contracts.mts';
import type { GenerationFixture, TransferSyncReport } from '../../tests/sync-controller/transfer-sync-contracts.mts';

/** Continue only from a successful exact artifact/fixture, without replaying earlier mutations. @returns {Promise<void>} */
async function main(): Promise<void> {
  assert.ok(process.argv.length === 3 && isAbsolute(process.argv[2]), 'Usage: node transfer-download.mjs /absolute/successful-upload-result.json');
  const previous = JSON.parse(await readFile(process.argv[2], 'utf8'));
  assert.equal(previous.ok, true); assert.equal(previous.fixture.kind, 'generation');
  const executable = process.env.ZOTERO_BIN; assert.ok(executable && isAbsolute(executable), 'Set absolute ZOTERO_BIN');
  const xpi: string = previous.xpi, runtimeRoot: string = previous.runtimeRoot;
  assert.ok(isAbsolute(xpi) && isAbsolute(runtimeRoot));
  assert.equal(createHash('sha256').update(await readFile(xpi)).digest('hex'), previous.sha256, 'Verified artifact changed');
  const root = await mkdtemp('/tmp/rr-transfer-download-');
  const config: SyncConfig = { groups: { writable: 6749379, restricted: 6749388 }, clients: {} };
  for (const [role, name] of [['a1', 'sync-a'], ['a2', 'sync-a2'], ['b1', 'sync-b']] as const) {
    config.clients[role] = { profile: join(runtimeRoot, name, 'profile'), data: join(runtimeRoot, name, 'data') };
  }
  validateConfig(config);
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const options: NativeOptions = { config, root, executable, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  let fixture: GenerationFixture = previous.fixture;
  const reports: { role: string; action: string; report: TransferSyncReport }[] = [];
  const common = { xpi, groups: config.groups, marker: 'RR complete-server download interruption', sync: false };

  /** Persist each clean native phase before advancing, retaining the last complete fixture on any failure. @param {string} role Dedicated signed client. @param {string} action Exact controlled phase. @returns {Promise<void>} */
  async function phase(role: string, action: string): Promise<void> {
    const phaseRoot = join(root, `${reports.length + 1}-${role}`); await mkdir(phaseRoot);
    const report = await nativeJob<TransferSyncReport>({ ...options, root: phaseRoot }, role, { ...common, action, transferFixture: fixture });
    if (report.fixture !== undefined) { assert.equal(report.fixture.kind, 'generation'); fixture = report.fixture as GenerationFixture; }
    reports.push({ role, action, report });
    await writeFile(join(root, 'progress.json'), JSON.stringify({ fixture, reports }, null, 2));
  }

  const artifact = { xpi, sha256: previous.sha256, runtimeRoot, previous: process.argv[2] };
  await writeFile(join(root, 'artifact.json'), JSON.stringify(artifact, null, 2));
  try {
    await phase('a1', 'transfer:sync-download-publish');
    await phase('a2', 'transfer:sync-download-interrupt');
    await phase('a2', 'transfer:sync-download-restart');
    await phase('a2', 'transfer:sync-ready');
    await phase('b1', 'transfer:sync-ready');
    await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, ...artifact, fixture, reports }, null, 2));
    console.log(JSON.stringify({ ok: true, root, sha256: previous.sha256 }));
  } catch (error) {
    await writeFile(join(root, 'result.json'), JSON.stringify({ ok: false, ...artifact, fixture, reports,
      error: error instanceof Error ? error.message : String(error), replayed: false }, null, 2));
    throw error;
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
