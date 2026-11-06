/** Verify concurrent real imports from a common head and preserve both reviewed changes through explicit native resolution. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeJob, validateConfig } from './run.mts';
import type { NativeOptions, SyncConfig } from '../contracts.mts';
import type { GenerationFixture, NativeReady } from '../../tests/sync-controller/transfer-sync-contracts.mts';

/** Controlled fork evidence contains validated actual state plus public behavior flags. */
interface ForkReport { state: NativeReady | { state: 'conflict'; heads: string[] }; [key: string]: unknown }

/** Continue from successful complete-server recovery; never replay an interrupted mutation suite. @returns {Promise<void>} */
async function main(): Promise<void> {
  assert.ok(process.argv.length === 3 && isAbsolute(process.argv[2]), 'Usage: node transfer-forks.mjs /absolute/successful-download-result.json');
  const previous = JSON.parse(await readFile(process.argv[2], 'utf8'));
  assert.equal(previous.ok, true); assert.equal(previous.fixture.kind, 'generation');
  const executable = process.env.ZOTERO_BIN; assert.ok(executable && isAbsolute(executable), 'Set absolute ZOTERO_BIN');
  const xpi: string = previous.xpi, runtimeRoot: string = previous.runtimeRoot;
  assert.ok(isAbsolute(xpi) && isAbsolute(runtimeRoot));
  assert.equal(createHash('sha256').update(await readFile(xpi)).digest('hex'), previous.sha256, 'Verified artifact changed');
  const root = await mkdtemp('/tmp/rr-transfer-forks-'), fixture: GenerationFixture = previous.fixture;
  const config: SyncConfig = { groups: { writable: 6749379, restricted: 6749388 }, clients: {} };
  for (const [role, name] of [['a1', 'sync-a'], ['a2', 'sync-a2'], ['b1', 'sync-b']] as const) {
    config.clients[role] = { profile: join(runtimeRoot, name, 'profile'), data: join(runtimeRoot, name, 'data') };
  }
  validateConfig(config);
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const options: NativeOptions = { config, root, executable, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  let forkRule: NativeReady | undefined, forkAssertion: NativeReady | undefined, resolved: NativeReady | undefined;
  const reports: { role: string; action: string; report: ForkReport }[] = [];
  const common = { xpi, groups: config.groups, marker: 'RR concurrent rule/assertion imports', sync: false };
  const artifact = { xpi, sha256: previous.sha256, runtimeRoot, previous: process.argv[2] };

  /** Execute and preserve one clean native result before advancing to a dependent client mutation. @param {string} role Dedicated client. @param {string} action Exact phase. @returns {Promise<object>} Actual native report. */
  async function phase(role: string, action: string): Promise<ForkReport> {
    assert.equal(createHash('sha256').update(await readFile(xpi)).digest('hex'), previous.sha256, 'Selected artifact changed');
    const phaseRoot = join(root, `${reports.length + 1}-${role}`); await mkdir(phaseRoot);
    const report = await nativeJob<ForkReport>({ ...options, root: phaseRoot }, role,
      { ...common, action, transferFixture: fixture, forkRule, forkAssertion, resolved });
    reports.push({ role, action, report });
    await writeFile(join(root, 'progress.json'), JSON.stringify({ ...artifact, fixture, forkRule, forkAssertion, resolved, reports }, null, 2));
    return report;
  }

  await writeFile(join(root, 'artifact.json'), JSON.stringify(artifact, null, 2));
  try {
    const first = await phase('a1', 'transfer:sync-fork-rule');
    assert.equal(first.state.state, 'ready'); forkRule = first.state as NativeReady;
    const second = await phase('a2', 'transfer:sync-fork-assertion');
    assert.equal(second.state.state, 'ready'); forkAssertion = second.state as NativeReady;
    assert.notEqual(forkRule.head, forkAssertion.head);
    await phase('a1', 'transfer:sync-fork-publish-rule');
    await phase('a2', 'transfer:sync-fork-publish-assertion');
    await phase('a1', 'transfer:sync-fork-conflict');
    await phase('b1', 'transfer:sync-fork-conflict');
    const cleanup = await phase('a1', 'transfer:sync-fork-resolve');
    assert.equal(cleanup.state.state, 'ready'); resolved = cleanup.state as NativeReady;
    await phase('a2', 'transfer:sync-fork-ready');
    await phase('b1', 'transfer:sync-fork-ready');
    await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, ...artifact, fixture, forkRule, forkAssertion, resolved, reports }, null, 2));
    console.log(JSON.stringify({ ok: true, root, sha256: previous.sha256 }));
  } catch (error) {
    await writeFile(join(root, 'result.json'), JSON.stringify({ ok: false, ...artifact, fixture, forkRule, forkAssertion, resolved, reports,
      error: error instanceof Error ? error.message : String(error), replayed: false }, null, 2));
    throw error;
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
