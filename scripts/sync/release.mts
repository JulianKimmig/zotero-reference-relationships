/** Verify two frozen XPIs through actual native release lifecycle/restart checks without building or modifying either archive. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshUIClient } from './fresh-ui.mts';
import { nativeJob } from './run.mts';
import type { SyncConfig } from '../contracts.mts';
import type { ReleaseRoundtripReport, ReleaseRestartReport } from '../../tests/sync-controller/release.sys.mts';

const acceptedSHA256 = '2757a9adbce2d260d3bcb32e0d94a1a8e83e1b7a0b41954636ab81d903bcc218';
const addonID = 'reference-relationships@zotero-plugins.local';

/** The only admitted CLI inputs identify two immutable artifacts and the actual supported native executable. */
export interface ReleaseArguments { xpi: string; previousXPI: string; executable: string }
/** Readonly archive identity recorded before the first native initialization. */
interface Artifact { xpi: string; sha256: string; version: string; files: number; updateURL: string }

/** Admit explicit CLI values before touching any artifact or starting native work. @param args Ordered --xpi ABS --previous ABS. @param environment External native executable selection. @returns Canonical absolute archive/executable paths. */
export function parseReleaseArguments(args: readonly string[], environment: { ZOTERO_BIN?: string } = process.env): ReleaseArguments {
  assert.ok(args.length === 4 && args[0] === '--xpi' && args[2] === '--previous',
    'Usage: node scripts/sync/release.mjs --xpi ABS --previous ABS');
  assert.ok(isAbsolute(args[1]) && isAbsolute(args[3]), 'Release artifacts require absolute paths');
  const xpi = resolve(args[1]), previousXPI = resolve(args[3]);
  assert.notEqual(xpi, previousXPI, 'Current and previous artifacts must be distinct');
  const executable = environment.ZOTERO_BIN;
  assert.ok(executable && isAbsolute(executable), 'Set absolute ZOTERO_BIN to official Zotero 10.0.7');
  return { xpi, previousXPI, executable: resolve(executable) };
}

