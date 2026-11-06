/** Run bounded signed baseline/upload acceptance against an explicitly supplied existing XPI and dedicated closed clients. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeJob, validateConfig } from './run.mts';
import type { NativeOptions, SyncConfig } from '../contracts.mts';
import type { TransferSyncFixture, TransferSyncReport } from '../../tests/sync-controller/transfer-sync-contracts.mts';

/** One persisted native phase retains role/action and its complete public report. */
interface PhaseEvidence { role: string; action: string; root: string; report: TransferSyncReport }

/**
 * Run each explicit phase once; stop at the first process, protocol, readiness or persistence failure.
 * @param xpi Absolute existing production XPI; never rebuilt or rewritten.
 * @param runtimeRoot Absolute dedicated signed test environment containing sync-a, sync-a2 and sync-b.
 * @param executable Absolute verified Zotero executable, supplied explicitly by the caller.
 * @returns Completion after actual native acceptance; every prior successful phase remains persisted on failure.
 */
export async function runTransferSync(xpi: string, runtimeRoot: string, executable: string): Promise<void> {
  assert.ok(isAbsolute(xpi) && isAbsolute(runtimeRoot) && isAbsolute(executable), 'XPI, runtime root and executable must be absolute');
  const root = await mkdtemp('/tmp/rr-transfer-sync-');
  const sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const config: SyncConfig = { groups: { writable: 6749379, restricted: 6749388 }, clients: {} };
  for (const [role, name] of [['a1', 'sync-a'], ['a2', 'sync-a2'], ['b1', 'sync-b']] as const) {
    config.clients[role] = { profile: join(runtimeRoot, name, 'profile'), data: join(runtimeRoot, name, 'data') };
  }
  validateConfig(config);
  const manifest: { applications: { zotero: { update_url: string } } } = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  assert.equal(new URL(manifest.applications.zotero.update_url).protocol, 'https:', 'Actual HTTPS update URL required');
  const options: NativeOptions = { config, root, executable, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  const artifact = { root, runtimeRoot, xpi, sha256 };
  await writeFile(join(root, 'artifact.json'), JSON.stringify(artifact, null, 2), { flag: 'wx', mode: 0o600 });
  const common = { xpi, groups: config.groups, marker: `RR signed transfer ${randomUUID()}`, sync: false };
  const reports: PhaseEvidence[] = [];
  let fixture: TransferSyncFixture | undefined;

  /** Save every successful report and the latest captured fixture before scheduling another native process. @returns Durable suite progress file. */
  async function progress(): Promise<void> {
    await writeFile(join(root, 'progress.json'), JSON.stringify({ ...artifact, fixture, reports }, null, 2), { mode: 0o600 });
  }

  /** Execute a single actual native action with immutable artifact binding and its own nonoverlapping evidence directory. @param role Dedicated client alias. @param action Exact dispatcher action. @returns Validated public native report. */
  async function phase(role: string, action: string): Promise<TransferSyncReport> {
    assert.equal(createHash('sha256').update(await readFile(xpi)).digest('hex'), sha256, 'The selected production XPI changed during this suite');
    const phaseRoot = join(root, `${String(reports.length + 1).padStart(2, '0')}-${role}-${action.replaceAll(':', '-')}`);
    await mkdir(phaseRoot);
    const report = await nativeJob<TransferSyncReport>({ ...options, root: phaseRoot }, role,
      { ...common, action, ...(fixture === undefined ? {} : { transferFixture: fixture }) });
    reports.push({ role, action, root: phaseRoot, report });
    if (report.fixture !== undefined) fixture = report.fixture;
    await progress(); return report;
  }

  await progress();
  try {
    for (const role of ['a1', 'a2', 'b1']) {
      const report = await phase(role, 'transfer:sync-inspect');
      assert.equal(report.userID, role === 'b1' ? 22463893 : 22463862, `Unexpected dedicated account for ${role}`);
      assert.equal(report.scope, 'group:6749379', 'Preflight selected a different development group');
      assert.ok(report.state?.state === 'ready' || report.state?.state === 'uninitialized', 'Preflight found incomplete/conflicting shared authority');
    }
    const baseline = await phase('a1', 'transfer:sync-baseline');
    assert.equal(baseline.fixture?.kind, 'baseline', 'Baseline action did not return its exact captured fixture');
    await phase('a2', 'transfer:sync-ready');
    await phase('b1', 'transfer:sync-ready');
    const partial = await phase('a1', 'transfer:sync-upload-partial');
    assert.equal(partial.fixture?.kind, 'generation', 'Upload interruption did not return its recoverable actual generation');
    await phase('a2', 'transfer:sync-pending');
    await phase('a2', 'transfer:sync-pending-restart');
    await phase('a1', 'transfer:sync-upload-complete');
    await phase('a2', 'transfer:sync-ready');
    await phase('b1', 'transfer:sync-ready');
    await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, ...artifact, fixture, reports,
      baselineAndUploadOnly: true }, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ ok: true, root, sha256, baselineAndUploadOnly: true }));
  } catch (error) {
    await writeFile(join(root, 'result.json'), JSON.stringify({ ok: false, ...artifact, fixture, reports,
      error: error instanceof Error ? error.message : String(error), replayed: false }, null, 2), { flag: 'wx', mode: 0o600 });
    throw error;
  }
}

/** Parse only explicit artifact/environment inputs; existing nativeJob enforces closed-profile ownership when execution is requested. @returns Suite completion. */
async function main(): Promise<void> {
  assert.equal(process.argv.length, 6, 'Usage: transfer-sync.mjs --xpi /absolute/existing.xpi --runtime-root /absolute/dedicated-runtime');
  assert.equal(process.argv[2], '--xpi'); assert.equal(process.argv[4], '--runtime-root');
  const executable = process.env.ZOTERO_BIN; assert.ok(executable, 'Set ZOTERO_BIN to the actual native executable');
  await runTransferSync(process.argv[3], process.argv[5], executable);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
