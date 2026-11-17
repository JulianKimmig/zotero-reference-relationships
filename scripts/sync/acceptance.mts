/** Verify frozen-candidate signed publication, interruptions, branch recovery and restart using explicit durable clients. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeJob, requireClosed, validateConfig } from './run.mts';
import type { NativeOptions, SyncConfig } from '../contracts.mts';
import type { NativeReady, TransferSyncFixture, TransferSyncReport } from '../../tests/sync-controller/transfer-sync-contracts.mts';

/** Parse only explicit locations before performing any filesystem or native work. @param args Ordered CLI arguments. @param executable Explicit environment runtime. @returns Absolute artifact/configuration/runtime locations or an immediate validation error. */
export function parseAcceptanceArguments(args: string[], executable: string | undefined) {
  assert.ok(args.length === 4 && args[0] === '--xpi' && args[2] === '--config', 'Usage: acceptance.mjs --xpi ABS --config ABS');
  assert.ok(isAbsolute(args[1]) && isAbsolute(args[3]), 'Artifact and client configuration must be absolute');
  assert.ok(executable && isAbsolute(executable), 'Set absolute ZOTERO_BIN');
  return { xpi: args[1], configPath: args[3], executable };
}

/** Run each stateful native phase exactly once and retain completed evidence before advancing. @param inputs Explicit frozen artifact, durable configuration and verified native executable. @returns Completion only after all actual native phases pass; failed suites are never replayed automatically. */
export async function runAcceptance(inputs: ReturnType<typeof parseAcceptanceArguments>): Promise<void> {
  const { xpi, configPath, executable } = inputs;
  await access(executable); await access(xpi);
  const config: SyncConfig = JSON.parse(await readFile(configPath, 'utf8')); validateConfig(config);
  assert.deepEqual(config.groups, { writable: 6749379, restricted: 6749388 }, 'Use only the dedicated development groups');
  for (const client of Object.values(config.clients)) await requireClosed(client.profile);
  const root = await mkdtemp(join(tmpdir(), 'rr-product-acceptance-'));
  const sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const options: NativeOptions = { config, root, executable, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  const artifact = { ...inputs, root, sha256 };
  const common = { xpi, groups: config.groups, marker: `RR final signed acceptance ${randomUUID()}`, sync: false };
  const reports: { role: string; action: string; root: string; report: TransferSyncReport }[] = [];
  let fixture: TransferSyncFixture | undefined, forkRule: NativeReady | undefined,
    forkAssertion: NativeReady | undefined, resolved: NativeReady | undefined;

  /** Persist the last accepted complete fixture and every successful native result. @returns Durable progress write. */
  async function progress(): Promise<void> {
    await writeFile(join(root, 'progress.json'), JSON.stringify({ ...artifact, fixture, forkRule, forkAssertion, resolved, reports }, null, 2), { mode: 0o600 });
  }
  /** Bind a dependent fork step to an actual ready native report. @param report Validated native envelope report. @returns Complete ready authority. */
  function ready(report: TransferSyncReport): NativeReady {
    assert.ok(report.state?.state === 'ready', 'Native phase did not return ready authority'); return report.state;
  }
  /** Execute one actual native action, then checkpoint its exact result before another process starts. @param role Dedicated client alias. @param action Existing dispatcher action. @returns Accepted public native report. */
  async function phase(role: string, action: string): Promise<TransferSyncReport> {
    assert.equal(createHash('sha256').update(await readFile(xpi)).digest('hex'), sha256, 'Frozen candidate changed');
    const phaseRoot = join(root, `${String(reports.length + 1).padStart(2, '0')}-${role}-${action.replaceAll(':', '-')}`);
    await mkdir(phaseRoot);
    const report = await nativeJob<TransferSyncReport>({ ...options, root: phaseRoot }, role,
      { ...common, action, transferFixture: fixture, forkRule, forkAssertion, resolved });
    reports.push({ role, action, root: phaseRoot, report });
    if (report.fixture !== undefined) fixture = report.fixture;
    if (action === 'transfer:sync-fork-rule') forkRule = ready(report);
    if (action === 'transfer:sync-fork-assertion') forkAssertion = ready(report);
    if (action === 'transfer:sync-fork-resolve') { assert.equal(report.applicationResolution, true); resolved = ready(report); }
    await progress(); return report;
  }

  await writeFile(join(root, 'artifact.json'), JSON.stringify(artifact, null, 2), { flag: 'wx', mode: 0o600 });
  await progress();
  try {
    for (const role of ['a1', 'a2', 'b1']) {
      const report = await phase(role, 'transfer:sync-inspect');
      assert.equal(report.userID, role === 'b1' ? 22463893 : 22463862);
      assert.ok(report.state?.state === 'ready' || report.state?.state === 'uninitialized', 'Existing shared authority requires explicit recovery first');
    }
    assert.equal((await phase('a1', 'transfer:sync-baseline')).fixture?.kind, 'baseline');
    for (const role of ['a2', 'b1']) await phase(role, 'transfer:sync-ready');
    assert.equal((await phase('a1', 'transfer:sync-upload-partial')).fixture?.kind, 'generation');
    await phase('a2', 'transfer:sync-pending');
    await phase('a2', 'transfer:sync-pending-restart');
    await phase('a1', 'transfer:sync-upload-complete');
    for (const role of ['a2', 'b1']) await phase(role, 'transfer:sync-ready');
    await phase('a1', 'transfer:sync-download-publish');
    await phase('a2', 'transfer:sync-download-interrupt');
    await phase('a2', 'transfer:sync-download-restart');
    for (const role of ['a2', 'b1']) await phase(role, 'transfer:sync-ready');
    await phase('a1', 'transfer:sync-fork-rule');
    await phase('a2', 'transfer:sync-fork-assertion');
    assert.notEqual(forkRule?.head, forkAssertion?.head);
    await phase('a1', 'transfer:sync-fork-publish-rule');
    await phase('a2', 'transfer:sync-fork-publish-assertion');
    for (const role of ['a1', 'b1']) await phase(role, 'transfer:sync-fork-conflict');
    await phase('a1', 'transfer:sync-fork-resolve');
    for (const role of ['a2', 'b1']) await phase(role, 'transfer:sync-fork-ready');
    await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, ...artifact, fixture, forkRule, forkAssertion, resolved, reports }, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ ok: true, root, sha256, phases: reports.length }));
  } catch (error) {
    await writeFile(join(root, 'result.json'), JSON.stringify({ ok: false, ...artifact, fixture, forkRule, forkAssertion, resolved, reports,
      error: error instanceof Error ? error.message : String(error), replayed: false }, null, 2), { flag: 'wx', mode: 0o600 }); throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => runAcceptance(parseAcceptanceArguments(process.argv.slice(2), process.env.ZOTERO_BIN)))
    .catch(error => { console.error(error instanceof Error ? error.message : 'Acceptance failed'); process.exitCode = 1; });
}