/** Inspect actual frozen archive metadata with the existing native unzip tool, never a packaging operation. @param xpi Explicit archive. @param version Expected current or prior-test version. @param files Expected production payload file count. @returns Byte hash and validated native manifest facts. */
async function artifact(xpi: string, version: string, files: number): Promise<Artifact> {
  assert.ok((await lstat(xpi)).isFile(), 'Release XPI must be a regular file');
  const sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const entries = execFileSync('unzip', ['-Z1', xpi], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .trim().split('\n').filter(path => !path.endsWith('/'));
  assert.equal(entries.length, files, 'Frozen XPI production file count differs');
  assert.equal(new Set(entries).size, entries.length, 'Frozen XPI contains duplicate entries');
  assert.ok(entries.every(path => path === 'manifest.json' || path === 'bootstrap.js' || path === 'LICENSE'
    || path === 'THIRD-PARTY-NOTICES.md' || /^(src|locale)\//.test(path)),
    'Frozen XPI contains nonproduction entries');
  const manifest = JSON.parse(execFileSync('unzip', ['-p', xpi, 'manifest.json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as {
    version?: string; applications?: { zotero?: { id?: string; strict_min_version?: string; strict_max_version?: string; update_url?: string } };
  };
  const native = manifest.applications?.zotero;
  assert.equal(manifest.version, version, 'Frozen XPI version differs');
  assert.equal(native?.id, addonID, 'Frozen XPIs must identify the same actual addon');
  assert.equal(native?.strict_min_version, '10.0.7'); assert.equal(native?.strict_max_version, '10.0.7');
  const updateURL = native?.update_url;
  assert.ok(updateURL && new URL(updateURL).protocol === 'https:', 'Frozen XPI requires its actual HTTPS update manifest');
  return { xpi, sha256, version, files, updateURL };
}

/** Rehash both input files at every phase boundary before accepting evidence or advancing. @param artifacts Original archive observations. @returns Completion only while all frozen bytes remain unchanged. */
async function stable(artifacts: readonly Artifact[]): Promise<void> {
  for (const input of artifacts) {
    assert.equal(createHash('sha256').update(await readFile(input.xpi)).digest('hex'), input.sha256, 'Frozen release artifact changed during native acceptance');
  }
}

/** Require every reported native behavior before accepting a process phase. @param report Parsed native report. @param flags Actual behavior flags required for this phase. @returns Completion only for all explicit true proofs. */
function proved(report: object, flags: readonly string[]): void {
  for (const flag of flags) assert.equal(Reflect.get(report, flag), true, `Missing actual native release proof: ${flag}`);
  assert.equal(Reflect.get(report, 'preferenceRegistrationCount'), 1, 'Native release preference registration differs');
  assert.equal(Reflect.get(report, 'currentVersion'), '0.1.0', 'Native current artifact version differs');
}

/** Run initialized anonymous roundtrip/restart in separately owned evidence directories, retaining partial progress. @returns Final receipt path after real native exits and stable hash checks. */
async function main(): Promise<void> {
  const args = parseReleaseArguments(process.argv.slice(2));
  assert.ok(process.platform === 'linux' && process.arch === 'x64', 'Release native acceptance is limited to Linux x86_64');
  await access(args.executable);
  const current = await artifact(args.xpi, '0.1.0', 99), previous = await artifact(args.previousXPI, '0.0.9', 95);
  assert.equal(current.sha256, acceptedSHA256, 'Current XPI must be the exact frozen 99-file MIT release candidate');
  assert.notEqual(current.sha256, previous.sha256, 'Release artifacts must differ');
  const artifacts = [current, previous], root = await mkdtemp(join(tmpdir(), 'rr-release-'));
  const priorFixture = '95-file predecessor payload with manifest-only 0.0.9 test version; not a published older release';
  const completed: string[] = [], evidenceRoots: Record<string, string> = {};
  const config: SyncConfig = { groups: { writable: 6749379, restricted: 6749388 }, clients: {} };
  const options = { config, root, executable: args.executable, updateURL: current.updateURL,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  /** Publish trusted phase progress before any subsequent native operation. @param phase Next bounded operation or complete. @returns Durable progress publication under the unique journey root. */
  async function progress(phase: string): Promise<void> {
    await stable(artifacts);
    await writeFile(join(root, 'progress.json'), JSON.stringify({ phase, completed, artifacts, priorFixture, evidenceRoots, client: config.clients.release }, null, 2), { mode: 0o600 });
  }
  console.log(JSON.stringify({ root, currentSHA256: current.sha256, previousSHA256: previous.sha256 }));
  await progress('initialize');
  config.clients.release = await freshUIClient({ ...options, groups: config.groups, xpi: current.xpi, id: addonID, version: current.version });
  completed.push('initialize');
  const common = { xpi: current.xpi, previousXPI: previous.xpi, groups: config.groups, marker: `RR release ${randomUUID()}` };
  evidenceRoots.roundtrip = join(root, 'roundtrip'); await mkdir(evidenceRoots.roundtrip);
  await progress('release:roundtrip');
  const roundtrip = await nativeJob<ReleaseRoundtripReport>({ ...options, root: evidenceRoots.roundtrip }, 'release', { ...common, action: 'release:roundtrip' });
  proved(roundtrip, ['permanentInstall', 'nativeUpgrade', 'nativeDisable', 'nativeReenable', 'nativeUninstall', 'nativeReinstall', 'exactAuthority', 'nativeDataPreserved']);
  assert.equal(roundtrip.previousVersion, '0.0.9'); assert.equal(roundtrip.releaseFixture?.readyState?.state, 'ready');
  completed.push('release:roundtrip');
  evidenceRoots.restart = join(root, 'restart'); await mkdir(evidenceRoots.restart);
  await progress('release:restart');
  const restart = await nativeJob<ReleaseRestartReport>({ ...options, root: evidenceRoots.restart }, 'release',
    { ...common, action: 'release:restart', releaseFixture: roundtrip.releaseFixture });
  proved(restart, ['permanentInstall', 'automaticStartup', 'nativeRestart', 'exactAuthority', 'nativeDataPreserved']);
  completed.push('release:restart'); await progress('complete');
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, artifacts, priorFixture, completed, evidenceRoots,
    client: config.clients.release, currentSHA256: current.sha256, previousSHA256: previous.sha256,
    runtime: { version: '10.0.7', platform: process.platform, arch: process.arch }, roundtrip, restart }, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ ok: true, root, currentSHA256: current.sha256, previousSHA256: previous.sha256 }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Release acceptance failed'); process.exitCode = 1; });
}
