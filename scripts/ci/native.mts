/** Portable anonymous native qualification of immutable archives, with separate fresh and migration profiles. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, lstat, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifact, stable } from './artifacts.mts';
import { parseNativeArguments, requireBaseline, validatePhase, requireUpgrade, validateInstalledHash } from './contract.mts';
import { createClient, runJob } from './client.mts';
import type { CIClient } from './client.mts';
import type { ReleaseJob, ReleaseRoundtripReport, ReleaseRestartReport, ReleaseSeedReport } from '../../tests/sync-controller/ci-release.sys.mts';

/** Run real native hosts after caller provisioning; source compilation and runtime downloads belong to the caller. @returns Completion after exclusive success receipt publication. */
export async function main(): Promise<void> {
  const args = parseNativeArguments(process.argv.slice(2));
  assert.ok(['linux', 'win32', 'darwin'].includes(process.platform) && process.arch === 'x64', 'Native acceptance requires Linux, Windows or macOS x64');
  await access(args.executable); if (args.previousRuntime) await access(args.previousRuntime);
  requireBaseline(args.previousXPI, '0.1.0');
  const current = await artifact(args.xpi), previous = args.previousXPI ? await artifact(args.previousXPI) : null;
  if (previous) {
    assert.notEqual(current.sha256, previous.sha256, 'Artifacts must differ'); requireUpgrade(previous.version, current.version);
  }
  const root = await mkdtemp(join(tmpdir(), 'rr-ci-native-')), result = args.result ?? join(root, 'result.json');
  await access(dirname(result));
  await assert.rejects(lstat(result), { code: 'ENOENT' }, 'Receipt must not already exist');
  const inputs = previous ? [current, previous] : [current];
  const completed: string[] = [];
  const common: ReleaseJob = { action: '', xpi: current.xpi, currentVersion: current.version, currentSHA256: current.sha256,
    groups: { writable: 1, restricted: 2 }, marker: `RR CI ${randomUUID()}` };
  /** Record progress while rechecking immutable inputs. @param phase Next native operation. @returns Durable partial progress. */
  async function progress(phase: string): Promise<void> {
    await stable(inputs);
    await writeFile(join(root, 'progress.json'), JSON.stringify({ phase, completed, artifacts: { current, previous } }, null, 2), { mode: 0o600 });
  }
  /** Initialize one new profile with the chosen real host. @param client Owned profile. @param host Actual executable. @param version Expected resolved version. @param role Evidence label. @returns Real anonymous initialization proof. */
  async function initialize(client: CIClient, host: string, version: string, role: string) {
    await progress(`${role}:initialize`);
    const initialized = await runJob<{ anonymous: boolean }>(client, host, version, { ...common, action: 'ci-release:initialize' });
    assert.equal(initialized.report.anonymous, true); completed.push(`${role}:initialize`); return initialized;
  }
  /** Prove an independent target process starts the persistent current addon and preserves the fixture. @param client Retained profile. @param roundtrip Complete prior lifecycle. @param role Evidence label. @returns Native automatic startup proof. */
  async function restart(client: CIClient, roundtrip: ReleaseRoundtripReport, role: string) {
    await progress(`${role}:restart`);
    const observed = await runJob<ReleaseRestartReport>(client, args.executable, args.expectedVersion,
      { ...common, action: 'ci-release:restart', releaseFixture: roundtrip.releaseFixture });
    validatePhase(observed.report, current.version, ['permanentInstall', 'automaticStartup', 'nativeRestart', 'exactAuthority', 'nativeDataPreserved']);
    validateInstalledHash(observed.report, current.sha256);
    completed.push(`${role}:restart`); return observed;
  }
  const lifecycleFlags = ['permanentInstall', 'nativeDisable', 'nativeReenable', 'nativeUninstall', 'nativeReinstall', 'exactAuthority', 'nativeDataPreserved'];
  console.log(JSON.stringify({ root, result }));
  const freshClient = await createClient(current);
  const initialized = await initialize(freshClient, args.executable, args.expectedVersion, 'fresh');
  await progress('fresh:roundtrip');
  const freshRoundtrip = await runJob<ReleaseRoundtripReport>(freshClient, args.executable, args.expectedVersion, { ...common, action: 'ci-release:roundtrip' });
  validatePhase(freshRoundtrip.report, current.version, lifecycleFlags);
  validateInstalledHash(freshRoundtrip.report, current.sha256);
  assert.equal(freshRoundtrip.report.previousVersion, null);
  completed.push('fresh:roundtrip');
  const freshRestart = await restart(freshClient, freshRoundtrip.report, 'fresh');
  let migration = null;
  if (previous) {
    const client = await createClient(previous), host = args.previousRuntime ?? args.executable;
    const expected = args.previousExpectedVersion ?? args.expectedVersion;
    const initial = await initialize(client, host, expected, 'migration');
    await progress('migration:seed');
    const prior = { ...common, previousXPI: previous.xpi, previousVersion: previous.version, previousSHA256: previous.sha256 };
    const seeded = await runJob<ReleaseSeedReport>(client, host, expected, { ...prior, action: 'ci-release:seed' });
    validateInstalledHash(seeded.report, previous.sha256);
    assert.equal(seeded.report.seeded, true); assert.equal(seeded.report.permanentInstall, true);
    assert.equal(seeded.report.previousVersion, previous.version); completed.push('migration:seed');
    // runJob resolves only after native process and output close: target reuses precisely this closed owned profile.
    await progress('migration:upgrade');
    const upgraded = await runJob<ReleaseRoundtripReport>(client, args.executable, args.expectedVersion,
      { ...prior, action: 'ci-release:migrate', releaseFixture: seeded.report.releaseFixture });
    validatePhase(upgraded.report, current.version, [...lifecycleFlags, 'nativeUpgrade']);
    validateInstalledHash(upgraded.report, current.sha256);
    assert.equal(upgraded.report.previousVersion, previous.version); assert.equal(upgraded.report.upgrade, 'proved');
    completed.push('migration:upgrade');
    const restarted = await restart(client, upgraded.report, 'migration');
    migration = { previousRuntime: { version: seeded.version, platform: process.platform, arch: process.arch },
      initialize: initial, seed: seeded, roundtrip: upgraded, restart: restarted, profile: client.profile, data: client.data };
  }
  await progress('complete');
  await writeFile(result, JSON.stringify({ schemaVersion: 2, ok: true, root, artifacts: { current, previous }, completed,
    runtime: { version: freshRestart.version, platform: process.platform, arch: process.arch },
    previousRuntime: migration?.previousRuntime ?? null,
    currentSHA256: current.sha256, previousSHA256: previous?.sha256 ?? null,
    nativeExit: Object.fromEntries(completed.map(phase => [phase, 0])),
    phases: [...freshRoundtrip.report.phases.map(phase => `fresh:${phase}`), 'fresh:restart', 'fresh:automatic-startup',
      ...(migration ? [...migration.roundtrip.report.phases.map(phase => `migration:${phase}`), 'migration:restart', 'migration:automatic-startup'] : [])],
    fresh: { initialize: initialized, roundtrip: freshRoundtrip, restart: freshRestart, profile: freshClient.profile, data: freshClient.data }, migration }, null, 2),
  { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ ok: true, result, root }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Native CI failed'); process.exitCode = 1; });
}
