/** Inspect existing production archives and preserve exact byte identity across native phases. */
import assert from 'node:assert/strict';
import { execFile as execute } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execute);
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
const addonID = 'reference-relationships@zotero-plugins.local';
/** Exact immutable input receipt. */
export interface Artifact { xpi: string; sha256: string; version: string; files: number; updateURL: string; compatibility: { min: string; max: string } }
/** Inspect actual frozen archive metadata with the existing native unzip tool, never a packaging operation. @param xpi Explicit archive. @returns Byte hash and validated native manifest facts. */
export async function artifact(xpi: string): Promise<Artifact> {
  assert.ok((await lstat(xpi)).isFile(), 'Release XPI must be a regular file');
  const sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const inspected = process.platform === 'win32' ? JSON.parse((await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:RR_CI_ARCHIVE); try { $e=$z.GetEntry('manifest.json'); if (!$e) { throw 'Missing manifest' }; $r=[IO.StreamReader]::new($e.Open()); try { @{ entries=@($z.Entries | ForEach-Object { $_.FullName }); manifest=$r.ReadToEnd() } | ConvertTo-Json -Compress } finally { $r.Dispose() } } finally { $z.Dispose() }"],
  { encoding: 'utf8', env: { ...process.env, RR_CI_ARCHIVE: xpi } })).stdout) as { entries: string[]; manifest: string } : {
    entries: (await execFile('unzip', ['-Z1', xpi], { encoding: 'utf8' })).stdout.trim().split('\n'),
    manifest: (await execFile('unzip', ['-p', xpi, 'manifest.json'], { encoding: 'utf8' })).stdout,
  };
  const entries = inspected.entries.filter(path => !path.endsWith('/'));
  const files = entries.length;
  assert.ok(files > 0, 'Empty XPI');
  assert.ok(entries.includes('manifest.json') && entries.includes('bootstrap.js'), 'Missing native entrypoints');
  assert.equal(new Set(entries).size, entries.length, 'Frozen XPI contains duplicate entries');
  assert.ok(entries.every(path => path === 'manifest.json' || path === 'bootstrap.js' || path === 'LICENSE'
    || path === 'THIRD-PARTY-NOTICES.md' || /^(src|locale)\//.test(path)),
    'Frozen XPI contains nonproduction entries');
  const manifest = JSON.parse(inspected.manifest) as {
    version?: string; applications?: { zotero?: { id?: string; strict_min_version?: string; strict_max_version?: string; update_url?: string } };
  };
  const native = manifest.applications?.zotero;
  const version = manifest.version;
  assert.ok(typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+.][\w.-]+)?$/.test(version), 'Invalid artifact version');
  assert.equal(native?.id, addonID, 'Frozen XPIs must identify the same actual addon');
  const min = native?.strict_min_version, max = native?.strict_max_version;
  assert.ok(typeof min === 'string' && /^\d+(?:\.\d+)*$/.test(min), 'Invalid manifest minimum');
  assert.ok(typeof max === 'string' && /^\d+(?:\.\d+)*(?:\.\*)?$/.test(max), 'Invalid manifest maximum');
  const updateURL = native?.update_url;
  assert.ok(updateURL && new URL(updateURL).protocol === 'https:', 'Frozen XPI requires its actual HTTPS update manifest');
  return { xpi, sha256, version, files, updateURL, compatibility: { min, max } };
}

/** Rehash both input files at every phase boundary before accepting evidence or advancing. @param artifacts Original archive observations. @returns Completion only while all frozen bytes remain unchanged. */
export async function stable(artifacts: readonly Artifact[]): Promise<void> {
  for (const input of artifacts) {
    assert.equal(createHash('sha256').update(await readFile(input.xpi)).digest('hex'), input.sha256, 'Frozen release artifact changed during native acceptance');
  }
}
