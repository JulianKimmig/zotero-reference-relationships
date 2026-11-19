/** Anonymous native CI consumes existing immutable XPIs; packaging and runtime provisioning belong to the caller. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshUIClient } from '../sync/fresh-ui.mts';
import { nativeJob } from '../sync/run.mts';
import { artifact, stable } from './artifacts.mts';
import { parseNativeArguments, requireBaseline, validatePhase } from './contract.mts';
import type { SyncConfig } from '../contracts.mts';
import type { ReleaseRoundtripReport, ReleaseRestartReport } from '../../tests/sync-controller/ci-release.sys.mts';
const addonID = 'reference-relationships@zotero-plugins.local';

/** Run initialized anonymous roundtrip/restart in separately owned evidence directories, retaining partial progress. @returns Final receipt path after real native exits and stable hash checks. */
export async function main(): Promise<void> {
  const args = parseNativeArguments(process.argv.slice(2));
  assert.ok(process.platform === 'linux' && process.arch === 'x64', 'Release native acceptance is limited to Linux x86_64');
  await access(args.executable);
  requireBaseline(args.previousXPI, '0.1.0');
  const current = await artifact(args.xpi), previous = args.previousXPI ? await artifact(args.previousXPI) : null;
  if (previous) assert.notEqual(current.sha256, previous?.sha256, 'Artifacts must differ');
  const artifacts = previous ? [current, previous] : [current], root = await mkdtemp(join(tmpdir(), 'rr-ci-native-'));
  const upgrade = previous ? 'required' : 'unavailable-no-historical-baseline';
  const completed: string[] = [], evidenceRoots: Record<string, string> = {};
  const config: SyncConfig = { groups: { writable: 6749379, restricted: 6749388 }, clients: {} };
  const options = { config, root, executable: args.executable, updateURL: current.updateURL,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  /** Publish trusted phase progress before any subsequent native operation. @param phase Next bounded operation or complete. @returns Durable progress publication under the unique journey root. */
  async function progress(phase: string): Promise<void> {
    await stable(artifacts);
    await writeFile(join(root, 'progress.json'), JSON.stringify({ phase, completed, artifacts, upgrade, evidenceRoots, client: config.clients.release }, null, 2), { mode: 0o600 });
  }
  console.log(JSON.stringify({ root, currentSHA256: current.sha256, previousSHA256: previous?.sha256 }));
  await progress('initialize');
  config.clients.release = await freshUIClient({ ...options, groups: config.groups, xpi: current.xpi, id: addonID, version: current.version });
  completed.push('initialize');
  const common = { xpi: current.xpi, previousXPI: previous?.xpi, currentVersion: current.version, previousVersion: previous?.version, groups: config.groups, marker: `RR release ${randomUUID()}` };
  evidenceRoots.roundtrip = join(root, 'roundtrip'); await mkdir(evidenceRoots.roundtrip);
  await progress('ci-release:roundtrip');
  const roundtrip = await nativeJob<ReleaseRoundtripReport>({ ...options, root: evidenceRoots.roundtrip }, 'release', { ...common, action: 'ci-release:roundtrip' });
  validatePhase(roundtrip, current.version, ['permanentInstall', ...(previous ? ['nativeUpgrade'] : []), 'nativeDisable', 'nativeReenable', 'nativeUninstall', 'nativeReinstall', 'exactAuthority', 'nativeDataPreserved']);
  assert.equal(roundtrip.previousVersion, previous?.version ?? null);
  assert.equal(roundtrip.upgrade, previous ? 'proved' : 'unavailable'); assert.equal(roundtrip.releaseFixture?.readyState?.state, 'ready');
  completed.push('ci-release:roundtrip');
  evidenceRoots.restart = join(root, 'restart'); await mkdir(evidenceRoots.restart);
  await progress('ci-release:restart');
  const restart = await nativeJob<ReleaseRestartReport>({ ...options, root: evidenceRoots.restart }, 'release',
    { ...common, action: 'ci-release:restart', releaseFixture: roundtrip.releaseFixture });
  validatePhase(restart, current.version, ['permanentInstall', 'automaticStartup', 'nativeRestart', 'exactAuthority', 'nativeDataPreserved']);
  completed.push('ci-release:restart'); await progress('complete');
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, artifacts, upgrade, completed, evidenceRoots,
    client: config.clients.release, currentSHA256: current.sha256, previousSHA256: previous?.sha256,
    nativeExit: { initialize: 0, roundtrip: 0, restart: 0 },
    phases: [...roundtrip.phases, 'restart', 'automatic-startup'],
    runtime: { version: '10.0.7', platform: process.platform, arch: process.arch }, roundtrip, restart }, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ ok: true, root, currentSHA256: current.sha256, previousSHA256: previous?.sha256 }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Native CI failed'); process.exitCode = 1; });
}
